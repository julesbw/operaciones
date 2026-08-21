-- Capacidades operativas y enforcement server-side para cashier/store_manager.
-- Aplicar manualmente después de vaciar las colas legacy. No atribuye históricos.

alter table public.expenses
  add column if not exists created_by_operator_account_id uuid
    references public.app_accounts(id) on delete restrict;
alter table public.attendance_records
  add column if not exists recorded_by_operator_account_id uuid
    references public.app_accounts(id) on delete restrict;
alter table public.merchandise_transfers
  add column if not exists created_by_operator_account_id uuid
    references public.app_accounts(id) on delete restrict;
alter table public.purchases
  add column if not exists created_by_operator_account_id uuid
    references public.app_accounts(id) on delete restrict;
alter table public.cash_closings
  add column if not exists closed_by_operator_account_id uuid
    references public.app_accounts(id) on delete restrict;

create index if not exists expenses_operator_account_idx
  on public.expenses(created_by_operator_account_id)
  where created_by_operator_account_id is not null;
create index if not exists attendance_operator_account_idx
  on public.attendance_records(recorded_by_operator_account_id)
  where recorded_by_operator_account_id is not null;
create index if not exists merchandise_transfers_operator_account_idx
  on public.merchandise_transfers(created_by_operator_account_id)
  where created_by_operator_account_id is not null;
create index if not exists purchases_operator_account_idx
  on public.purchases(created_by_operator_account_id)
  where created_by_operator_account_id is not null;
create index if not exists cash_closings_operator_account_idx
  on public.cash_closings(closed_by_operator_account_id)
  where closed_by_operator_account_id is not null;

