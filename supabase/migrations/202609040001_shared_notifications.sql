-- Generaliza la infraestructura compartida de notificaciones para que
-- Operaciones y Arrendamientos puedan usar sus propios canales sin mezclar
-- bandejas, suscripciones ni entregas.

alter table public.notifications
  add constraint notifications_source_event_entity_check check (
    (
      source_app = 'operaciones'
      and (
        (event_type = 'PURCHASE_CREATED' and entity_type = 'purchase')
        or (event_type = 'TRANSFER_CREATED' and entity_type = 'merchandise_transfer')
        or (event_type = 'CASH_CLOSING_CLOSED' and entity_type = 'cash_closing')
      )
    )
    or (
      source_app = 'arrendamientos'
      and event_type = 'PAYMENT_REGISTERED'
      and entity_type = 'payment'
    )
  );

-- La proyección debe respetar el origen de la notificación. El origen se toma
-- de la fila persistida y nunca de un valor controlado por el navegador.
create or replace function private.create_notification_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.recipient_type <> 'auth_user' then
    return new;
  end if;

  insert into public.notification_deliveries (
    source_app,
    notification_id,
    subscription_id,
    channel,
    status,
    next_attempt_at
  )
  select
    notification.source_app,
    notification.id,
    subscription.id,
    'push',
    'pending',
    now()
  from public.notifications as notification
  join public.push_subscriptions as subscription
    on subscription.source_app = notification.source_app
   and subscription.auth_user_id = new.recipient_id
   and subscription.revoked_at is null
   and subscription.paused_at is null
   and not private.notification_presence_is_active(
     notification.source_app,
     subscription.auth_user_id
   )
  where notification.id = new.notification_id
  on conflict (notification_id, subscription_id, channel) do nothing;

  return new;
end;
$$;

