-- Web Push secundario para las notificaciones de Operaciones.
-- Esta migración es aditiva: no cambia read_at ni el flujo in-app.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  source_app text not null check (
    source_app in ('operaciones', 'arrendamientos')
  ),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (
    length(btrim(endpoint)) between 20 and 2048
  ),
  p256dh text not null check (
    length(btrim(p256dh)) between 40 and 200
  ),
  auth text not null check (
    length(btrim(auth)) between 8 and 200
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint push_subscriptions_source_endpoint_key
    unique (source_app, endpoint)
);

create index push_subscriptions_active_user_idx
  on public.push_subscriptions(source_app, auth_user_id, last_seen_at desc)
  where revoked_at is null;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  source_app text not null check (
    source_app in ('operaciones', 'arrendamientos')
  ),
  notification_id uuid not null
    references public.notifications(id) on delete cascade,
  subscription_id uuid not null
    references public.push_subscriptions(id) on delete cascade,
  channel text not null default 'push' check (channel = 'push'),
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'delivered', 'failed', 'abandoned')
  ),
  attempt_count integer not null default 0 check (
    attempt_count >= 0
  ),
  next_attempt_at timestamptz default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_unique_attempt_key
    unique (notification_id, subscription_id, channel)
);

create index notification_deliveries_due_idx
  on public.notification_deliveries(source_app, status, next_attempt_at, created_at);
create index notification_deliveries_notification_idx
  on public.notification_deliveries(notification_id);

alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;

revoke all on public.push_subscriptions from public, anon, authenticated;
revoke all on public.notification_deliveries from public, anon, authenticated;

-- La proyección se ejecuta después de crear cada destinatario auth_user. Sólo
-- Operaciones produce entregas: las notificaciones de Arrendamientos quedan
-- aisladas aunque compartan la infraestructura de bandeja.
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
  where notification.id = new.notification_id
    and notification.source_app = 'operaciones'
  on conflict (notification_id, subscription_id, channel) do nothing;

  return new;
end;
$$;

drop trigger if exists notification_recipients_create_push_deliveries
  on public.notification_recipients;
create trigger notification_recipients_create_push_deliveries
after insert on public.notification_recipients
for each row execute function private.create_notification_push_deliveries();

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
    revoked_at
  ) values (
    'operaciones',
    v_user_id,
    v_endpoint,
    v_p256dh,
    v_auth,
    now(),
    null
  )
  on conflict (source_app, endpoint) do update
  set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    updated_at = now(),
    last_seen_at = now(),
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
    revoked_at = coalesce(revoked_at, now())
  where source_app = 'operaciones'
    and auth_user_id = v_user_id
    and endpoint = v_endpoint
  returning true into v_revoked;

  return v_revoked;
end;
$$;

-- Estas funciones sólo las usa deliver-web-push con la service role key. La
-- actualización filtrada es atómica: dos invocaciones concurrentes sólo una
-- puede pasar de pending/failed a processing.
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
    and source_app = 'operaciones'
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
    and source_app = 'operaciones'
    and channel = 'push'
    and status = 'processing'
  returning true into v_updated;

  return v_updated;
end;
$$;

revoke all on function private.create_notification_push_deliveries()
  from public, anon, authenticated;
revoke all on function public.register_push_subscription(text, text, text)
  from public, anon, authenticated;
revoke all on function public.revoke_push_subscription(text)
  from public, anon, authenticated;
revoke all on function public.claim_notification_delivery(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_notification_delivery(uuid)
  from public, anon, authenticated;
revoke all on function public.fail_notification_delivery(uuid, boolean, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.register_push_subscription(text, text, text)
  to authenticated;
grant execute on function public.revoke_push_subscription(text)
  to authenticated;
grant execute on function public.claim_notification_delivery(uuid)
  to service_role;
grant execute on function public.complete_notification_delivery(uuid)
  to service_role;
grant execute on function public.fail_notification_delivery(uuid, boolean, text, timestamptz)
  to service_role;

grant select, update on public.push_subscriptions to service_role;
grant select, update on public.notification_deliveries to service_role;
grant select on public.notifications to service_role;
grant select on public.notification_recipients to service_role;
