-- Notificaciones in-app v1 para operaciones aceptadas por el backend.
-- La entrega push queda fuera de esta migración.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in (
      'PURCHASE_CREATED',
      'TRANSFER_CREATED',
      'CASH_CLOSING_CLOSED'
    )
  ),
  title text not null check (
    length(btrim(title)) between 1 and 160
  ),
  message text not null check (
    length(btrim(message)) between 1 and 1200
  ),
  store_id uuid references public.stores(id) on delete restrict,
  entity_type text not null check (
    entity_type in ('purchase', 'merchandise_transfer', 'cash_closing')
  ),
  entity_id uuid not null,
  actor_operator_account_id uuid
    references public.app_accounts(id) on delete set null,
  actor_auth_user_id uuid
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint notifications_event_entity_check check (
    (event_type = 'PURCHASE_CREATED' and entity_type = 'purchase')
    or (event_type = 'TRANSFER_CREATED' and entity_type = 'merchandise_transfer')
    or (event_type = 'CASH_CLOSING_CLOSED' and entity_type = 'cash_closing')
  ),
  constraint notifications_event_entity_key unique (event_type, entity_id)
);

create index notifications_created_at_idx
  on public.notifications(created_at desc, id desc);
create index notifications_entity_idx
  on public.notifications(entity_type, entity_id);

create table public.notification_recipients (
  notification_id uuid not null
    references public.notifications(id) on delete cascade,
  recipient_type text not null check (
    recipient_type in ('auth_user', 'app_account')
  ),
  recipient_id uuid not null,
  read_at timestamptz,
  primary key (notification_id, recipient_type, recipient_id)
);

create index notification_recipients_recipient_idx
  on public.notification_recipients(recipient_type, recipient_id, notification_id);
create index notification_recipients_unread_idx
  on public.notification_recipients(recipient_type, recipient_id)
  where read_at is null;

alter table public.notifications enable row level security;
alter table public.notification_recipients enable row level security;

-- El cliente sólo accede a estas tablas mediante las RPCs controladas abajo.
revoke all on public.notifications from public, anon, authenticated;
revoke all on public.notification_recipients from public, anon, authenticated;

create or replace function private.notification_actor_name(
  p_actor_operator_account_id uuid,
  p_actor_auth_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select nullif(btrim(account.display_name), '')
      from public.app_accounts as account
      where account.id = p_actor_operator_account_id
    ),
    (
      select nullif(btrim(profile.full_name), '')
      from public.profiles as profile
      where profile.id = p_actor_auth_user_id
    ),
    'Administración'
  );
$$;

create or replace function private.notification_money(p_amount numeric)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select to_char(round(coalesce(p_amount, 0), 2), 'FM$999,999,999,990.00');
$$;