-- Las nuevas firmas reciben el origen explícitamente. Las firmas históricas
-- quedan como wrappers fijados a Operaciones para no romper clientes ya
-- desplegados.
create or replace function public.register_push_subscription(
  p_source_app text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_user_id uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
  v_subscription_id uuid;
begin
  if v_user_id is null or not private.is_admin() then
    raise exception 'Sólo un administrador puede registrar notificaciones Push'
      using errcode = '42501';
  end if;

  if length(v_endpoint) not between 20 and 2048
    or v_endpoint !~ '^https://[^[:space:]]+$'
    or length(v_p256dh) not between 40 and 200
    or v_p256dh !~ '^[A-Za-z0-9_-]+$'
    or length(v_auth) not between 8 and 200
    or v_auth !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Los datos de la suscripción Push no son válidos'
      using errcode = '22023';
  end if;

  insert into public.push_subscriptions (
    source_app,
    auth_user_id,
    endpoint,
    p256dh,
    auth,
    last_seen_at,
    paused_at,
    revoked_at
  ) values (
    v_source_app,
    v_user_id,
    v_endpoint,
    v_p256dh,
    v_auth,
    now(),
    null,
    null
  )
  on conflict (source_app, endpoint) do update
  set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    updated_at = now(),
    last_seen_at = now(),
    paused_at = null,
    revoked_at = null
  where public.push_subscriptions.auth_user_id = v_user_id
  returning id into v_subscription_id;

  if v_subscription_id is null then
    raise exception 'No fue posible registrar este dispositivo Push'
      using errcode = '42501';
  end if;

  return v_subscription_id;
end;
$$;

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.register_push_subscription(
    'operaciones',
    p_endpoint,
    p_p256dh,
    p_auth
  );
$$;

create or replace function public.pause_push_subscription(
  p_source_app text,
  p_endpoint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_user_id uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_paused boolean := false;
begin
  if v_user_id is null or not private.is_admin() then
    raise exception 'Sólo un administrador puede pausar notificaciones Push'
      using errcode = '42501';
  end if;

  if length(v_endpoint) not between 20 and 2048
    or v_endpoint !~ '^https://[^[:space:]]+$' then
    raise exception 'El endpoint de la suscripción Push no es válido'
      using errcode = '22023';
  end if;

  update public.push_subscriptions
  set
    paused_at = now(),
    last_seen_at = now(),
    updated_at = now()
  where source_app = v_source_app
    and auth_user_id = v_user_id
    and endpoint = v_endpoint
    and revoked_at is null
  returning true into v_paused;

  return coalesce(v_paused, false);
end;
$$;

create or replace function public.pause_push_subscription(
  p_endpoint text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.pause_push_subscription('operaciones', p_endpoint);
$$;

create or replace function public.resume_push_subscription(
  p_source_app text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_user_id uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
  v_resumed boolean := false;
begin
  if v_user_id is null or not private.is_admin() then
    raise exception 'Sólo un administrador puede reactivar notificaciones Push'
      using errcode = '42501';
  end if;

  if length(v_endpoint) not between 20 and 2048
    or v_endpoint !~ '^https://[^[:space:]]+$'
    or length(v_p256dh) not between 40 and 200
    or v_p256dh !~ '^[A-Za-z0-9_-]+$'
    or length(v_auth) not between 8 and 200
    or v_auth !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Los datos de la suscripción Push no son válidos'
      using errcode = '22023';
  end if;

  update public.push_subscriptions
  set
    p256dh = v_p256dh,
    auth = v_auth,
    paused_at = null,
    last_seen_at = now(),
    updated_at = now()
  where source_app = v_source_app
    and auth_user_id = v_user_id
    and endpoint = v_endpoint
    and revoked_at is null
  returning true into v_resumed;

  return coalesce(v_resumed, false);
end;
$$;

create or replace function public.resume_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.resume_push_subscription(
    'operaciones',
    p_endpoint,
    p_p256dh,
    p_auth
  );
$$;

create or replace function public.revoke_push_subscription(
  p_source_app text,
  p_endpoint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_user_id uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_revoked boolean := false;
begin
  if v_user_id is null or not private.is_admin() then
    raise exception 'Sólo un administrador puede desactivar notificaciones Push'
      using errcode = '42501';
  end if;

  if length(v_endpoint) not between 20 and 2048
    or v_endpoint !~ '^https://[^[:space:]]+$' then
    raise exception 'El endpoint de la suscripción Push no es válido'
      using errcode = '22023';
  end if;

  update public.push_subscriptions
  set
    updated_at = now(),
    last_seen_at = now(),
    paused_at = null,
    revoked_at = coalesce(revoked_at, now())
  where source_app = v_source_app
    and auth_user_id = v_user_id
    and endpoint = v_endpoint
  returning true into v_revoked;

  return coalesce(v_revoked, false);
end;
$$;

create or replace function public.revoke_push_subscription(
  p_endpoint text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.revoke_push_subscription('operaciones', p_endpoint);
$$;

-- Claim, completion and failure derive the source from the delivery row. This
-- preserves atomicity while allowing the same dispatcher to process both
-- applications and still requires the subscription to match its source.
create or replace function public.claim_notification_delivery(
  p_delivery_id uuid
)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Sólo el despachador interno puede reclamar entregas'
      using errcode = '42501';
  end if;

  update public.notification_deliveries as delivery
  set
    status = 'abandoned',
    next_attempt_at = null,
    last_error = 'notification_read',
    updated_at = now()
  where delivery.id = p_delivery_id
    and delivery.channel = 'push'
    and delivery.status in ('pending', 'failed')
    and exists (
      select 1
      from public.notifications as notification
      join public.notification_recipients as recipient
        on recipient.notification_id = notification.id
       and recipient.recipient_type = 'auth_user'
      join public.push_subscriptions as subscription
        on subscription.id = delivery.subscription_id
       and subscription.source_app = delivery.source_app
       and subscription.auth_user_id = recipient.recipient_id
      where notification.id = delivery.notification_id
        and notification.source_app = delivery.source_app
        and recipient.read_at is not null
    );

  return query
  update public.notification_deliveries as delivery
  set
    status = 'processing',
    attempt_count = delivery.attempt_count + 1,
    last_attempt_at = now(),
    next_attempt_at = null,
    last_error = null,
    updated_at = now()
  where delivery.id = p_delivery_id
    and delivery.channel = 'push'
    and delivery.attempt_count < 5
    and (
      delivery.status = 'pending'
      or (
        delivery.status = 'failed'
        and coalesce(delivery.next_attempt_at, now()) <= now()
      )
      or (
        delivery.status = 'processing'
        and coalesce(delivery.last_attempt_at, '-infinity'::timestamptz)
          < now() - interval '10 minutes'
      )
    )
    and exists (
      select 1
      from public.notifications as notification
      join public.push_subscriptions as subscription
        on subscription.id = delivery.subscription_id
       and subscription.source_app = delivery.source_app
       and subscription.revoked_at is null
       and subscription.paused_at is null
      where notification.id = delivery.notification_id
        and notification.source_app = delivery.source_app
    )
    and not exists (
      select 1
      from public.push_subscriptions as subscription
      where subscription.id = delivery.subscription_id
        and subscription.source_app = delivery.source_app
        and private.notification_presence_is_active(
          delivery.source_app,
          subscription.auth_user_id
        )
    )
  returning delivery.*;
end;
$$;

create or replace function public.complete_notification_delivery(
  p_delivery_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Sólo el despachador interno puede completar entregas'
      using errcode = '42501';
  end if;

  update public.notification_deliveries
  set
    status = 'delivered',
    delivered_at = coalesce(delivered_at, now()),
    next_attempt_at = null,
    last_error = null,
    updated_at = now()
  where id = p_delivery_id
    and channel = 'push'
    and status = 'processing'
  returning true into v_updated;

  return v_updated;
end;
$$;

create or replace function public.fail_notification_delivery(
  p_delivery_id uuid,
  p_permanent boolean,
  p_error text,
  p_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean := false;
  v_error text := left(
    case
      when p_error ~ '^[a-z0-9_:-]{1,80}$' then p_error
      else 'push_delivery_error'
    end,
    80
  );
begin
  if auth.role() <> 'service_role' then
    raise exception 'Sólo el despachador interno puede fallar entregas'
      using errcode = '42501';
  end if;

  update public.notification_deliveries
  set
    status = case
      when p_permanent or attempt_count >= 5 then 'abandoned'
      else 'failed'
    end,
    next_attempt_at = case
      when p_permanent or attempt_count >= 5 then null
      else coalesce(p_next_attempt_at, now())
    end,
    last_error = v_error,
    updated_at = now()
  where id = p_delivery_id
    and channel = 'push'
    and status = 'processing'
  returning true into v_updated;

  return v_updated;
end;
$$;

-- Reemplaza el scheduler anterior, que sólo recorría Operaciones.
select cron.unschedule('web-push-retry');
select cron.schedule(
  'web-push-retry',
  '* * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'web_push_function_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-web-push-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'web_push_dispatch_secret'
        )
      ),
      body := jsonb_build_object('deliveryId', due.id)
    ) as request_id
    from (
      select id
      from public.notification_deliveries
      where channel = 'push'
        and status in ('pending', 'failed')
        and coalesce(next_attempt_at, now()) <= now()
      order by next_attempt_at nulls first, created_at, id
      limit 50
    ) as due;
  $job$
);

revoke all on function private.create_notification_push_deliveries()
  from public, anon, authenticated;
revoke all on function public.register_push_subscription(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.pause_push_subscription(text, text)
  from public, anon, authenticated;
revoke all on function public.resume_push_subscription(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.revoke_push_subscription(text, text)
  from public, anon, authenticated;
revoke all on function public.register_push_subscription(text, text, text)
  from public, anon, authenticated;
revoke all on function public.pause_push_subscription(text)
  from public, anon, authenticated;
revoke all on function public.resume_push_subscription(text, text, text)
  from public, anon, authenticated;
revoke all on function public.revoke_push_subscription(text)
  from public, anon, authenticated;
revoke all on function public.claim_notification_delivery(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_notification_delivery(uuid)
  from public, anon, authenticated;
revoke all on function public.fail_notification_delivery(uuid, boolean, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.register_push_subscription(text, text, text, text)
  to authenticated;
grant execute on function public.pause_push_subscription(text, text)
  to authenticated;
grant execute on function public.resume_push_subscription(text, text, text, text)
  to authenticated;
grant execute on function public.revoke_push_subscription(text, text)
  to authenticated;
grant execute on function public.register_push_subscription(text, text, text)
  to authenticated;
grant execute on function public.pause_push_subscription(text)
  to authenticated;
grant execute on function public.resume_push_subscription(text, text, text)
  to authenticated;
grant execute on function public.revoke_push_subscription(text)
  to authenticated;
grant execute on function public.claim_notification_delivery(uuid)
  to service_role;
grant execute on function public.complete_notification_delivery(uuid)
  to service_role;
grant execute on function public.fail_notification_delivery(uuid, boolean, text, timestamptz)
  to service_role;

comment on constraint notifications_source_event_entity_check on public.notifications is
  'Valida las combinaciones de evento y entidad soportadas por cada aplicación.';
comment on function public.register_push_subscription(text, text, text, text) is
  'Registra o reactiva una suscripción Push para la aplicación indicada y el administrador autenticado.';
comment on function public.pause_push_subscription(text, text) is
  'Pausa una suscripción Push del administrador autenticado dentro de la aplicación indicada.';
comment on function public.resume_push_subscription(text, text, text, text) is
  'Reanuda una suscripción Push existente del administrador autenticado dentro de la aplicación indicada.';
comment on function public.revoke_push_subscription(text, text) is
  'Revoca una suscripción Push del administrador autenticado dentro de la aplicación indicada.';