create or replace function private.require_operator_session(p_operator_token text)
returns table (
  session_id uuid,
  app_account_id uuid,
  role text,
  store_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_user_id uuid := auth.uid();
  v_session public.app_sessions;
  v_account public.app_accounts;
  v_technical_store_id uuid;
  v_store_active boolean;
begin
  if v_device_user_id is null then
    raise exception 'OPERATOR_SESSION_REQUIRED' using errcode = '42501';
  end if;
  if p_operator_token is null or length(p_operator_token) = 0 then
    raise exception 'OPERATOR_SESSION_REQUIRED' using errcode = '28000';
  end if;

  select session.* into v_session
  from public.app_sessions as session
  where session.token_hash = public.digest(p_operator_token, 'sha256')
    and session.device_user_id = v_device_user_id;
  if not found then
    raise exception 'OPERATOR_SESSION_INVALID' using errcode = '28000';
  end if;

  select account.* into v_account
  from public.app_accounts as account
  where account.id = v_session.app_account_id;
  if not found or not v_account.is_active then
    raise exception 'OPERATOR_ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if v_session.revoked_at is not null or v_session.expires_at <= now() then
    raise exception 'OPERATOR_SESSION_EXPIRED' using errcode = '28000';
  end if;

  select profile.store_id into v_technical_store_id
  from public.profiles as profile
  where profile.id = v_device_user_id
    and profile.role <> 'admin';
  if v_technical_store_id is null
    or v_technical_store_id is distinct from v_account.store_id then
    raise exception 'OPERATOR_STORE_FORBIDDEN' using errcode = '42501';
  end if;

  select store.status = 'active' into v_store_active
  from public.stores as store
  where store.id = v_account.store_id;
  if not coalesce(v_store_active, false) then
    raise exception 'OPERATOR_STORE_FORBIDDEN' using errcode = '42501';
  end if;

  return query select v_session.id, v_account.id, v_account.role, v_account.store_id;
end;
$$;

create or replace function private.operator_has_capability(
  p_role text,
  p_capability text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_role
    when 'cashier' then p_capability in (
      'expense_store_cash', 'attendance', 'transfer'
    )
    when 'store_manager' then p_capability in (
      'expense_store_cash', 'attendance', 'transfer',
      'purchase_store_cash', 'cash_closing'
    )
    else false
  end;
$$;

create or replace function private.require_operator_authority(
  p_operator_token text,
  p_capability text,
  p_requested_store_id uuid
)
returns table (
  app_account_id uuid,
  role text,
  store_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
begin
  select * into v_session
  from private.require_operator_session(p_operator_token);

  if not private.operator_has_capability(v_session.role, p_capability) then
    raise exception 'OPERATOR_CAPABILITY_FORBIDDEN' using errcode = '42501';
  end if;
  if p_requested_store_id is null
    or p_requested_store_id is distinct from v_session.store_id then
    raise exception 'OPERATOR_STORE_FORBIDDEN' using errcode = '42501';
  end if;

  return query select
    v_session.app_account_id::uuid,
    v_session.role::text,
    v_session.store_id::uuid;
end;
$$;

-- La validación pública reutiliza la misma autoridad que las operaciones.
create or replace function public.validate_app_session(p_session_token text)
returns table (
  account_id uuid,
  username text,
  display_name text,
  role text,
  store_id uuid,
  store_name text,
  collaborator_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valid record;
begin
  select * into v_valid
  from private.require_operator_session(p_session_token);

  update public.app_sessions
  set last_seen_at = now()
  where id = v_valid.session_id;

  return query
  select account.id, account.username, account.display_name, account.role,
    account.store_id, store.name, account.collaborator_id, session.expires_at
  from public.app_accounts as account
  join public.app_sessions as session on session.app_account_id = account.id
  join public.stores as store on store.id = account.store_id
  where session.id = v_valid.session_id;
end;
$$;

revoke all on function private.require_operator_session(text)
  from public, anon, authenticated;
revoke all on function private.operator_has_capability(text, text)
  from public, anon, authenticated;
revoke all on function private.require_operator_authority(text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.validate_app_session(text)
  from public, anon, authenticated;
grant execute on function public.validate_app_session(text) to authenticated;

comment on function private.require_operator_session(text) is
  'Resuelve la identidad operativa actual desde un token ligado a auth.uid(); nunca confía en AppAccount o tienda enviados por el cliente.';
comment on function private.operator_has_capability(text, text) is
  'Matriz cerrada de capacidades para cashier y store_manager.';

-- Proveedores: lectura controlada; las escrituras y la RLS siguen admin-only.
create or replace function public.list_purchase_suppliers(p_operator_token text)
returns setof public.suppliers
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session record;
begin
  if not private.is_admin() then
    select * into v_session
    from private.require_operator_session(p_operator_token);
    if not private.operator_has_capability(
      v_session.role, 'purchase_store_cash'
    ) then
      raise exception 'OPERATOR_CAPABILITY_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  return query
  select supplier.*
  from public.suppliers as supplier
  where supplier.is_active
  order by supplier.name;
end;
$$;

-- Compras: admin puede filtrar globalmente; store_manager sólo recibe
-- compras store_cash de su tienda derivada de la sesión.
create or replace function public.list_paid_purchases(
  p_operator_token text,
  p_store_id uuid,
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store_id uuid := p_store_id;
  v_session record;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if not private.is_admin() then
    select * into v_session
    from private.require_operator_session(p_operator_token);
    if not private.operator_has_capability(
      v_session.role, 'purchase_store_cash'
    ) then
      raise exception 'OPERATOR_CAPABILITY_FORBIDDEN' using errcode = '42501';
    end if;
    if p_store_id is not null and p_store_id is distinct from v_session.store_id then
      raise exception 'OPERATOR_STORE_FORBIDDEN' using errcode = '42501';
    end if;
    v_store_id := v_session.store_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'purchase', to_jsonb(purchase),
    'payment', to_jsonb(payment)
  ) order by purchase.business_date desc, purchase.created_at desc), '[]'::jsonb)
  into v_result
  from public.purchases as purchase
  join public.purchase_payments as payment on payment.purchase_id = purchase.id
  where (v_store_id is null or payment.source_store_id = v_store_id)
    and (private.is_admin() or payment.funding_source = 'store_cash')
    and (p_date_from is null or purchase.business_date >= p_date_from)
    and (p_date_to is null or purchase.business_date <= p_date_to);

  return v_result;
end;
$$;

revoke all on function public.list_purchase_suppliers(text)
  from public, anon, authenticated;
revoke all on function public.list_paid_purchases(text, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.list_purchase_suppliers(text) to authenticated;
grant execute on function public.list_paid_purchases(text, uuid, date, date)
  to authenticated;

-- Escrituras local-first. Las firmas nuevas reciben token; las firmas antiguas
-- se conservan como wrappers estrictamente admin-only para eliminar el bypass.
create or replace function public.sync_expense(
  p_id uuid,
  p_base_version integer,
  p_store_id uuid,
  p_business_date date,
  p_amount numeric,
  p_concept text,
  p_payment_method text,
  p_notes text,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_created_by uuid,
  p_operator_token text
)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.expenses;
  v_expense public.expenses;
  v_operator_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if p_created_by is distinct from auth.uid() then
    raise exception 'El autor local no corresponde a la sesión' using errcode = '42501';
  end if;
  if p_base_version is null or p_base_version < 0 then
    raise exception 'La versión local no es válida' using errcode = '22023';
  end if;
  if not private.is_admin() then
    select authority.app_account_id into v_operator_account_id
    from private.require_operator_authority(
      p_operator_token, 'expense_store_cash', p_store_id
    ) as authority;
  end if;

  select expense.* into v_existing
  from public.expenses as expense
  where expense.id = p_id
  for update;

  if found then
    if v_existing.funding_source <> 'store_cash' then
      raise exception 'EXPENSE_CENTRAL_IMMUTABLE' using errcode = '55000';
    end if;
    if v_existing.store_id <> p_store_id
      or v_existing.created_by <> p_created_by
      or (v_operator_account_id is not null and
        v_existing.created_by_operator_account_id is distinct from v_operator_account_id) then
      raise exception 'No puedes modificar este gasto' using errcode = '42501';
    end if;
    if v_existing.version = p_base_version + 1
      and v_existing.business_date = p_business_date
      and v_existing.amount = p_amount
      and v_existing.concept = btrim(p_concept)
      and v_existing.payment_method = p_payment_method
      and v_existing.notes is not distinct from nullif(btrim(p_notes), '')
      and v_existing.updated_at = p_updated_at then
      return v_existing;
    end if;
    if v_existing.version <> p_base_version then
      raise exception 'El gasto remoto cambió; requiere revisión' using errcode = '40001';
    end if;

    update public.expenses
    set business_date = p_business_date,
      amount = p_amount,
      concept = btrim(p_concept),
      payment_method = p_payment_method,
      notes = nullif(btrim(p_notes), ''),
      updated_at = p_updated_at,
      version = v_existing.version + 1
    where id = p_id
    returning * into v_expense;
  else
    if p_base_version <> 0 then
      raise exception 'No existe la versión remota esperada del gasto' using errcode = '40001';
    end if;
    insert into public.expenses (
      id, store_id, business_date, amount, concept, payment_method,
      notes, funding_source, source_store_id, created_by,
      created_by_operator_account_id, created_at, updated_at, version
    ) values (
      p_id, p_store_id, p_business_date, p_amount, btrim(p_concept),
      p_payment_method, nullif(btrim(p_notes), ''), 'store_cash', p_store_id,
      auth.uid(), v_operator_account_id, p_created_at, p_updated_at, 1
    ) returning * into v_expense;
  end if;

  return v_expense;
end;
$$;

create or replace function public.sync_expense(
  p_id uuid, p_base_version integer, p_store_id uuid, p_business_date date,
  p_amount numeric, p_concept text, p_payment_method text, p_notes text,
  p_created_at timestamptz, p_updated_at timestamptz, p_created_by uuid
)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'OPERATOR_SESSION_REQUIRED' using errcode = '42501';
  end if;
  return public.sync_expense(
    p_id, p_base_version, p_store_id, p_business_date, p_amount, p_concept,
    p_payment_method, p_notes, p_created_at, p_updated_at, p_created_by, null
  );
end;
$$;

create or replace function public.sync_attendance(
  p_id uuid,
  p_base_version integer,
  p_collaborator_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_status text,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_recorded_by uuid,
  p_operator_token text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.attendance_records;
  v_attendance public.attendance_records;
  v_operator_account_id uuid;
  v_collaborator_store_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if p_recorded_by is distinct from auth.uid() then
    raise exception 'El autor local no corresponde a la sesión' using errcode = '42501';
  end if;
  if p_base_version is null or p_base_version < 0 then
    raise exception 'La versión local no es válida' using errcode = '22023';
  end if;
  if p_attendance_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'FUTURE_ATTENDANCE_NOT_ALLOWED' using errcode = '22007';
  end if;
  if not private.is_admin() then
    select authority.app_account_id into v_operator_account_id
    from private.require_operator_authority(
      p_operator_token, 'attendance', p_store_id
    ) as authority;
  end if;

  select collaborator.store_id into v_collaborator_store_id
  from public.collaborators as collaborator
  where collaborator.id = p_collaborator_id
    and collaborator.status = 'active';
  if v_collaborator_store_id is null
    or v_collaborator_store_id is distinct from p_store_id then
    raise exception 'OPERATOR_STORE_FORBIDDEN' using errcode = '42501';
  end if;

  select attendance.* into v_existing
  from public.attendance_records as attendance
  where attendance.id = p_id
  for update;

  if found then
    if v_existing.store_id <> p_store_id
      or v_existing.collaborator_id <> p_collaborator_id
      or v_existing.attendance_date <> p_attendance_date then
      raise exception 'No puedes cambiar la identidad de una asistencia' using errcode = '42501';
    end if;
    if v_operator_account_id is not null
      and v_existing.recorded_by_operator_account_id is null then
      raise exception 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED' using errcode = '42501';
    end if;
    if v_operator_account_id is not null
      and v_existing.recorded_by_operator_account_id is distinct from v_operator_account_id then
      raise exception 'OPERATOR_CAPABILITY_FORBIDDEN' using errcode = '42501';
    end if;
    if v_existing.version = p_base_version + 1
      and v_existing.status = p_status
      and v_existing.recorded_by = auth.uid()
      and v_existing.recorded_by_operator_account_id is not distinct from v_operator_account_id
      and v_existing.updated_at = p_updated_at then
      return v_existing;
    end if;
    if exists (
      select 1 from public.payment_attendance_items as item
      where item.attendance_id = v_existing.id
    ) then
      raise exception 'PAID_ATTENDANCE_IMMUTABLE' using errcode = '55000';
    end if;
    if v_existing.version <> p_base_version then
      raise exception 'La asistencia remota cambió; requiere revisión' using errcode = '40001';
    end if;

    update public.attendance_records
    set status = p_status,
      recorded_by = auth.uid(),
      recorded_by_operator_account_id = v_operator_account_id,
      updated_at = p_updated_at,
      version = v_existing.version + 1
    where id = p_id
    returning * into v_attendance;
  else
    if p_base_version <> 0 then
      raise exception 'No existe la versión remota esperada de la asistencia' using errcode = '40001';
    end if;
    insert into public.attendance_records (
      id, collaborator_id, store_id, attendance_date, status, recorded_by,
      recorded_by_operator_account_id, created_at, updated_at, version
    ) values (
      p_id, p_collaborator_id, p_store_id, p_attendance_date, p_status,
      auth.uid(), v_operator_account_id, p_created_at, p_updated_at, 1
    ) returning * into v_attendance;
  end if;

  return v_attendance;
end;
$$;

create or replace function public.sync_attendance(
  p_id uuid, p_base_version integer, p_collaborator_id uuid, p_store_id uuid,
  p_attendance_date date, p_status text, p_created_at timestamptz,
  p_updated_at timestamptz, p_recorded_by uuid
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'OPERATOR_SESSION_REQUIRED' using errcode = '42501';
  end if;
  return public.sync_attendance(
    p_id, p_base_version, p_collaborator_id, p_store_id, p_attendance_date,
    p_status, p_created_at, p_updated_at, p_recorded_by, null
  );
end;
$$;

create or replace function public.sync_merchandise_transfer(
  p_id uuid,
  p_base_version integer,
  p_origin_store_id uuid,
  p_destination_store_id uuid,
  p_ticket_number text,
  p_amount numeric,
  p_business_date date,
  p_notes text,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_created_by uuid,
  p_operator_token text
)
returns public.merchandise_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.merchandise_transfers;
  v_transfer public.merchandise_transfers;
  v_operator_account_id uuid;
  v_origin_active boolean;
  v_destination_active boolean;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if p_created_by is distinct from auth.uid() then
    raise exception 'El autor local no corresponde a la sesión' using errcode = '42501';
  end if;
  if p_base_version is null or p_base_version < 0 then
    raise exception 'La versión local no es válida' using errcode = '22023';
  end if;
  if p_origin_store_id is not distinct from p_destination_store_id then
    raise exception 'La tienda de destino debe ser diferente al origen' using errcode = '22023';
  end if;
  if p_business_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'La fecha de la transferencia no puede ser futura' using errcode = '22007';
  end if;
  if not private.is_admin() then
    select authority.app_account_id into v_operator_account_id
    from private.require_operator_authority(
      p_operator_token, 'transfer', p_origin_store_id
    ) as authority;
  end if;

  select transfer.* into v_existing
  from public.merchandise_transfers as transfer
  where transfer.id = p_id
  for update;

  if found then
    if v_existing.origin_store_id <> p_origin_store_id
      or v_existing.created_by <> p_created_by
      or (v_operator_account_id is not null and
        v_existing.created_by_operator_account_id is distinct from v_operator_account_id) then
      raise exception 'No puedes cambiar la identidad de esta transferencia' using errcode = '42501';
    end if;
    if v_existing.version = p_base_version + 1
      and v_existing.destination_store_id = p_destination_store_id
      and v_existing.ticket_number = btrim(p_ticket_number)
      and v_existing.amount = p_amount
      and v_existing.business_date = p_business_date
      and v_existing.notes is not distinct from nullif(btrim(p_notes), '')
      and v_existing.updated_at = p_updated_at then
      return v_existing;
    end if;
    if not private.is_admin() then
      raise exception 'Sólo administración puede corregir transferencias registradas' using errcode = '42501';
    end if;
    if v_existing.version <> p_base_version then
      raise exception 'La transferencia remota cambió; requiere revisión' using errcode = '40001';
    end if;

    update public.merchandise_transfers
    set destination_store_id = p_destination_store_id,
      ticket_number = btrim(p_ticket_number),
      amount = p_amount,
      business_date = p_business_date,
      notes = nullif(btrim(p_notes), ''),
      updated_at = p_updated_at,
      version = v_existing.version + 1
    where id = p_id
    returning * into v_transfer;
  else
    if p_base_version <> 0 then
      raise exception 'No existe la versión remota esperada de la transferencia' using errcode = '40001';
    end if;
    select store.status = 'active' into v_origin_active
    from public.stores as store where store.id = p_origin_store_id;
    select store.status = 'active' into v_destination_active
    from public.stores as store where store.id = p_destination_store_id;
    if not coalesce(v_origin_active, false)
      or not coalesce(v_destination_active, false) then
      raise exception 'El origen y el destino deben ser tiendas activas' using errcode = '22023';
    end if;

    insert into public.merchandise_transfers (
      id, origin_store_id, destination_store_id, ticket_number, amount,
      business_date, notes, created_by, created_by_operator_account_id,
      created_at, updated_at, version
    ) values (
      p_id, p_origin_store_id, p_destination_store_id, btrim(p_ticket_number),
      p_amount, p_business_date, nullif(btrim(p_notes), ''), auth.uid(),
      v_operator_account_id, p_created_at, p_updated_at, 1
    ) returning * into v_transfer;
  end if;

  return v_transfer;
end;
$$;

create or replace function public.sync_merchandise_transfer(
  p_id uuid, p_base_version integer, p_origin_store_id uuid,
  p_destination_store_id uuid, p_ticket_number text, p_amount numeric,
  p_business_date date, p_notes text, p_created_at timestamptz,
  p_updated_at timestamptz, p_created_by uuid
)
returns public.merchandise_transfers
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'OPERATOR_SESSION_REQUIRED' using errcode = '42501';
  end if;
  return public.sync_merchandise_transfer(
    p_id, p_base_version, p_origin_store_id, p_destination_store_id,
    p_ticket_number, p_amount, p_business_date, p_notes, p_created_at,
    p_updated_at, p_created_by, null
  );
end;
$$;

revoke all on function public.sync_expense(
  uuid, integer, uuid, date, numeric, text, text, text,
  timestamptz, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.sync_expense(
  uuid, integer, uuid, date, numeric, text, text, text,
  timestamptz, timestamptz, uuid, text
) from public, anon, authenticated;
revoke all on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, timestamptz, timestamptz, uuid, text
) from public, anon, authenticated;
revoke all on function public.sync_merchandise_transfer(
  uuid, integer, uuid, uuid, text, numeric, date, text,
  timestamptz, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.sync_merchandise_transfer(
  uuid, integer, uuid, uuid, text, numeric, date, text,
  timestamptz, timestamptz, uuid, text
) from public, anon, authenticated;

grant execute on function public.sync_expense(
  uuid, integer, uuid, date, numeric, text, text, text,
  timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function public.sync_expense(
  uuid, integer, uuid, date, numeric, text, text, text,
  timestamptz, timestamptz, uuid, text
) to authenticated;
grant execute on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, timestamptz, timestamptz, uuid, text
) to authenticated;
grant execute on function public.sync_merchandise_transfer(
  uuid, integer, uuid, uuid, text, numeric, date, text,
  timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function public.sync_merchandise_transfer(
  uuid, integer, uuid, uuid, text, numeric, date, text,
  timestamptz, timestamptz, uuid, text
) to authenticated;

-- La firma histórica de create_paid_purchase ya es admin-only. Esta sobrecarga
-- añade el camino store_manager sin abrir Caja Central.
create or replace function public.create_paid_purchase(
  p_purchase_id uuid,
  p_payment_id uuid,
  p_supplier_id uuid,
  p_business_date date,
  p_folio text,
  p_amount numeric,
  p_notes text,
  p_funding_source text,
  p_source_store_id uuid,
  p_payment_method text,
  p_bills jsonb,
  p_coins_amount numeric,
  p_created_at timestamptz,
  p_operator_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_account_id uuid;
  v_supplier public.suppliers;
  v_purchase public.purchases;
  v_payment public.purchase_payments;
  v_existing_purchase public.purchases;
  v_existing_payment public.purchase_payments;
  v_amount numeric(12, 2) := round(p_amount, 2);
  v_coins numeric(12, 2) := round(coalesce(p_coins_amount, 0), 2);
  v_admin_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if private.is_admin() then
    select public.create_paid_purchase(
      p_purchase_id, p_payment_id, p_supplier_id, p_business_date, p_folio,
      p_amount, p_notes, p_funding_source, p_source_store_id,
      p_payment_method, p_bills, p_coins_amount, p_created_at
    ) into v_admin_result;
    return v_admin_result;
  end if;

  if p_funding_source <> 'store_cash' then
    raise exception 'PURCHASE_REQUIRES_ADMIN' using errcode = '42501';
  end if;
  select authority.app_account_id into v_operator_account_id
  from private.require_operator_authority(
    p_operator_token, 'purchase_store_cash', p_source_store_id
  ) as authority;

  if p_purchase_id is null or p_payment_id is null then
    raise exception 'PURCHASE_REQUEST_ID_CONFLICT' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('operations.purchase:' || p_purchase_id::text, 0)
  );

  select purchase.* into v_existing_purchase
  from public.purchases as purchase
  where purchase.id = p_purchase_id;
  if found then
    select payment.* into v_existing_payment
    from public.purchase_payments as payment
    where payment.id = p_payment_id
      and payment.purchase_id = p_purchase_id;
    if not found
      or v_existing_purchase.created_by_operator_account_id
        is distinct from v_operator_account_id
      or v_existing_purchase.supplier_id is distinct from p_supplier_id
      or v_existing_purchase.business_date is distinct from p_business_date
      or v_existing_purchase.folio is distinct from nullif(btrim(p_folio), '')
      or v_existing_purchase.amount is distinct from v_amount
      or v_existing_purchase.notes is distinct from nullif(btrim(p_notes), '')
      or v_existing_payment.amount is distinct from v_amount
      or v_existing_payment.funding_source is distinct from 'store_cash'
      or v_existing_payment.source_store_id is distinct from p_source_store_id
      or v_existing_payment.payment_method is distinct from p_payment_method
      or v_existing_payment.bills is distinct from p_bills
      or v_existing_payment.coins_amount is distinct from v_coins then
      raise exception 'PURCHASE_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'purchase', to_jsonb(v_existing_purchase),
      'payment', to_jsonb(v_existing_payment),
      'movement', null,
      'coin_compensation', null
    );
  end if;

  if exists (select 1 from public.purchase_payments where id = p_payment_id) then
    raise exception 'PURCHASE_REQUEST_ID_CONFLICT' using errcode = '23505';
  end if;
  if p_supplier_id is null then
    raise exception 'PURCHASE_SUPPLIER_REQUIRED' using errcode = '22023';
  end if;
  if p_business_date is null or p_created_at is null
    or p_amount is null or v_amount <= 0 then
    raise exception 'PURCHASE_INVALID_AMOUNT' using errcode = '22023';
  end if;
  if p_business_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'PURCHASE_INVALID_DATE' using errcode = '22007';
  end if;
  if length(coalesce(p_folio, '')) > 80
    or length(coalesce(p_notes, '')) > 500 then
    raise exception 'PURCHASE_INVALID_INPUT' using errcode = '22023';
  end if;

  select supplier.* into v_supplier
  from public.suppliers as supplier
  where supplier.id = p_supplier_id
  for share;
  if not found then
    raise exception 'PURCHASE_SUPPLIER_REQUIRED' using errcode = 'P0001';
  end if;
  if not v_supplier.is_active then
    raise exception 'PURCHASE_SUPPLIER_INACTIVE' using errcode = 'P0001';
  end if;
  if p_payment_method not in ('efectivo', 'tarjeta', 'transferencia', 'otro') then
    raise exception 'PURCHASE_INVALID_PAYMENT_METHOD' using errcode = '22023';
  end if;

  if p_payment_method = 'efectivo' then
    if p_bills is null then
      if v_coins <> 0 then
        raise exception 'PURCHASE_BILLS_MISMATCH' using errcode = '22023';
      end if;
    elsif v_coins < 0
      or not private.operations_central_cash_valid_bills(p_bills)
      or round(private.operations_central_cash_bills_total(p_bills) + v_coins, 2)
        <> v_amount then
      raise exception 'PURCHASE_BILLS_MISMATCH' using errcode = '22023';
    end if;
  elsif p_bills is not null or v_coins <> 0 then
    raise exception 'PURCHASE_BILLS_MISMATCH' using errcode = '22023';
  end if;

  insert into public.purchases (
    id, supplier_id, supplier_name_snapshot, business_date, folio,
    amount, notes, created_by, created_by_operator_account_id,
    created_at, updated_at
  ) values (
    p_purchase_id, v_supplier.id, v_supplier.name, p_business_date,
    nullif(btrim(p_folio), ''), v_amount, nullif(btrim(p_notes), ''),
    auth.uid(), v_operator_account_id, p_created_at, p_created_at
  ) returning * into v_purchase;

  insert into public.purchase_payments (
    id, purchase_id, amount, funding_source, source_store_id,
    payment_method, bills, coins_amount, paid_at, created_by, created_at
  ) values (
    p_payment_id, v_purchase.id, v_amount, 'store_cash', p_source_store_id,
    p_payment_method, case when p_payment_method = 'efectivo' then p_bills else null end,
    v_coins, p_created_at, auth.uid(), p_created_at
  ) returning * into v_payment;

  return jsonb_build_object(
    'purchase', to_jsonb(v_purchase),
    'payment', to_jsonb(v_payment),
    'movement', null,
    'coin_compensation', null
  );
exception when unique_violation then
  raise exception 'PURCHASE_REQUEST_ID_CONFLICT' using errcode = '23505';
end;
$$;

revoke all on function public.create_paid_purchase(
  uuid, uuid, uuid, date, text, numeric, text, text, uuid, text,
  jsonb, numeric, timestamptz
) from public, anon, authenticated;
revoke all on function public.create_paid_purchase(
  uuid, uuid, uuid, date, text, numeric, text, text, uuid, text,
  jsonb, numeric, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.create_paid_purchase(
  uuid, uuid, uuid, date, text, numeric, text, text, uuid, text,
  jsonb, numeric, timestamptz
) to authenticated;
grant execute on function public.create_paid_purchase(
  uuid, uuid, uuid, date, text, numeric, text, text, uuid, text,
  jsonb, numeric, timestamptz, text
) to authenticated;

create or replace function public.get_cash_closing_candidates(
  p_store_id uuid,
  p_business_date date,
  p_operator_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expenses jsonb;
  v_transfers jsonb;
  v_payments jsonb;
  v_purchases jsonb;
begin
  if private.is_admin() then
    return public.get_cash_closing_candidates(p_store_id, p_business_date);
  end if;
  perform 1
  from private.require_operator_authority(
    p_operator_token, 'cash_closing', p_store_id
  );
  if p_business_date is null then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(expense) order by expense.created_at), '[]'::jsonb)
  into v_expenses
  from public.expenses as expense
  where expense.store_id = p_store_id
    and expense.business_date = p_business_date
    and expense.funding_source = 'store_cash'
    and not exists (
      select 1 from public.cash_closing_expense_items as item
      where item.expense_id = expense.id
    );

  select coalesce(jsonb_agg(to_jsonb(transfer) order by transfer.created_at), '[]'::jsonb)
  into v_transfers
  from public.merchandise_transfers as transfer
  where transfer.origin_store_id = p_store_id
    and transfer.business_date = p_business_date
    and not exists (
      select 1 from public.cash_closing_transfer_items as item
      where item.transfer_id = transfer.id
    );

  -- Sólo nombre/monto necesarios para seleccionar y conciliar el Corte.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', payment.id,
    'collaborator_name_snapshot', payment.collaborator_name_snapshot,
    'paid_amount', payment.paid_amount
  ) order by payment.created_at), '[]'::jsonb)
  into v_payments
  from public.collaborator_payments as payment
  where payment.funding_source = 'store_cash'
    and payment.source_store_id = p_store_id
    and payment.business_date = p_business_date
    and not exists (
      select 1 from public.cash_closing_payment_items as item
      where item.payment_id = payment.id
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'purchase', to_jsonb(purchase), 'payment', to_jsonb(payment)
  ) order by purchase.created_at), '[]'::jsonb)
  into v_purchases
  from public.purchase_payments as payment
  join public.purchases as purchase on purchase.id = payment.purchase_id
  where payment.funding_source = 'store_cash'
    and payment.source_store_id = p_store_id
    and purchase.business_date = p_business_date
    and not exists (
      select 1 from public.cash_closing_purchase_items as item
      where item.purchase_payment_id = payment.id
    );

  return jsonb_build_object(
    'expenses', v_expenses,
    'transfers', v_transfers,
    'payments', v_payments,
    'purchases', v_purchases
  );
end;
$$;

create or replace function public.list_cash_closings(
  p_operator_token text,
  p_store_id uuid,
  p_date_from date,
  p_date_to date
)
returns setof public.cash_closings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store_id uuid := p_store_id;
  v_session record;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if not private.is_admin() then
    select * into v_session
    from private.require_operator_session(p_operator_token);
    if not private.operator_has_capability(v_session.role, 'cash_closing') then
      raise exception 'OPERATOR_CAPABILITY_FORBIDDEN' using errcode = '42501';
    end if;
    if p_store_id is not null and p_store_id is distinct from v_session.store_id then
      raise exception 'OPERATOR_STORE_FORBIDDEN' using errcode = '42501';
    end if;
    v_store_id := v_session.store_id;
  end if;

  return query
  select closing.*
  from public.cash_closings as closing
  where closing.status = 'closed'
    and (v_store_id is null or closing.store_id = v_store_id)
    and (p_date_from is null or closing.business_date >= p_date_from)
    and (p_date_to is null or closing.business_date <= p_date_to)
  order by closing.business_date desc, closing.closing_number desc;
end;
$$;

create or replace function public.get_cash_closing_detail(
  p_operator_token text,
  p_closing_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_closing public.cash_closings;
  v_session record;
  v_is_admin boolean := private.is_admin();
  v_expenses jsonb;
  v_transfers jsonb;
  v_payments jsonb;
  v_purchases jsonb;
  v_adjustments jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  select closing.* into v_closing
  from public.cash_closings as closing
  where closing.id = p_closing_id;
  if not found then
    raise exception 'CLOSING_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    select * into v_session
    from private.require_operator_authority(
      p_operator_token, 'cash_closing', v_closing.store_id
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at), '[]'::jsonb)
  into v_expenses
  from public.cash_closing_expense_items as item
  where item.cash_closing_id = p_closing_id;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at), '[]'::jsonb)
  into v_transfers
  from public.cash_closing_transfer_items as item
  where item.cash_closing_id = p_closing_id;
  select coalesce(jsonb_agg(
    case when v_is_admin then to_jsonb(item) else jsonb_build_object(
      'cash_closing_id', item.cash_closing_id,
      'payment_id', item.payment_id,
      'amount_snapshot', item.amount_snapshot,
      'collaborator_name_snapshot', item.collaborator_name_snapshot,
      'created_at', item.created_at
    ) end order by item.created_at
  ), '[]'::jsonb)
  into v_payments
  from public.cash_closing_payment_items as item
  where item.cash_closing_id = p_closing_id;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at), '[]'::jsonb)
  into v_purchases
  from public.cash_closing_purchase_items as item
  where item.cash_closing_id = p_closing_id;

  if v_is_admin then
    select coalesce(jsonb_agg(to_jsonb(adjustment) order by adjustment.created_at), '[]'::jsonb)
    into v_adjustments
    from public.cash_closing_adjustments as adjustment
    where adjustment.cash_closing_id = p_closing_id;
  end if;

  return jsonb_build_object(
    'closing', to_jsonb(v_closing),
    'expenses', v_expenses,
    'transfers', v_transfers,
    'payments', v_payments,
    'purchases', v_purchases,
    'adjustments', v_adjustments
  );
