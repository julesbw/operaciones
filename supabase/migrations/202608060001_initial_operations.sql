-- Operaciones MVP sobre el proyecto compartido de Arrendamientos.
-- Requiere que 202607310001_initial_schema.sql de Arrendamientos ya esté aplicada.
create extension if not exists pgcrypto;

-- Extiende la identidad existente; no reemplaza auth, profiles, roles ni private.is_admin().
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (
    length(btrim(name)) > 0 and length(name) <= 100
  ),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index stores_normalized_name_key
  on public.stores (lower(btrim(name)));

alter table public.profiles
  add column store_id uuid references public.stores(id) on delete restrict;

create index profiles_store_id_idx on public.profiles(store_id);

create table public.collaborators (
  id uuid primary key default gen_random_uuid(),
  name text not null check (
    length(btrim(name)) > 0 and length(name) <= 120
  ),
  store_id uuid not null references public.stores(id) on delete restrict,
  rest_day smallint not null check (rest_day between 0 and 6),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- La compensación vive separada para que una cajera nunca descargue weekly_pay.
create table public.collaborator_compensation (
  collaborator_id uuid primary key references public.collaborators(id) on delete restrict,
  weekly_pay numeric(12, 2) not null check (
    weekly_pay >= 0 and weekly_pay = round(weekly_pay, 2)
  ),
  effective_from date not null default current_date,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references public.collaborators(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  attendance_date date not null,
  status text not null check (status in ('present', 'absent', 'rest_day')),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint attendance_collaborator_date_key
    unique (collaborator_id, attendance_date)
);

create table public.weekly_payments (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references public.collaborators(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  weekly_pay_snapshot numeric(12, 2) not null check (weekly_pay_snapshot >= 0),
  daily_pay_snapshot numeric(12, 2) not null check (daily_pay_snapshot >= 0),
  worked_days smallint not null check (worked_days between 0 and 6),
  suggested_amount numeric(12, 2) not null check (suggested_amount >= 0),
  paid_amount numeric(12, 2) not null check (paid_amount >= 0),
  payment_method text not null
    check (payment_method in ('efectivo', 'tarjeta', 'transferencia', 'otro')),
  payment_notes text check (payment_notes is null or length(payment_notes) <= 500),
  paid_at timestamptz not null default now(),
  paid_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint weekly_payments_collaborator_period_key
    unique (collaborator_id, period_start, period_end),
  constraint weekly_payments_period_check check (period_end >= period_start)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  business_date date not null,
  amount numeric(12, 2) not null check (
    amount > 0 and amount = round(amount, 2)
  ),
  concept text not null check (
    length(btrim(concept)) > 0 and length(concept) <= 160
  ),
  payment_method text not null
    check (payment_method in ('efectivo', 'tarjeta', 'transferencia', 'otro')),
  notes text check (notes is null or length(notes) <= 500),
  weekly_payment_id uuid unique references public.weekly_payments(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create table public.cash_closings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  business_date date not null,
  gross_sales numeric(12, 2) not null check (gross_sales >= 0),
  expense_total numeric(12, 2) not null check (expense_total >= 0),
  other_movements numeric(12, 2) not null default 0,
  opening_balance numeric(12, 2) not null default 0 check (opening_balance >= 0),
  counted_cash numeric(12, 2) not null check (counted_cash >= 0),
  expected_cash numeric(12, 2) not null,
  difference numeric(12, 2) not null,
  bills jsonb not null default
    '{"b1000":0,"b500":0,"b200":0,"b100":0,"b50":0,"b20":0,"monedas":0}'::jsonb,
  notes text check (notes is null or length(notes) <= 1000),
  status text not null default 'closed'
    check (status in ('closed', 'reopened')),
  closed_at timestamptz not null default now(),
  closed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_closings_store_date_key unique (store_id, business_date)
);

create index collaborators_store_status_idx
  on public.collaborators(store_id, status);
create index attendance_store_date_idx
  on public.attendance_records(store_id, attendance_date desc);
create index payments_store_period_idx
  on public.weekly_payments(store_id, period_start desc);
create index expenses_store_date_idx
  on public.expenses(store_id, business_date desc);
create index closings_store_date_idx
  on public.cash_closings(store_id, business_date desc);

-- Reutiliza el trigger de auditoría creado por Arrendamientos.
create trigger stores_set_updated_at
before update on public.stores
for each row execute function private.set_updated_at();
create trigger collaborators_set_updated_at
before update on public.collaborators
for each row execute function private.set_updated_at();
create trigger compensation_set_updated_at
before update on public.collaborator_compensation
for each row execute function private.set_updated_at();
create trigger closings_set_updated_at
before update on public.cash_closings
for each row execute function private.set_updated_at();

create or replace function private.operations_current_store_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.store_id
  from public.profiles as profile
  where profile.id = (select auth.uid());
$$;

create or replace function private.operations_validate_attendance_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  select collaborator.store_id into v_store_id
  from public.collaborators as collaborator
  where collaborator.id = new.collaborator_id;

  if v_store_id is null or v_store_id <> new.store_id then
    raise exception 'La tienda no corresponde al colaborador' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger attendance_validate_store
before insert or update on public.attendance_records
for each row execute function private.operations_validate_attendance_store();

-- Escrituras offline idempotentes con autorización dentro de PostgreSQL.
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
  p_created_by uuid
)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.expenses;
  v_expense public.expenses;
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
  if not private.is_admin()
    and p_store_id is distinct from private.operations_current_store_id() then
    raise exception 'No puedes registrar gastos de otra tienda' using errcode = '42501';
  end if;

  select expense.* into v_existing
  from public.expenses as expense
  where expense.id = p_id
  for update;

  if found then
    if v_existing.store_id <> p_store_id
      or v_existing.created_by <> p_created_by then
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
    set
      business_date = p_business_date,
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
      notes, created_by, created_at, updated_at, version
    )
    values (
      p_id, p_store_id, p_business_date, p_amount, btrim(p_concept),
      p_payment_method, nullif(btrim(p_notes), ''), p_created_by,
      p_created_at, p_updated_at, 1
    )
    returning * into v_expense;
  end if;

  return v_expense;
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
  p_recorded_by uuid
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.attendance_records;
  v_attendance public.attendance_records;
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
  if not private.is_admin()
    and p_store_id is distinct from private.operations_current_store_id() then
    raise exception 'No puedes registrar asistencias de otra tienda' using errcode = '42501';
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
    if v_existing.version = p_base_version + 1
      and v_existing.status = p_status
      and v_existing.recorded_by = p_recorded_by
      and v_existing.updated_at = p_updated_at then
      return v_existing;
    end if;
    if v_existing.version <> p_base_version then
      raise exception 'La asistencia remota cambió; requiere revisión' using errcode = '40001';
    end if;

    update public.attendance_records
    set
      status = p_status,
      recorded_by = p_recorded_by,
      updated_at = p_updated_at,
      version = v_existing.version + 1
    where id = p_id
    returning * into v_attendance;
  else
    if p_base_version <> 0 then
      raise exception 'No existe la versión remota esperada de la asistencia' using errcode = '40001';
    end if;
    insert into public.attendance_records (
      id, collaborator_id, store_id, attendance_date, status,
      recorded_by, created_at, updated_at, version
    )
    values (
      p_id, p_collaborator_id, p_store_id, p_attendance_date, p_status,
      p_recorded_by, p_created_at, p_updated_at, 1
    )
    returning * into v_attendance;
  end if;

  return v_attendance;
end;
$$;

-- Registra decisión humana, snapshots y gasto financiero en una sola transacción.
create or replace function public.register_weekly_payment(
  p_collaborator_id uuid,
  p_period_start date,
  p_period_end date,
  p_weekly_pay_snapshot numeric,
  p_worked_days smallint,
  p_suggested_amount numeric,
  p_paid_amount numeric,
  p_paid_at timestamptz,
  p_payment_method text,
  p_payment_notes text default null
)
returns public.weekly_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collaborator public.collaborators;
  v_payment public.weekly_payments;
  v_daily_pay numeric;
  v_expected_suggestion numeric;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo un administrador puede registrar pagos' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end < p_period_start then
    raise exception 'El periodo de pago no es válido' using errcode = '22007';
  end if;
  if p_weekly_pay_snapshot < 0 or p_worked_days not between 0 and 6
    or p_suggested_amount < 0 or p_paid_amount < 0 then
    raise exception 'Los importes o días trabajados no son válidos' using errcode = '22003';
  end if;

  v_daily_pay := floor(p_weekly_pay_snapshot / 6);
  v_expected_suggestion := case
    when p_worked_days = 6 then p_weekly_pay_snapshot
    else v_daily_pay * p_worked_days
  end;
  if p_suggested_amount <> v_expected_suggestion then
    raise exception 'El pago sugerido no corresponde a la regla vigente' using errcode = '22003';
  end if;

  select collaborator.* into v_collaborator
  from public.collaborators as collaborator
  where collaborator.id = p_collaborator_id;
  if not found then
    raise exception 'El colaborador no existe' using errcode = 'P0002';
  end if;

  insert into public.weekly_payments (
    collaborator_id, store_id, period_start, period_end,
    weekly_pay_snapshot, daily_pay_snapshot, worked_days,
    suggested_amount, paid_amount, payment_method, payment_notes,
    paid_at, paid_by
  )
  values (
    v_collaborator.id, v_collaborator.store_id, p_period_start, p_period_end,
    p_weekly_pay_snapshot, v_daily_pay, p_worked_days,
    p_suggested_amount, p_paid_amount, p_payment_method,
    nullif(btrim(p_payment_notes), ''), p_paid_at, auth.uid()
  )
  returning * into v_payment;

  if p_paid_amount > 0 then
    insert into public.expenses (
      store_id, business_date, amount, concept, payment_method,
      notes, weekly_payment_id, created_by
    )
    values (
      v_collaborator.store_id,
      (p_paid_at at time zone 'America/Mexico_City')::date,
      p_paid_amount,
      'Pago semanal - ' || v_collaborator.name,
      p_payment_method,
      nullif(btrim(p_payment_notes), ''),
      v_payment.id,
      auth.uid()
    );
  end if;

  return v_payment;
end;
$$;

alter table public.stores enable row level security;
alter table public.collaborators enable row level security;
alter table public.collaborator_compensation enable row level security;
alter table public.attendance_records enable row level security;
alter table public.weekly_payments enable row level security;
alter table public.expenses enable row level security;
alter table public.cash_closings enable row level security;

create policy "users can read assigned stores and admins can read all"
on public.stores for select to authenticated
using (
  (select private.is_admin())
  or id = (select private.operations_current_store_id())
);
create policy "admins can insert stores"
on public.stores for insert to authenticated
with check ((select private.is_admin()));
create policy "admins can update stores"
on public.stores for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "users can read active collaborators in their store"
on public.collaborators for select to authenticated
using (
  (select private.is_admin())
  or (
    store_id = (select private.operations_current_store_id())
    and status = 'active'
  )
);
create policy "admins can insert collaborators"
on public.collaborators for insert to authenticated
with check ((select private.is_admin()));
create policy "admins can update collaborators"
on public.collaborators for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "admins can manage collaborator compensation"
on public.collaborator_compensation for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "users can read attendance in their store"
on public.attendance_records for select to authenticated
using (
  (select private.is_admin())
  or store_id = (select private.operations_current_store_id())
);

create policy "admins can read weekly payments"
on public.weekly_payments for select to authenticated
using ((select private.is_admin()));

create policy "users can read expenses in their store"
on public.expenses for select to authenticated
using (
  (select private.is_admin())
  or store_id = (select private.operations_current_store_id())
);

create policy "admins can manage cash closings"
on public.cash_closings for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

revoke all on public.stores from public, anon, authenticated;
revoke all on public.collaborators from public, anon, authenticated;
revoke all on public.collaborator_compensation from public, anon, authenticated;
revoke all on public.attendance_records from public, anon, authenticated;
revoke all on public.weekly_payments from public, anon, authenticated;
revoke all on public.expenses from public, anon, authenticated;
revoke all on public.cash_closings from public, anon, authenticated;

grant select on public.stores to authenticated;
grant insert (id, name, status) on public.stores to authenticated;
grant update (name, status) on public.stores to authenticated;
grant select on public.collaborators to authenticated;
grant insert (id, name, store_id, rest_day, status)
  on public.collaborators to authenticated;
grant update (name, store_id, rest_day, status)
  on public.collaborators to authenticated;
grant select, insert, update on public.collaborator_compensation to authenticated;
grant select on public.attendance_records to authenticated;
grant select on public.weekly_payments to authenticated;
grant select on public.expenses to authenticated;
grant select, insert, update on public.cash_closings to authenticated;

revoke all on function private.operations_current_store_id()
  from public, anon, authenticated;
revoke all on function private.operations_validate_attendance_store()
  from public, anon, authenticated;
grant execute on function private.operations_current_store_id() to authenticated;

revoke all on function public.sync_expense(
  uuid, integer, uuid, date, numeric, text, text, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.register_weekly_payment(
  uuid, date, date, numeric, smallint, numeric, numeric, timestamptz, text, text
) from public, anon, authenticated;

grant execute on function public.sync_expense(
  uuid, integer, uuid, date, numeric, text, text, text, timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function public.register_weekly_payment(
  uuid, date, date, numeric, smallint, numeric, numeric, timestamptz, text, text
) to authenticated;

comment on table public.collaborator_compensation is
  'Compensación visible únicamente para administración; no se cachea en dispositivos cashier.';
comment on function public.sync_expense(
  uuid, integer, uuid, date, numeric, text, text, text, timestamptz, timestamptz, uuid
) is 'Sincroniza de forma idempotente un gasto creado localmente.';
comment on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, timestamptz, timestamptz, uuid
) is 'Sincroniza asistencia local sin permitir cambiar su identidad.';
comment on function public.register_weekly_payment(
  uuid, date, date, numeric, smallint, numeric, numeric, timestamptz, text, text
) is 'Registra snapshots, pago decidido y gasto asociado en una sola transacción.';
