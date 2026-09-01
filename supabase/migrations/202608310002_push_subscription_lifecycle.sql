-- Estado de ciclo de vida para conservar una PushSubscription durante el
-- logout sin dejarla habilitada para la siguiente persona del dispositivo.
-- ACTIVE  = revoked_at is null and paused_at is null.
-- PAUSED  = revoked_at is null and paused_at is not null.
-- REVOKED = revoked_at is not null.

alter table public.push_subscriptions
  add column if not exists paused_at timestamptz;

create index if not exists push_subscriptions_delivery_state_idx
  on public.push_subscriptions(source_app, auth_user_id, paused_at, revoked_at);

-- El registro explícito puede reactivar la suscripción del mismo admin. El
-- cliente reemplaza la PushSubscription local antes de registrar si no tiene
-- preferencia propia, evitando transferir entregas pendientes entre cuentas.
create or replace function public.register_push_subscription(
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
    'operaciones',
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

-- Sólo el admin autenticado dueño de la suscripción puede pausarla. El
-- endpoint identifica el dispositivo actual y no se acepta auth_user_id desde
-- el navegador.
create or replace function public.pause_push_subscription(
  p_endpoint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  where source_app = 'operaciones'
    and auth_user_id = v_user_id
    and endpoint = v_endpoint
    and revoked_at is null
  returning true into v_paused;

  return coalesce(v_paused, false);
end;
$$;

-- Reactivación silenciosa de login. No inserta ni transfiere filas: si no hay
-- una fila no revocada del mismo admin, sólo un gesto explícito puede activar.
create or replace function public.resume_push_subscription(
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
  where source_app = 'operaciones'
    and auth_user_id = v_user_id
    and endpoint = v_endpoint
    and revoked_at is null
  returning true into v_resumed;

  return coalesce(v_resumed, false);
end;
$$;

create or replace function public.revoke_push_subscription(
  p_endpoint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  where source_app = 'operaciones'
    and auth_user_id = v_user_id
    and endpoint = v_endpoint
  returning true into v_revoked;

  return coalesce(v_revoked, false);
end;
$$;

-- Una suscripción pausada no proyecta nuevas entregas. Las entregas que ya
-- existían se mantienen pendientes y el claim también las filtra, de modo que
-- no se pierden si el admin vuelve a estar activo o abandona la app.
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
    and notification.source_app = 'operaciones'
  on conflict (notification_id, subscription_id, channel) do nothing;

  return new;
end;
$$;

-- La presencia decide la entrega sólo después de que exista una suscripción
-- activa. El chequeo adicional de estado evita reclamar filas antiguas que
-- fueron creadas antes de un pause o revoke.
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
    and delivery.source_app = 'operaciones'
    and delivery.channel = 'push'
    and delivery.status in ('pending', 'failed')
    and exists (
      select 1
      from public.notification_recipients as recipient
      join public.push_subscriptions as subscription
        on subscription.id = delivery.subscription_id
       and subscription.source_app = delivery.source_app
      where recipient.notification_id = delivery.notification_id
        and recipient.recipient_type = 'auth_user'
        and recipient.recipient_id = subscription.auth_user_id
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
    and delivery.source_app = 'operaciones'
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
      from public.push_subscriptions as subscription
      where subscription.id = delivery.subscription_id
        and subscription.source_app = delivery.source_app
        and subscription.revoked_at is null
        and subscription.paused_at is null
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

revoke all on function public.pause_push_subscription(text)
  from public, anon, authenticated;
revoke all on function public.resume_push_subscription(text, text, text)
  from public, anon, authenticated;

grant execute on function public.pause_push_subscription(text)
  to authenticated;
grant execute on function public.resume_push_subscription(text, text, text)
  to authenticated;
