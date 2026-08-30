-- Aislamiento multi-app para la infraestructura compartida de notificaciones.
-- Conserva a los administradores como destinatarios globales, pero separa
-- bandejas, conteos, lectura e idempotencia por aplicación.

alter table public.notifications
  add column source_app text;

update public.notifications
set source_app = 'operaciones'
where source_app is null;

alter table public.notifications
  alter column source_app set not null,
  add constraint notifications_source_app_check check (
    source_app in ('operaciones', 'arrendamientos')
  ),
  drop constraint notifications_event_entity_key,
  drop constraint notifications_event_type_check,
  drop constraint notifications_entity_type_check,
  drop constraint notifications_event_entity_check,
  add constraint notifications_source_event_entity_key
    unique (source_app, event_type, entity_id),
  add constraint notifications_event_type_format_check check (
    length(btrim(event_type)) between 1 and 120
  ),
  add constraint notifications_entity_type_format_check check (
    length(btrim(entity_type)) between 1 and 120
  );

create index notifications_source_created_at_idx
  on public.notifications(source_app, created_at desc, id desc);

create or replace function private.require_notification_source_app(
  p_source_app text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_source_app is null
    or p_source_app not in ('operaciones', 'arrendamientos') then
    raise exception 'Aplicación de notificaciones no válida'
      using errcode = '22023';
  end if;

  return p_source_app;
end;
$$;

create or replace function private.create_notification(
  p_source_app text,
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
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_notification_id uuid;
begin
  insert into public.notifications (
    source_app,
    event_type,
    title,
    message,
    store_id,
    entity_type,
    entity_id,
    actor_operator_account_id,
    actor_auth_user_id
  ) values (
    v_source_app,
    p_event_type,
    p_title,
    p_message,
    p_store_id,
    p_entity_type,
    p_entity_id,
    p_actor_operator_account_id,
    p_actor_auth_user_id
  )
  on conflict (source_app, event_type, entity_id) do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select notification.id into v_notification_id
    from public.notifications as notification
    where notification.source_app = v_source_app
      and notification.event_type = p_event_type
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
    'operaciones',
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
    'operaciones',
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
    'operaciones',
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

drop function private.create_notification(
  text, text, text, uuid, text, uuid, uuid, uuid
);

drop function public.list_notifications(integer);
drop function public.count_unread_notifications();
drop function public.mark_notification_read(uuid);
drop function public.mark_all_notifications_read();

create function public.list_notifications(
  p_source_app text,
  p_limit integer
)
returns table (
  id uuid,
  source_app text,
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
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if v_user_id is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;

  return query
  select
    notification.id,
    notification.source_app,
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
  where notification.source_app = v_source_app
  order by notification.created_at desc, notification.id desc
  limit v_limit;
end;
$$;

create function public.count_unread_notifications(p_source_app text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;

  select count(*)::integer into v_count
  from public.notification_recipients as recipient
  join public.notifications as notification
    on notification.id = recipient.notification_id
  where recipient.recipient_type = 'auth_user'
    and recipient.recipient_id = v_user_id
    and recipient.read_at is null
    and notification.source_app = v_source_app;

  return v_count;
end;
$$;

create function public.mark_notification_read(
  p_source_app text,
  p_notification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;

  update public.notification_recipients as recipient
  set read_at = coalesce(recipient.read_at, now())
  where recipient.notification_id = p_notification_id
    and recipient.recipient_type = 'auth_user'
    and recipient.recipient_id = v_user_id
    and exists (
      select 1
      from public.notifications as notification
      where notification.id = recipient.notification_id
        and notification.source_app = v_source_app
    );

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create function public.mark_all_notifications_read(p_source_app text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_source_app text := private.require_notification_source_app(p_source_app);
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;

  update public.notification_recipients as recipient
  set read_at = now()
  where recipient.recipient_type = 'auth_user'
    and recipient.recipient_id = v_user_id
    and recipient.read_at is null
    and exists (
      select 1
      from public.notifications as notification
      where notification.id = recipient.notification_id
        and notification.source_app = v_source_app
    );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Compatibilidad de rollout para versiones de Operaciones ya desplegadas.
-- Estas firmas no aceptan un dominio arbitrario: quedan limitadas de forma
-- explícita a Operaciones y pueden retirarse cuando no existan clientes viejos.
create function public.list_notifications(p_limit integer)
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
language sql
stable
security definer
set search_path = ''
as $$
  select
    notification.id,
    notification.event_type,
    notification.title,
    notification.message,
    notification.store_id,
    notification.store_name,
    notification.entity_type,
    notification.entity_id,
    notification.actor_operator_account_id,
    notification.actor_auth_user_id,
    notification.created_at,
    notification.read_at
  from public.list_notifications('operaciones', p_limit) as notification;
$$;

create function public.count_unread_notifications()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select public.count_unread_notifications('operaciones');
$$;

create function public.mark_notification_read(p_notification_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.mark_notification_read('operaciones', p_notification_id);
$$;

create function public.mark_all_notifications_read()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.mark_all_notifications_read('operaciones');
$$;

revoke all on function private.require_notification_source_app(text)
  from public, anon, authenticated;
revoke all on function private.create_notification(
  text, text, text, text, uuid, text, uuid, uuid, uuid
) from public, anon, authenticated;

revoke all on function public.list_notifications(text, integer)
  from public, anon, authenticated;
revoke all on function public.count_unread_notifications(text)
  from public, anon, authenticated;
revoke all on function public.mark_notification_read(text, uuid)
  from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read(text)
  from public, anon, authenticated;
revoke all on function public.list_notifications(integer)
  from public, anon, authenticated;
revoke all on function public.count_unread_notifications()
  from public, anon, authenticated;
revoke all on function public.mark_notification_read(uuid)
  from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read()
  from public, anon, authenticated;

grant execute on function public.list_notifications(text, integer)
  to authenticated;
grant execute on function public.count_unread_notifications(text)
  to authenticated;
grant execute on function public.mark_notification_read(text, uuid)
  to authenticated;
grant execute on function public.mark_all_notifications_read(text)
  to authenticated;
grant execute on function public.list_notifications(integer)
  to authenticated;
grant execute on function public.count_unread_notifications()
  to authenticated;
grant execute on function public.mark_notification_read(uuid)
  to authenticated;
grant execute on function public.mark_all_notifications_read()
  to authenticated;

comment on column public.notifications.source_app is
  'Aplicación propietaria del evento y dominio de aislamiento de su bandeja.';
comment on function public.list_notifications(text, integer) is
  'Lista las notificaciones asignadas al usuario dentro de una aplicación validada.';
comment on function public.mark_notification_read(text, uuid) is
  'Marca como leída una notificación sólo si pertenece al usuario y a la aplicación indicada.';
comment on function public.mark_all_notifications_read(text) is
  'Marca como leídas las notificaciones del usuario sólo dentro de la aplicación indicada.';