-- Esta función es interna: sólo los triggers de operaciones la invocan.
-- El ON CONFLICT protege tanto retries como ejecuciones concurrentes.
create or replace function private.create_notification(
  p_event_type text,
  p_title text,
  p_message text,
  p_store_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_operator_account_id uuid,
  p_actor_auth_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification_id uuid;
begin
  insert into public.notifications (
    event_type,
    title,
    message,
    store_id,
    entity_type,
    entity_id,
    actor_operator_account_id,
    actor_auth_user_id
  ) values (
    p_event_type,
    p_title,
    p_message,
    p_store_id,
    p_entity_type,
    p_entity_id,
    p_actor_operator_account_id,
    p_actor_auth_user_id
  )
  on conflict (event_type, entity_id) do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select notification.id into v_notification_id
    from public.notifications as notification
    where notification.event_type = p_event_type
      and notification.entity_id = p_entity_id;
  end if;

  insert into public.notification_recipients (
    notification_id,
    recipient_type,
    recipient_id
  )
  select v_notification_id, 'auth_user', profile.id
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where profile.role = 'admin'
    and auth_user.deleted_at is null
  on conflict (notification_id, recipient_type, recipient_id) do nothing;

  return v_notification_id;
end;
$$;

create or replace function private.notifications_after_purchase_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases;
  v_store_name text;
  v_actor_name text;
begin
  select purchase.* into v_purchase
  from public.purchases as purchase
  where purchase.id = new.purchase_id;

  select store.name into v_store_name
  from public.stores as store
  where store.id = new.source_store_id;

  v_actor_name := private.notification_actor_name(
    v_purchase.created_by_operator_account_id,
    v_purchase.created_by
  );

  perform private.create_notification(
    'PURCHASE_CREATED',
    'Compra registrada',
    format(
      '%s · %s%sProveedor: %s%sRegistró: %s',
      coalesce(v_store_name, 'Caja Central'),
      private.notification_money(new.amount),
      chr(10),
      v_purchase.supplier_name_snapshot,
      chr(10),
      v_actor_name
    ),
    new.source_store_id,
    'purchase',
    new.purchase_id,
    v_purchase.created_by_operator_account_id,
    v_purchase.created_by
  );

  return new;
end;
$$;

create or replace function private.notifications_after_merchandise_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin_name text;
  v_destination_name text;
  v_actor_name text;
begin
  select store.name into v_origin_name
  from public.stores as store
  where store.id = new.origin_store_id;

  select store.name into v_destination_name
  from public.stores as store
  where store.id = new.destination_store_id;

  v_actor_name := private.notification_actor_name(
    new.created_by_operator_account_id,
    new.created_by
  );

  perform private.create_notification(
    'TRANSFER_CREATED',
    'Transferencia registrada',
    format(
      '%s → %s%s%s%sRegistró: %s',
      coalesce(v_origin_name, 'Tienda de origen'),
      coalesce(v_destination_name, 'Tienda de destino'),
      chr(10),
      private.notification_money(new.amount),
      chr(10),
      v_actor_name
    ),
    new.origin_store_id,
    'merchandise_transfer',
    new.id,
    new.created_by_operator_account_id,
    new.created_by
  );

  return new;
end;
$$;

create or replace function private.notifications_after_cash_closing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
begin
  v_actor_name := private.notification_actor_name(
    new.closed_by_operator_account_id,
    new.closed_by
  );

  perform private.create_notification(
    'CASH_CLOSING_CLOSED',
    'Corte cerrado',
    format(
      '%s · Corte #%s%sEfectivo a retirar: %s%sDiferencia: %s%sCerró: %s',
      new.store_name_snapshot,
      new.closing_number,
      chr(10),
      private.notification_money(new.cash_to_withdraw),
      chr(10),
      private.notification_money(new.difference),
      chr(10),
      v_actor_name
    ),
    new.store_id,
    'cash_closing',
    new.id,
    new.closed_by_operator_account_id,
    new.closed_by
  );

  return new;
end;
$$;

drop trigger if exists purchases_create_notification
  on public.purchase_payments;
create trigger purchases_create_notification
after insert on public.purchase_payments
for each row execute function private.notifications_after_purchase_payment();

drop trigger if exists merchandise_transfers_create_notification
  on public.merchandise_transfers;
create trigger merchandise_transfers_create_notification
after insert on public.merchandise_transfers
for each row execute function private.notifications_after_merchandise_transfer();

drop trigger if exists cash_closings_create_notification
  on public.cash_closings;
create trigger cash_closings_create_notification
after insert on public.cash_closings
for each row execute function private.notifications_after_cash_closing();

create or replace function public.list_notifications(p_limit integer)
returns table (
  id uuid,
  event_type text,
  title text,
  message text,
  store_id uuid,
  store_name text,
  entity_type text,
  entity_id uuid,
  actor_operator_account_id uuid,
  actor_auth_user_id uuid,
  created_at timestamptz,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if v_user_id is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;

  return query
  select
    notification.id,
    notification.event_type,
    notification.title,
    notification.message,
    notification.store_id,
    store.name,
    notification.entity_type,
    notification.entity_id,
    notification.actor_operator_account_id,
    notification.actor_auth_user_id,
    notification.created_at,
    recipient.read_at
  from public.notifications as notification
  join public.notification_recipients as recipient
    on recipient.notification_id = notification.id
   and recipient.recipient_type = 'auth_user'
   and recipient.recipient_id = v_user_id
  left join public.stores as store on store.id = notification.store_id
  order by notification.created_at desc, notification.id desc
  limit v_limit;
end;
$$;

create or replace function public.count_unread_notifications()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;

  select count(*)::integer into v_count
  from public.notification_recipients as recipient
  where recipient.recipient_type = 'auth_user'
    and recipient.recipient_id = v_user_id
    and recipient.read_at is null;

  return v_count;
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;

  update public.notification_recipients as recipient
  set read_at = coalesce(recipient.read_at, now())
  where recipient.notification_id = p_notification_id
    and recipient.recipient_type = 'auth_user'
    and recipient.recipient_id = v_user_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;

  update public.notification_recipients as recipient
  set read_at = now()
  where recipient.recipient_type = 'auth_user'
    and recipient.recipient_id = v_user_id
    and recipient.read_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function private.notification_actor_name(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.notification_money(numeric)
  from public, anon, authenticated;
revoke all on function private.create_notification(
  text, text, text, uuid, text, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function private.notifications_after_purchase_payment()
  from public, anon, authenticated;
revoke all on function private.notifications_after_merchandise_transfer()
  from public, anon, authenticated;
revoke all on function private.notifications_after_cash_closing()
  from public, anon, authenticated;

revoke all on function public.list_notifications(integer)
  from public, anon, authenticated;
revoke all on function public.count_unread_notifications()
  from public, anon, authenticated;
revoke all on function public.mark_notification_read(uuid)
  from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read()
  from public, anon, authenticated;

grant execute on function public.list_notifications(integer)
  to authenticated;
grant execute on function public.count_unread_notifications()
  to authenticated;
grant execute on function public.mark_notification_read(uuid)
  to authenticated;
grant execute on function public.mark_all_notifications_read()
  to authenticated;

comment on table public.notifications is
  'Eventos de negocio aceptados por backend, preparados para múltiples canales de entrega.';
comment on table public.notification_recipients is
  'Estado de lectura por destinatario; soporta auth_user y app_account.';
comment on function public.list_notifications(integer) is
  'Lista sólo las notificaciones asignadas al usuario autenticado.';
comment on function public.mark_notification_read(uuid) is
  'Marca como leída una notificación asignada al usuario autenticado.';