end;
$$;

revoke all on function public.get_cash_closing_candidates(uuid, date)
  from public, anon, authenticated;
revoke all on function public.get_cash_closing_candidates(uuid, date, text)
  from public, anon, authenticated;
revoke all on function public.list_cash_closings(text, uuid, date, date)
  from public, anon, authenticated;
revoke all on function public.get_cash_closing_detail(text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_cash_closing_candidates(uuid, date)
  to authenticated;
grant execute on function public.get_cash_closing_candidates(uuid, date, text)
  to authenticated;
grant execute on function public.list_cash_closings(text, uuid, date, date)
  to authenticated;
grant execute on function public.get_cash_closing_detail(text, uuid)
  to authenticated;

create or replace function public.close_cash_closing(
  p_id uuid,
  p_store_id uuid,
  p_business_date date,
  p_gross_sales numeric,
  p_bills jsonb,
  p_balance_bills jsonb,
  p_notes text,
  p_expense_ids uuid[],
  p_transfer_ids uuid[],
  p_payment_ids uuid[],
  p_purchase_payment_ids uuid[],
  p_closing_reconciliation_mode text,
  p_operator_token text
)
returns public.cash_closings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_account_id uuid;
  v_expense_ids uuid[] := coalesce(p_expense_ids, '{}'::uuid[]);
  v_transfer_ids uuid[] := coalesce(p_transfer_ids, '{}'::uuid[]);
  v_payment_ids uuid[] := coalesce(p_payment_ids, '{}'::uuid[]);
  v_purchase_payment_ids uuid[] := coalesce(p_purchase_payment_ids, '{}'::uuid[]);
  v_existing public.cash_closings;
  v_closing public.cash_closings;
  v_closing_number integer;
  v_expenses_total numeric(12, 2);
  v_cash_expenses_total numeric(12, 2);
  v_outgoing_transfers_total numeric(12, 2);
  v_store_cash_payments_total numeric(12, 2);
  v_purchases_total numeric(12, 2);
  v_cash_purchases_total numeric(12, 2);
  v_operational_outflows_total numeric(12, 2);
  v_cash_outflows_total numeric(12, 2);
  v_counted_cash numeric(12, 2);
  v_cash_balance numeric(12, 2);
  v_cash_to_withdraw numeric(12, 2);
  v_expected_cash numeric(12, 2);
  v_difference numeric(12, 2);
  v_withdraw_bills jsonb;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if private.is_admin() then
    return public.close_cash_closing(
      p_id, p_store_id, p_business_date, p_gross_sales, p_bills,
      p_balance_bills, p_notes, p_expense_ids, p_transfer_ids,
      p_payment_ids, p_purchase_payment_ids, p_closing_reconciliation_mode
    );
  end if;

  select authority.app_account_id into v_operator_account_id
  from private.require_operator_authority(
    p_operator_token, 'cash_closing', p_store_id
  ) as authority;

  if p_id is null or p_store_id is null or p_business_date is null then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND' using errcode = '22023';
  end if;
  if p_closing_reconciliation_mode not in ('normal', 'sicar') then
    raise exception 'CLOSING_RECONCILIATION_MODE_INVALID' using errcode = '22023';
  end if;
  if p_business_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'La fecha del corte no puede ser futura' using errcode = '22007';
  end if;
  if p_gross_sales is null or p_gross_sales < 0
    or p_gross_sales <> round(p_gross_sales, 2) then
    raise exception 'Las ventas brutas no son válidas' using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Las notas no pueden exceder 1000 caracteres' using errcode = '22023';
  end if;
  if cardinality(v_expense_ids) <> (
    select count(distinct selected.id) from unnest(v_expense_ids) as selected(id)
  ) or cardinality(v_transfer_ids) <> (
    select count(distinct selected.id) from unnest(v_transfer_ids) as selected(id)
  ) or cardinality(v_payment_ids) <> (
    select count(distinct selected.id) from unnest(v_payment_ids) as selected(id)
  ) or cardinality(v_purchase_payment_ids) <> (
    select count(distinct selected.id) from unnest(v_purchase_payment_ids) as selected(id)
  ) then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_store_id::text || ':' || p_business_date::text, 0
  ));

  select closing.* into v_existing
  from public.cash_closings as closing
  where closing.id = p_id
  for update;
  if found then
    if v_existing.store_id = p_store_id
      and v_existing.business_date = p_business_date
      and v_existing.status = 'closed'
      and v_existing.closed_by_operator_account_id = v_operator_account_id
      and not exists (
        (select unnest(v_expense_ids)) except
        (select item.expense_id from public.cash_closing_expense_items item
         where item.cash_closing_id = p_id)
      ) and not exists (
        (select item.expense_id from public.cash_closing_expense_items item
         where item.cash_closing_id = p_id) except
        (select unnest(v_expense_ids))
      ) and not exists (
        (select unnest(v_transfer_ids)) except
        (select item.transfer_id from public.cash_closing_transfer_items item
         where item.cash_closing_id = p_id)
      ) and not exists (
        (select item.transfer_id from public.cash_closing_transfer_items item
         where item.cash_closing_id = p_id) except
        (select unnest(v_transfer_ids))
      ) and not exists (
        (select unnest(v_payment_ids)) except
        (select item.payment_id from public.cash_closing_payment_items item
         where item.cash_closing_id = p_id)
      ) and not exists (
        (select item.payment_id from public.cash_closing_payment_items item
         where item.cash_closing_id = p_id) except
        (select unnest(v_payment_ids))
      ) and not exists (
        (select unnest(v_purchase_payment_ids)) except
        (select item.purchase_payment_id from public.cash_closing_purchase_items item
         where item.cash_closing_id = p_id)
      ) and not exists (
        (select item.purchase_payment_id from public.cash_closing_purchase_items item
         where item.cash_closing_id = p_id) except
        (select unnest(v_purchase_payment_ids))
      ) then
      return v_existing;
    end if;
    raise exception 'CLOSING_ALREADY_EXISTS' using errcode = '23505';
  end if;

  perform 1 from public.expenses as expense
  where expense.id = any(v_expense_ids) order by expense.id for update;
  perform 1 from public.merchandise_transfers as transfer
  where transfer.id = any(v_transfer_ids) order by transfer.id for update;
  perform 1 from public.collaborator_payments as payment
  where payment.id = any(v_payment_ids) order by payment.id for update;
  perform 1 from public.purchase_payments as payment
  where payment.id = any(v_purchase_payment_ids) order by payment.id for update;

  if cardinality(v_expense_ids) <> (
    select count(*) from public.expenses as expense
    where expense.id = any(v_expense_ids)
      and expense.store_id = p_store_id
      and expense.business_date = p_business_date
      and expense.funding_source = 'store_cash'
  ) or cardinality(v_transfer_ids) <> (
    select count(*) from public.merchandise_transfers as transfer
    where transfer.id = any(v_transfer_ids)
      and transfer.origin_store_id = p_store_id
      and transfer.business_date = p_business_date
  ) or cardinality(v_payment_ids) <> (
    select count(*) from public.collaborator_payments as payment
    where payment.id = any(v_payment_ids)
      and payment.funding_source = 'store_cash'
      and payment.source_store_id = p_store_id
      and payment.business_date = p_business_date
  ) or cardinality(v_purchase_payment_ids) <> (
    select count(*)
    from public.purchase_payments as payment
    join public.purchases as purchase on purchase.id = payment.purchase_id
    where payment.id = any(v_purchase_payment_ids)
      and payment.funding_source = 'store_cash'
      and payment.source_store_id = p_store_id
      and purchase.business_date = p_business_date
  ) then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.cash_closing_expense_items
    where expense_id = any(v_expense_ids)
  ) or exists (
    select 1 from public.cash_closing_transfer_items
    where transfer_id = any(v_transfer_ids)
  ) or exists (
    select 1 from public.cash_closing_payment_items
    where payment_id = any(v_payment_ids)
  ) or exists (
    select 1 from public.cash_closing_purchase_items
    where purchase_payment_id = any(v_purchase_payment_ids)
  ) then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED' using errcode = 'P0001';
  end if;

  if p_bills is null or p_balance_bills is null
    or jsonb_typeof(p_bills) <> 'object'
    or jsonb_typeof(p_balance_bills) <> 'object' then
    raise exception 'El desglose de efectivo es obligatorio' using errcode = '22023';
  end if;
  if exists (
    select 1 from (values
      ('b1000'), ('b500'), ('b200'), ('b100'), ('b50'), ('b20'), ('monedas')
    ) as denomination(key)
    where (p_bills ? denomination.key
      and jsonb_typeof(p_bills -> denomination.key) <> 'number')
      or (p_balance_bills ? denomination.key
        and jsonb_typeof(p_balance_bills -> denomination.key) <> 'number')
  ) then
    raise exception 'El desglose de efectivo no es válido' using errcode = '22023';
  end if;

  v_counted_cash := round(
    coalesce((p_bills ->> 'b1000')::numeric, 0) * 1000
    + coalesce((p_bills ->> 'b500')::numeric, 0) * 500
    + coalesce((p_bills ->> 'b200')::numeric, 0) * 200
    + coalesce((p_bills ->> 'b100')::numeric, 0) * 100
    + coalesce((p_bills ->> 'b50')::numeric, 0) * 50
    + coalesce((p_bills ->> 'b20')::numeric, 0) * 20
    + coalesce((p_bills ->> 'monedas')::numeric, 0), 2
  );
  v_cash_balance := round(
    coalesce((p_balance_bills ->> 'b1000')::numeric, 0) * 1000
    + coalesce((p_balance_bills ->> 'b500')::numeric, 0) * 500
    + coalesce((p_balance_bills ->> 'b200')::numeric, 0) * 200
    + coalesce((p_balance_bills ->> 'b100')::numeric, 0) * 100
    + coalesce((p_balance_bills ->> 'b50')::numeric, 0) * 50
    + coalesce((p_balance_bills ->> 'b20')::numeric, 0) * 20
    + coalesce((p_balance_bills ->> 'monedas')::numeric, 0), 2
  );

  if exists (
    select 1 from (values
      ('b1000'), ('b500'), ('b200'), ('b100'), ('b50'), ('b20')
    ) as denomination(key)
    where coalesce((p_bills ->> denomination.key)::numeric, 0) < 0
      or coalesce((p_bills ->> denomination.key)::numeric, 0) <>
        trunc(coalesce((p_bills ->> denomination.key)::numeric, 0))
      or coalesce((p_balance_bills ->> denomination.key)::numeric, 0) < 0
      or coalesce((p_balance_bills ->> denomination.key)::numeric, 0) <>
        trunc(coalesce((p_balance_bills ->> denomination.key)::numeric, 0))
      or coalesce((p_balance_bills ->> denomination.key)::numeric, 0) >
        coalesce((p_bills ->> denomination.key)::numeric, 0)
  ) or coalesce((p_bills ->> 'monedas')::numeric, 0) < 0
    or coalesce((p_bills ->> 'monedas')::numeric, 0) <>
      round(coalesce((p_bills ->> 'monedas')::numeric, 0), 2)
    or coalesce((p_balance_bills ->> 'monedas')::numeric, 0) < 0
    or coalesce((p_balance_bills ->> 'monedas')::numeric, 0) <>
      round(coalesce((p_balance_bills ->> 'monedas')::numeric, 0), 2)
    or coalesce((p_balance_bills ->> 'monedas')::numeric, 0) >
      coalesce((p_bills ->> 'monedas')::numeric, 0) then
    raise exception 'El saldo de caja no puede superar el efectivo contado' using errcode = '22023';
  end if;

  select coalesce(sum(expense.amount), 0),
    coalesce(sum(expense.amount) filter (where expense.payment_method = 'efectivo'), 0)
  into v_expenses_total, v_cash_expenses_total
  from public.expenses as expense where expense.id = any(v_expense_ids);
  select coalesce(sum(transfer.amount), 0)
  into v_outgoing_transfers_total
  from public.merchandise_transfers as transfer where transfer.id = any(v_transfer_ids);
  select coalesce(sum(payment.paid_amount), 0)
  into v_store_cash_payments_total
  from public.collaborator_payments as payment where payment.id = any(v_payment_ids);
  select coalesce(sum(payment.amount), 0),
    coalesce(sum(payment.amount) filter (where payment.payment_method = 'efectivo'), 0)
  into v_purchases_total, v_cash_purchases_total
  from public.purchase_payments as payment where payment.id = any(v_purchase_payment_ids);

  v_operational_outflows_total := round(
    v_expenses_total + v_outgoing_transfers_total
    + v_store_cash_payments_total + v_purchases_total, 2
  );
  v_cash_outflows_total := round(
    v_cash_expenses_total + v_store_cash_payments_total + v_cash_purchases_total, 2
  );
  v_cash_to_withdraw := round(v_counted_cash - v_cash_balance, 2);
  v_expected_cash := round(
    p_gross_sales - v_cash_outflows_total
    - case when p_closing_reconciliation_mode = 'sicar'
        then v_outgoing_transfers_total else 0 end, 2
  );
  v_difference := round(v_counted_cash - v_expected_cash, 2);
  v_withdraw_bills := jsonb_build_object(
    'b1000', coalesce((p_bills ->> 'b1000')::numeric, 0) - coalesce((p_balance_bills ->> 'b1000')::numeric, 0),
    'b500', coalesce((p_bills ->> 'b500')::numeric, 0) - coalesce((p_balance_bills ->> 'b500')::numeric, 0),
    'b200', coalesce((p_bills ->> 'b200')::numeric, 0) - coalesce((p_balance_bills ->> 'b200')::numeric, 0),
    'b100', coalesce((p_bills ->> 'b100')::numeric, 0) - coalesce((p_balance_bills ->> 'b100')::numeric, 0),
    'b50', coalesce((p_bills ->> 'b50')::numeric, 0) - coalesce((p_balance_bills ->> 'b50')::numeric, 0),
    'b20', coalesce((p_bills ->> 'b20')::numeric, 0) - coalesce((p_balance_bills ->> 'b20')::numeric, 0),
    'monedas', coalesce((p_bills ->> 'monedas')::numeric, 0) - coalesce((p_balance_bills ->> 'monedas')::numeric, 0)
  );

  select coalesce(max(closing.closing_number), 0) + 1
  into v_closing_number
  from public.cash_closings as closing
  where closing.store_id = p_store_id
    and closing.business_date = p_business_date;

  begin
    insert into public.cash_closings (
      id, store_id, business_date, closing_number, gross_sales,
      closing_reconciliation_mode, expense_total, cash_expense_total,
      expenses_total_snapshot, cash_expenses_total_snapshot,
      outgoing_transfers_total_snapshot, store_cash_payments_total_snapshot,
      purchases_total_snapshot, cash_purchases_total_snapshot,
      operational_outflows_total_snapshot, cash_outflows_total_snapshot,
      other_movements, opening_balance, counted_cash, cash_balance,
      cash_to_withdraw, expected_cash, difference, bills, balance_bills,
      withdraw_bills, notes, status, closed_at, closed_by, created_by,
      closed_by_operator_account_id
    ) values (
      p_id, p_store_id, p_business_date, v_closing_number, p_gross_sales,
      p_closing_reconciliation_mode, v_expenses_total, v_cash_expenses_total,
      v_expenses_total, v_cash_expenses_total, v_outgoing_transfers_total,
      v_store_cash_payments_total, v_purchases_total, v_cash_purchases_total,
      v_operational_outflows_total, v_cash_outflows_total, 0, 0,
      v_counted_cash, v_cash_balance, v_cash_to_withdraw, v_expected_cash,
      v_difference, p_bills, p_balance_bills, v_withdraw_bills,
      nullif(btrim(p_notes), ''), 'closed', now(), auth.uid(), auth.uid(),
      v_operator_account_id
    ) returning * into v_closing;

    insert into public.cash_closing_expense_items (
      cash_closing_id, expense_id, amount_snapshot, concept_snapshot,
      payment_method_snapshot
    ) select v_closing.id, expense.id, expense.amount, expense.concept,
      expense.payment_method
    from public.expenses as expense where expense.id = any(v_expense_ids);

    insert into public.cash_closing_transfer_items (
      cash_closing_id, transfer_id, amount_snapshot, ticket_number_snapshot
    ) select v_closing.id, transfer.id, transfer.amount, transfer.ticket_number
    from public.merchandise_transfers as transfer where transfer.id = any(v_transfer_ids);

    insert into public.cash_closing_payment_items (
      cash_closing_id, payment_id, amount_snapshot, collaborator_name_snapshot
    ) select v_closing.id, payment.id, payment.paid_amount,
      payment.collaborator_name_snapshot
    from public.collaborator_payments as payment where payment.id = any(v_payment_ids);

    insert into public.cash_closing_purchase_items (
      cash_closing_id, purchase_id, purchase_payment_id, supplier_id,
      supplier_name_snapshot, folio_snapshot, amount_snapshot,
      payment_method_snapshot, business_date_snapshot
    ) select v_closing.id, purchase.id, payment.id, purchase.supplier_id,
      purchase.supplier_name_snapshot, purchase.folio, payment.amount,
      payment.payment_method, purchase.business_date
    from public.purchase_payments as payment
    join public.purchases as purchase on purchase.id = payment.purchase_id
    where payment.id = any(v_purchase_payment_ids);
  exception when unique_violation then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED' using errcode = 'P0001';
  end;

  return v_closing;
