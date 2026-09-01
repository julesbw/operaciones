-- Presencia temporal de administradores visibles en Operaciones.
-- La presencia sólo decide la entrega del canal Push; no cambia la creación
-- de eventos, los destinatarios ni el estado read_at in-app.

create table public.notification_presence (
  id uuid primary key default gen_random_uuid(),
  source_app text not null check (
    source_app in ('operaciones', 'arrendamientos')
  ),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  presence_id text not null check (
    length(btrim(presence_id)) between 16 and 128
    and presence_id ~ '^[A-Za-z0-9-]+$'
  ),
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_presence_source_user_presence_key
    unique (source_app, auth_user_id, presence_id)
);

create index notification_presence_active_idx
  on public.notification_presence(source_app, auth_user_id, expires_at);

alter table public.notification_presence enable row level security;
revoke all on public.notification_presence from public, anon, authenticated;

create or replace function private.notification_presence_is_active(
  p_source_app text,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.notification_presence as presence
    where presence.source_app = p_source_app
      and presence.auth_user_id = p_user_id
      and presence.last_active_at >= now() - interval '90 seconds'
      and presence.expires_at > now()
  );
exception when others then
  -- Presence is an optimization. A read/query failure must preserve Push.
  return false;
end;
$$;

create or replace function public.heartbeat_notification_presence(
  p_source_app text,
  p_presence_id text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_user_id uuid := auth.uid();
  v_presence_id text := btrim(coalesce(p_presence_id, ''));
  v_expires_at timestamptz;
begin
  if v_user_id is null or not private.is_admin() then
    raise exception 'Sólo un administrador puede registrar presencia de Operaciones'
      using errcode = '42501';
  end if;

  if length(v_presence_id) not between 16 and 128
    or v_presence_id !~ '^[A-Za-z0-9-]+$' then
    raise exception 'El identificador de presencia no es válido'
      using errcode = '22023';
  end if;

  insert into public.notification_presence (
    source_app,
    auth_user_id,
    presence_id,
    last_active_at,
    expires_at,
    updated_at
  ) values (
    v_source_app,
    v_user_id,
    v_presence_id,
    now(),
    now() + interval '90 seconds',
    now()
  )
  on conflict (source_app, auth_user_id, presence_id) do update
  set
    last_active_at = now(),
    expires_at = now() + interval '90 seconds',
    updated_at = now()
  returning expires_at into v_expires_at;

  return v_expires_at;
end;
$$;

create or replace function public.release_notification_presence(
  p_source_app text,
  p_presence_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_user_id uuid := auth.uid();
  v_presence_id text := btrim(coalesce(p_presence_id, ''));
  v_released boolean := false;
begin
  if v_user_id is null or not private.is_admin() then
    raise exception 'Sólo un administrador puede liberar presencia de Operaciones'
      using errcode = '42501';
  end if;

  if length(v_presence_id) not between 16 and 128
    or v_presence_id !~ '^[A-Za-z0-9-]+$' then
    raise exception 'El identificador de presencia no es válido'
      using errcode = '22023';
  end if;

  update public.notification_presence
  set
    expires_at = now(),
    updated_at = now()
  where source_app = v_source_app
    and auth_user_id = v_user_id
    and presence_id = v_presence_id
  returning true into v_released;

  return v_released;
end;
$$;

-- La función sigue siendo llamada por la Edge Function con service_role. Si
-- hay presencia reciente, deja la entrega pendiente para el siguiente ciclo;
-- al expirar el TTL, Push se envía normalmente. Si ya fue leída in-app, se
-- abandona la entrega pendiente para no interrumpir después al administrador.
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

revoke all on function private.notification_presence_is_active(text, uuid)
  from public, anon, authenticated;
revoke all on function public.heartbeat_notification_presence(text, text)
  from public, anon, authenticated;
revoke all on function public.release_notification_presence(text, text)
  from public, anon, authenticated;

grant execute on function public.heartbeat_notification_presence(text, text)
  to authenticated;
grant execute on function public.release_notification_presence(text, text)
  to authenticated;

grant select on public.notification_presence to service_role;