end;
$$;

-- Algunas instalaciones ya eliminaron la firma histórica de 7 argumentos.
-- La revocación sigue siendo exacta, pero tolera que un overload ya no exista.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.close_cash_closing(uuid,uuid,date,numeric,jsonb,jsonb,text)',
    'public.close_cash_closing(uuid,uuid,date,numeric,jsonb,jsonb,text,uuid[],uuid[])',
    'public.close_cash_closing(uuid,uuid,date,numeric,jsonb,jsonb,text,uuid[],uuid[],uuid[])',
    'public.close_cash_closing(uuid,uuid,date,numeric,jsonb,jsonb,text,uuid[],uuid[],uuid[],uuid[])',
    'public.close_cash_closing(uuid,uuid,date,numeric,jsonb,jsonb,text,uuid[],uuid[],uuid[],uuid[],text)',
    'public.close_cash_closing(uuid,uuid,date,numeric,jsonb,jsonb,text,uuid[],uuid[],uuid[],uuid[],text,text)'
  ]
  loop
    if pg_catalog.to_regprocedure(v_signature) is not null then
      execute pg_catalog.format(
        'revoke all on function %s from public, anon, authenticated',
        v_signature
      );
    end if;
  end loop;
end;
$$;

-- Sólo quedan ejecutables la firma admin actual (12 args) y la protegida (13).
grant execute on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[],
  uuid[], text
) to authenticated;
grant execute on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[],
  uuid[], text, text
) to authenticated;

comment on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[],
  uuid[], text, text
) is
  'Cierra un Corte para admin o store_manager; identidad, capacidad, tienda y autoría operativa se resuelven server-side.';
