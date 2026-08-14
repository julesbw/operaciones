-- Módulo administrativo de pagos por asistencias.
--
-- Esta migración es deliberadamente aditiva:
-- - conserva weekly_payments y todos sus datos históricos;
-- - revoca el flujo register_weekly_payment para pagos nuevos;
-- - no crea gastos al confirmar un pago;
-- - collaborator_payments pasa a ser la única fuente de verdad para pagos nuevos.
--
-- El nombre evita colisionar con public.payments, tabla que pertenece al
-- módulo de Arrendamientos dentro del mismo proyecto Supabase.

alter table public.collaborators
  add column if not exists pay_cycle_end_weekday smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'collaborators_pay_cycle_end_weekday_check'
      and conrelid = 'public.collaborators'::regclass
  ) then
    alter table public.collaborators
      add constraint collaborators_pay_cycle_end_weekday_check
      check (
        pay_cycle_end_weekday is null
        or pay_cycle_end_weekday between 0 and 6
      );
  end if;
end;
$$;

comment on column public.collaborators.pay_cycle_end_weekday is
  'Día que cierra el ciclo individual de pago (0=domingo, 6=sábado). Es nullable únicamente para colaboradores históricos pendientes de configurar.';

-- Los registros existentes permanecen en NULL. Sólo las altas posteriores a
-- esta migración deben traer un día de raya explícito.
create or replace function private.operations_require_pay_cycle_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pay_cycle_end_weekday is null then
    raise exception 'PAY_CYCLE_NOT_CONFIGURED'
      using errcode = '22023',
      detail = 'Los colaboradores nuevos requieren día de raya.';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'collaborators_require_pay_cycle_on_insert'
      and tgrelid = 'public.collaborators'::regclass
      and not tgisinternal
  ) then
    create trigger collaborators_require_pay_cycle_on_insert
    before insert on public.collaborators
    for each row execute function private.operations_require_pay_cycle_on_insert();
  end if;
end;
$$;

-- Historial efectivo por fecha. No se sobreescribe: cada cambio salarial crea
-- una nueva versión y los pagos guardan además sus snapshots definitivos.
create table if not exists public.collaborator_compensation_history (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null
    references public.collaborators(id) on delete restrict,
  weekly_pay numeric(12, 2) not null check (
    weekly_pay >= 0 and weekly_pay = round(weekly_pay, 2)
  ),
  effective_from date not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id)
);

create index if not exists collaborator_compensation_history_effective_idx
  on public.collaborator_compensation_history(
    collaborator_id,
    effective_from desc,
    recorded_at desc
  );

insert into public.collaborator_compensation_history (
  collaborator_id,
  weekly_pay,
  effective_from,
  recorded_at,
  recorded_by
)
select
  compensation.collaborator_id,
  compensation.weekly_pay,
  compensation.effective_from,
  compensation.updated_at,
  compensation.updated_by
from public.collaborator_compensation as compensation
where not exists (
  select 1
  from public.collaborator_compensation_history as history
  where history.collaborator_id = compensation.collaborator_id
);

-- Los snapshots del flujo legado también son evidencia salarial disponible.
-- Se incorporan como versiones efectivas al inicio del periodo que pagaron,
-- sin alterar weekly_payments ni inferir información que no existe.
insert into public.collaborator_compensation_history (
  collaborator_id,
  weekly_pay,
  effective_from,
  recorded_at,
  recorded_by
)
select
  legacy.collaborator_id,
  legacy.weekly_pay_snapshot,
  legacy.period_start,
  legacy.paid_at,
  legacy.paid_by
from public.weekly_payments as legacy
where not exists (
  select 1
  from public.collaborator_compensation_history as history
  where history.collaborator_id = legacy.collaborator_id
    and history.weekly_pay = legacy.weekly_pay_snapshot
    and history.effective_from = legacy.period_start
    and history.recorded_at = legacy.paid_at
);

comment on table public.collaborator_compensation_history is
  'Versiones salariales efectivas por fecha. Permite reconstruir periodos históricos sin usar el salario actual.';

create table if not exists public.collaborator_payments (
  id uuid primary key,
  collaborator_id uuid not null
    references public.collaborators(id) on delete restrict,
  collaborator_name_snapshot text not null check (
    length(btrim(collaborator_name_snapshot)) > 0
    and length(collaborator_name_snapshot) <= 120
  ),
  collaborator_store_id_snapshot uuid not null
    references public.stores(id) on delete restrict,
  pay_cycle_end_weekday_snapshot smallint not null check (
    pay_cycle_end_weekday_snapshot between 0 and 6
  ),
  business_date date not null,
  paid_at timestamptz not null default now(),
  paid_by uuid not null references auth.users(id),
  suggested_amount numeric(12, 2) not null check (
    suggested_amount >= 0 and suggested_amount = round(suggested_amount, 2)
  ),
  paid_amount numeric(12, 2) not null check (
    paid_amount > 0 and paid_amount = round(paid_amount, 2)
  ),
  funding_source text not null
    constraint collaborator_payments_funding_source_value_check check (
      funding_source in ('store_cash', 'central_cash')
    ),
  source_store_id uuid references public.stores(id) on delete restrict,
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  constraint collaborator_payments_funding_source_store_check check (
    (funding_source = 'store_cash' and source_store_id is not null)
    or (funding_source = 'central_cash' and source_store_id is null)
  )
);

create index if not exists collaborator_payments_collaborator_date_idx
  on public.collaborator_payments(collaborator_id, business_date desc, paid_at desc);
create index if not exists collaborator_payments_store_cash_closing_idx
  on public.collaborator_payments(source_store_id, business_date, created_at)
  where funding_source = 'store_cash';

create table if not exists public.payment_attendance_items (
  payment_id uuid not null references public.collaborator_payments(id) on delete restrict,
  attendance_id uuid not null
    references public.attendance_records(id) on delete restrict,
  work_date_snapshot date not null,
  period_start date not null,
  period_end date not null,
  weekly_pay_snapshot numeric(12, 2) not null check (
    weekly_pay_snapshot >= 0
    and weekly_pay_snapshot = round(weekly_pay_snapshot, 2)
  ),
  daily_pay_snapshot numeric(12, 2) not null check (
    daily_pay_snapshot >= 0
    and daily_pay_snapshot = round(daily_pay_snapshot, 2)
  ),
  suggested_allocation numeric(12, 2) not null check (
    suggested_allocation >= 0
    and suggested_allocation = round(suggested_allocation, 2)
  ),
  created_at timestamptz not null default now(),
  primary key (payment_id, attendance_id),
  unique (attendance_id),
  constraint payment_attendance_period_check check (
    period_end >= period_start
    and work_date_snapshot between period_start and period_end
  )
);

create index if not exists payment_attendance_items_payment_idx
  on public.payment_attendance_items(payment_id, period_start, work_date_snapshot);

comment on table public.collaborator_payments is
  'Fuente de verdad para pagos nuevos. Un pago puede cubrir asistencias de varios periodos y nunca crea automáticamente un gasto.';
comment on table public.payment_attendance_items is
  'Días exactos cubiertos y snapshots salariales definitivos; attendance_id es globalmente único para impedir doble pago.';

-- La migración no corrige históricos silenciosamente. Si existiera una fecha
-- futura previa, se detiene para que sea revisada explícitamente antes de
-- habilitar el módulo; una aplicación exitosa garantiza el invariante.
do $$
begin
  if exists (
    select 1
    from public.attendance_records as attendance
    where attendance.attendance_date >
      (now() at time zone 'America/Mexico_City')::date
  ) then
    raise exception 'FUTURE_ATTENDANCE_NOT_ALLOWED'
      using errcode = '22007',
      detail = 'Existen asistencias futuras previas que requieren revisión manual.';
  end if;
end;
$$;

-- No se permite registrar ni cambiar una asistencia a una fecha futura en la
-- zona operacional, tanto desde sync_attendance como desde cualquier otro flujo.
create or replace function private.operations_validate_attendance_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.attendance_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'FUTURE_ATTENDANCE_NOT_ALLOWED'
      using errcode = '22007',
      detail = 'No se pueden registrar asistencias futuras.';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'attendance_validate_operational_date'
      and tgrelid = 'public.attendance_records'::regclass
      and not tgisinternal
  ) then
    create trigger attendance_validate_operational_date
    before insert or update of attendance_date on public.attendance_records
    for each row execute function private.operations_validate_attendance_date();
  end if;
end;
$$;

-- Un día pagado es evidencia financiera. No puede editarse ni eliminarse sin
-- un futuro flujo explícito de ajuste/cancelación.
create or replace function private.operations_guard_paid_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.payment_attendance_items as item
    where item.attendance_id = old.id
  ) then
    raise exception 'PAID_ATTENDANCE_IMMUTABLE'
      using errcode = '55000',
      detail = 'La asistencia ya pertenece a un pago confirmado.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'attendance_guard_paid_record'
      and tgrelid = 'public.attendance_records'::regclass
      and not tgisinternal
  ) then
    create trigger attendance_guard_paid_record
    before update or delete on public.attendance_records
    for each row execute function private.operations_guard_paid_attendance();
  end if;
end;
$$;

-- La sincronización conserva sus garantías anteriores y añade fecha
-- operacional e inmutabilidad de asistencias pagadas.
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
  if p_attendance_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'FUTURE_ATTENDANCE_NOT_ALLOWED'
      using errcode = '22007';
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
    if exists (
      select 1
      from public.payment_attendance_items as item
      where item.attendance_id = v_existing.id
    ) then
      raise exception 'PAID_ATTENDANCE_IMMUTABLE'
        using errcode = '55000';
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

-- Alta nueva: el día de raya es obligatorio y el salario se registra tanto
-- como valor actual como en el historial efectivo.
create or replace function public.create_collaborator(
  p_id uuid,
  p_name text,
  p_store_id uuid,
  p_rest_day smallint,
  p_weekly_pay numeric,
  p_pay_cycle_end_weekday smallint
)
returns public.collaborators
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collaborator public.collaborators;
  v_business_date date := (now() at time zone 'America/Mexico_City')::date;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo un administrador puede crear colaboradores'
      using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'El identificador es obligatorio' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 or length(p_name) > 120 then
    raise exception 'El nombre del colaborador no es válido' using errcode = '22023';
  end if;
  if p_rest_day is null or p_rest_day not between 0 and 6 then
    raise exception 'El día de descanso no es válido' using errcode = '22023';
  end if;
  if p_pay_cycle_end_weekday is null
    or p_pay_cycle_end_weekday not between 0 and 6 then
    raise exception 'PAY_CYCLE_NOT_CONFIGURED' using errcode = '22023';
  end if;
  if p_weekly_pay is null or p_weekly_pay < 0
    or p_weekly_pay <> round(p_weekly_pay, 2) then
    raise exception 'El pago semanal no es válido' using errcode = '22003';
  end if;
  if not exists (
    select 1
    from public.stores as store
    where store.id = p_store_id and store.status = 'active'
  ) then
    raise exception 'La tienda no existe o está inactiva' using errcode = 'P0002';
  end if;

  insert into public.collaborators (
    id, name, store_id, rest_day, pay_cycle_end_weekday, status
  )
  values (
    p_id, btrim(p_name), p_store_id, p_rest_day,
    p_pay_cycle_end_weekday, 'active'
  )
  returning * into v_collaborator;

  insert into public.collaborator_compensation (
    collaborator_id, weekly_pay, effective_from, updated_by
  )
  values (v_collaborator.id, p_weekly_pay, v_business_date, auth.uid());

  insert into public.collaborator_compensation_history (
    collaborator_id, weekly_pay, effective_from, recorded_by
  )
  values (v_collaborator.id, p_weekly_pay, v_business_date, auth.uid());

  return v_collaborator;
end;
$$;

-- Configuración administrativa de colaboradores existentes. El historial sólo
-- recibe una versión nueva cuando cambia el salario.
create or replace function public.update_collaborator(
  p_id uuid,
  p_name text,
  p_store_id uuid,
  p_rest_day smallint,
  p_weekly_pay numeric,
  p_pay_cycle_end_weekday smallint
)
returns public.collaborators
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collaborator public.collaborators;
  v_compensation public.collaborator_compensation;
  v_business_date date := (now() at time zone 'America/Mexico_City')::date;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo un administrador puede editar colaboradores'
      using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'El identificador es obligatorio' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 or length(p_name) > 120 then
    raise exception 'El nombre del colaborador no es válido' using errcode = '22023';
  end if;
  if p_rest_day is null or p_rest_day not between 0 and 6 then
    raise exception 'El día de descanso no es válido' using errcode = '22023';
  end if;
  if p_pay_cycle_end_weekday is null
    or p_pay_cycle_end_weekday not between 0 and 6 then
    raise exception 'PAY_CYCLE_NOT_CONFIGURED' using errcode = '22023';
  end if;
  if p_weekly_pay is null or p_weekly_pay < 0
    or p_weekly_pay <> round(p_weekly_pay, 2) then
    raise exception 'El pago semanal no es válido' using errcode = '22003';
  end if;
  if not exists (
    select 1
    from public.stores as store
    where store.id = p_store_id and store.status = 'active'
  ) then
    raise exception 'La tienda no existe o está inactiva' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment:' || p_id::text, 0));

  select compensation.* into v_compensation
  from public.collaborator_compensation as compensation
  where compensation.collaborator_id = p_id
  for update;

  if not found then
    raise exception 'El colaborador no tiene compensación configurada'
      using errcode = 'P0002';
  end if;

  update public.collaborators
  set
    name = btrim(p_name),
    store_id = p_store_id,
    rest_day = p_rest_day,
    pay_cycle_end_weekday = p_pay_cycle_end_weekday
  where id = p_id
  returning * into v_collaborator;

  if not found then
    raise exception 'El colaborador no existe' using errcode = 'P0002';
  end if;

  if v_compensation.weekly_pay is distinct from p_weekly_pay then
    update public.collaborator_compensation
    set
      weekly_pay = p_weekly_pay,
      effective_from = v_business_date,
      updated_by = auth.uid()
    where collaborator_id = p_id;

    insert into public.collaborator_compensation_history (
      collaborator_id, weekly_pay, effective_from, recorded_by
    )
    values (p_id, p_weekly_pay, v_business_date, auth.uid());
  end if;

  return v_collaborator;
end;
$$;

-- Confirma un pago con UUID idempotente. React sólo envía días seleccionados y
-- el monto humano; periodos, salarios y sugerencias se recalculan en servidor.
create or replace function public.confirm_collaborator_payment(
  p_payment_id uuid,
  p_collaborator_id uuid,
  p_attendance_ids uuid[],
  p_paid_amount numeric,
  p_funding_source text,
  p_source_store_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attendance_ids uuid[] := coalesce(p_attendance_ids, '{}'::uuid[]);
  v_business_date date := (now() at time zone 'America/Mexico_City')::date;
  v_collaborator public.collaborators;
  v_existing public.collaborator_payments;
  v_payment public.collaborator_payments;
  v_suggested_amount numeric(12, 2);
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'PAYMENT_REQUIRES_ADMIN' using errcode = '42501';
  end if;
  if p_payment_id is null or p_collaborator_id is null then
    raise exception 'PAYMENT_CONFLICT'
      using errcode = '22023', detail = 'El pago requiere identificadores válidos.';
  end if;
  if p_paid_amount is null or p_paid_amount <= 0
    or p_paid_amount <> round(p_paid_amount, 2) then
    raise exception 'PAYMENT_CONFLICT'
      using errcode = '22003', detail = 'El monto pagado debe ser positivo y tener máximo dos decimales.';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    raise exception 'PAYMENT_CONFLICT'
      using errcode = '22023', detail = 'Las notas no pueden exceder 1000 caracteres.';
  end if;
  if p_funding_source not in ('store_cash', 'central_cash')
    or (p_funding_source = 'store_cash' and p_source_store_id is null)
    or (p_funding_source = 'central_cash' and p_source_store_id is not null) then
    raise exception 'INVALID_PAYMENT_SOURCE' using errcode = '22023';
  end if;
  if p_funding_source = 'store_cash' and not exists (
    select 1 from public.stores as store
    where store.id = p_source_store_id
  ) then
    raise exception 'INVALID_PAYMENT_SOURCE'
      using errcode = 'P0002', detail = 'La tienda origen no existe.';
  end if;
  if cardinality(v_attendance_ids) = 0
    or cardinality(v_attendance_ids) <> (
      select count(distinct selected.id)
      from unnest(v_attendance_ids) as selected(id)
    ) then
    raise exception 'ATTENDANCE_NOT_PAYABLE'
      using errcode = '22023', detail = 'Selecciona al menos una asistencia sin duplicados.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('payment-id:' || p_payment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('payment:' || p_collaborator_id::text, 0)
  );

  select payment.* into v_existing
  from public.collaborator_payments as payment
  where payment.id = p_payment_id
  for update;

  if found then
    if v_existing.collaborator_id is distinct from p_collaborator_id then
      raise exception 'PAYMENT_CONFLICT'
        using errcode = '23505', detail = 'El UUID ya pertenece a otro pago.';
    end if;
    return jsonb_build_object(
      'payment', to_jsonb(v_existing),
      'items', coalesce((
        select jsonb_agg(to_jsonb(item) order by item.period_start, item.work_date_snapshot)
        from public.payment_attendance_items as item
        where item.payment_id = v_existing.id
      ), '[]'::jsonb)
    );
  end if;

  select collaborator.* into v_collaborator
  from public.collaborators as collaborator
  where collaborator.id = p_collaborator_id
  for update;

  if not found then
    raise exception 'PAYMENT_CONFLICT'
      using errcode = 'P0002', detail = 'El colaborador no existe.';
  end if;
  if v_collaborator.pay_cycle_end_weekday is null then
    raise exception 'PAY_CYCLE_NOT_CONFIGURED' using errcode = '22023';
  end if;

  perform 1
  from public.attendance_records as attendance
  where attendance.id = any(v_attendance_ids)
  order by attendance.id
  for update;

  if cardinality(v_attendance_ids) <> (
    select count(*)
    from public.attendance_records as attendance
    where attendance.id = any(v_attendance_ids)
      and attendance.collaborator_id = p_collaborator_id
      and attendance.status = 'present'
      and attendance.attendance_date <= v_business_date
  ) then
    if exists (
      select 1
      from public.attendance_records as attendance
      where attendance.id = any(v_attendance_ids)
        and attendance.attendance_date > v_business_date
    ) then
      raise exception 'FUTURE_ATTENDANCE_NOT_ALLOWED' using errcode = '22007';
    end if;
    raise exception 'ATTENDANCE_NOT_PAYABLE'
      using errcode = '22023', detail = 'Sólo pueden pagarse asistencias presentes, del colaborador y no futuras.';
  end if;

  if exists (
    select 1
    from public.payment_attendance_items as item
    where item.attendance_id = any(v_attendance_ids)
  ) then
    raise exception 'ATTENDANCE_ALREADY_PAID' using errcode = '23505';
  end if;

  -- Cada periodo usa primero el snapshot de una parcialidad previa. Si todavía
  -- no tiene pagos, toma la última compensación efectiva al cierre del periodo
  -- (o a hoy cuando el periodo sigue abierto).
  with selected as (
    select
      attendance.id,
      attendance.attendance_date,
      (
        attendance.attendance_date
        + (
          (v_collaborator.pay_cycle_end_weekday
            - extract(dow from attendance.attendance_date)::integer + 7) % 7
        )
      )::date as period_end
    from public.attendance_records as attendance
    where attendance.id = any(v_attendance_ids)
  ),
  selected_periods as (
    select distinct (selected.period_end - 6)::date as period_start, selected.period_end
    from selected
  ),
  period_rates as (
    select
      period.period_start,
      period.period_end,
      coalesce(previous.weekly_pay_snapshot, history.weekly_pay) as weekly_pay,
      coalesce(previous.daily_pay_snapshot, floor(history.weekly_pay / 6)) as daily_pay
    from selected_periods as period
    left join lateral (
      select item.weekly_pay_snapshot, item.daily_pay_snapshot
      from public.payment_attendance_items as item
      join public.collaborator_payments as payment on payment.id = item.payment_id
      where payment.collaborator_id = p_collaborator_id
        and item.period_start = period.period_start
        and item.period_end = period.period_end
      order by item.created_at
      limit 1
    ) as previous on true
    left join lateral (
      select compensation.weekly_pay
      from public.collaborator_compensation_history as compensation
      where compensation.collaborator_id = p_collaborator_id
        and compensation.effective_from <= least(period.period_end, v_business_date)
      order by compensation.effective_from desc, compensation.recorded_at desc
      limit 1
    ) as history on previous.weekly_pay_snapshot is null
  )
  select count(*) into strict v_suggested_amount
  from period_rates
  where weekly_pay is null or daily_pay is null;

  if v_suggested_amount > 0 then
    raise exception 'PAYMENT_CONFLICT'
      using errcode = 'P0002', detail = 'No existe historial salarial aplicable al periodo.';
  end if;

  with selected as (
    select
      attendance.id,
      attendance.attendance_date,
      (
        attendance.attendance_date
        + (
          (v_collaborator.pay_cycle_end_weekday
            - extract(dow from attendance.attendance_date)::integer + 7) % 7
        )
      )::date as period_end
    from public.attendance_records as attendance
    where attendance.id = any(v_attendance_ids)
  ),
  selected_periods as (
    select
      (selected.period_end - 6)::date as period_start,
      selected.period_end,
      count(*)::integer as selected_days
    from selected
    group by selected.period_end
  ),
  period_rates as (
    select
      period.*,
      coalesce(previous.weekly_pay_snapshot, history.weekly_pay) as weekly_pay,
      coalesce(previous.daily_pay_snapshot, floor(history.weekly_pay / 6)) as daily_pay
    from selected_periods as period
    left join lateral (
      select item.weekly_pay_snapshot, item.daily_pay_snapshot
      from public.payment_attendance_items as item
      join public.collaborator_payments as payment on payment.id = item.payment_id
      where payment.collaborator_id = p_collaborator_id
        and item.period_start = period.period_start
        and item.period_end = period.period_end
      order by item.created_at
      limit 1
    ) as previous on true
    left join lateral (
      select compensation.weekly_pay
      from public.collaborator_compensation_history as compensation
      where compensation.collaborator_id = p_collaborator_id
        and compensation.effective_from <= least(period.period_end, v_business_date)
      order by compensation.effective_from desc, compensation.recorded_at desc
      limit 1
    ) as history on previous.weekly_pay_snapshot is null
  ),
  period_stats as (
    select
      rate.*,
      (
        select count(*)::integer
        from public.attendance_records as attendance
        where attendance.collaborator_id = p_collaborator_id
          and attendance.status = 'present'
          and attendance.attendance_date between rate.period_start and rate.period_end
          and attendance.attendance_date <= v_business_date
      ) as worked_days,
      (
        select count(*)::integer
        from public.attendance_records as attendance
        where attendance.collaborator_id = p_collaborator_id
          and attendance.status = 'present'
          and attendance.attendance_date between rate.period_start and rate.period_end
          and attendance.attendance_date <= v_business_date
          and not exists (
            select 1
            from public.payment_attendance_items as item
            where item.attendance_id = attendance.id
          )
      ) as remaining_days,
      (
        select coalesce(sum(item.suggested_allocation), 0)
        from public.payment_attendance_items as item
        join public.collaborator_payments as payment on payment.id = item.payment_id
        where payment.collaborator_id = p_collaborator_id
          and item.period_start = rate.period_start
          and item.period_end = rate.period_end
      ) as already_allocated
    from period_rates as rate
  ),
  period_policy as (
    select
      stats.*,
      case
        when stats.period_end <= v_business_date and stats.worked_days = 6
          then stats.weekly_pay
        else stats.daily_pay * stats.worked_days
      end as policy_target
    from period_stats as stats
  ),
  period_suggestions as (
    select
      policy.*,
      case
        when policy.selected_days = policy.remaining_days
          then policy.policy_target - policy.already_allocated
        else policy.daily_pay * policy.selected_days
      end as selected_suggestion
    from period_policy as policy
  )
  select round(coalesce(sum(selected_suggestion), 0), 2)
  into v_suggested_amount
  from period_suggestions;

  if v_suggested_amount < 0 then
    raise exception 'PAYMENT_CONFLICT'
      using errcode = '40001', detail = 'Los snapshots previos del periodo no son compatibles con la política actual.';
  end if;

  insert into public.collaborator_payments (
    id,
    collaborator_id,
    collaborator_name_snapshot,
    collaborator_store_id_snapshot,
    pay_cycle_end_weekday_snapshot,
    business_date,
    paid_at,
    paid_by,
    suggested_amount,
    paid_amount,
    funding_source,
    source_store_id,
    notes
  )
  values (
    p_payment_id,
    v_collaborator.id,
    v_collaborator.name,
    v_collaborator.store_id,
    v_collaborator.pay_cycle_end_weekday,
    v_business_date,
    now(),
    auth.uid(),
    v_suggested_amount,
    p_paid_amount,
    p_funding_source,
    p_source_store_id,
    nullif(btrim(p_notes), '')
  )
  returning * into v_payment;

  begin
    with selected as (
      select
        attendance.id,
        attendance.attendance_date,
        (
          attendance.attendance_date
          + (
            (v_collaborator.pay_cycle_end_weekday
              - extract(dow from attendance.attendance_date)::integer + 7) % 7
          )
        )::date as period_end
      from public.attendance_records as attendance
      where attendance.id = any(v_attendance_ids)
    ),
    selected_numbered as (
      select
        selected.*,
        (selected.period_end - 6)::date as period_start,
        row_number() over (
          partition by selected.period_end order by selected.attendance_date, selected.id
        ) as selected_number,
        count(*) over (partition by selected.period_end) as selected_days
      from selected
    ),
    selected_periods as (
      select distinct period_start, period_end, selected_days
      from selected_numbered
    ),
    period_rates as (
      select
        period.*,
        coalesce(previous.weekly_pay_snapshot, history.weekly_pay) as weekly_pay,
        coalesce(previous.daily_pay_snapshot, floor(history.weekly_pay / 6)) as daily_pay
      from selected_periods as period
      left join lateral (
        select item.weekly_pay_snapshot, item.daily_pay_snapshot
        from public.payment_attendance_items as item
        join public.collaborator_payments as payment on payment.id = item.payment_id
        where payment.collaborator_id = p_collaborator_id
          and item.period_start = period.period_start
          and item.period_end = period.period_end
        order by item.created_at
        limit 1
      ) as previous on true
      left join lateral (
        select compensation.weekly_pay
        from public.collaborator_compensation_history as compensation
        where compensation.collaborator_id = p_collaborator_id
          and compensation.effective_from <= least(period.period_end, v_business_date)
        order by compensation.effective_from desc, compensation.recorded_at desc
        limit 1
      ) as history on previous.weekly_pay_snapshot is null
    ),
    period_stats as (
      select
        rate.*,
        (
          select count(*)::integer
          from public.attendance_records as attendance
          where attendance.collaborator_id = p_collaborator_id
            and attendance.status = 'present'
            and attendance.attendance_date between rate.period_start and rate.period_end
            and attendance.attendance_date <= v_business_date
        ) as worked_days,
        (
          select count(*)::integer
          from public.attendance_records as attendance
          where attendance.collaborator_id = p_collaborator_id
            and attendance.status = 'present'
            and attendance.attendance_date between rate.period_start and rate.period_end
            and attendance.attendance_date <= v_business_date
            and not exists (
              select 1
              from public.payment_attendance_items as item
              where item.attendance_id = attendance.id
            )
        ) as remaining_days,
        (
          select coalesce(sum(item.suggested_allocation), 0)
          from public.payment_attendance_items as item
          join public.collaborator_payments as payment on payment.id = item.payment_id
          where payment.collaborator_id = p_collaborator_id
            and item.period_start = rate.period_start
            and item.period_end = rate.period_end
        ) as already_allocated
      from period_rates as rate
    ),
    period_suggestions as (
      select
        stats.*,
        case
          when stats.selected_days = stats.remaining_days then
            (
              case
                when stats.period_end <= v_business_date and stats.worked_days = 6
                  then stats.weekly_pay
                else stats.daily_pay * stats.worked_days
              end
            ) - stats.already_allocated
          else stats.daily_pay * stats.selected_days
        end as selected_suggestion
      from period_stats as stats
    )
    insert into public.payment_attendance_items (
      payment_id,
      attendance_id,
      work_date_snapshot,
      period_start,
      period_end,
      weekly_pay_snapshot,
      daily_pay_snapshot,
      suggested_allocation
    )
    select
      v_payment.id,
      selected.id,
      selected.attendance_date,
      selected.period_start,
      selected.period_end,
      suggestion.weekly_pay,
      suggestion.daily_pay,
      case
        when selected.selected_number = selected.selected_days then
          suggestion.selected_suggestion
            - suggestion.daily_pay * (selected.selected_days - 1)
        else suggestion.daily_pay
      end
    from selected_numbered as selected
    join period_suggestions as suggestion
      on suggestion.period_start = selected.period_start
      and suggestion.period_end = selected.period_end;
  exception when unique_violation then
    raise exception 'ATTENDANCE_ALREADY_PAID' using errcode = '23505';
  end;

  return jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.period_start, item.work_date_snapshot)
      from public.payment_attendance_items as item
      where item.payment_id = v_payment.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Bootstrap administrativo en una sola respuesta para evitar límites de
-- paginación y dejar disponible offline toda la deuda histórica pagable.
create or replace function public.get_payment_module_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'PAYMENT_REQUIRES_ADMIN' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'payments', coalesce((
      select jsonb_agg(to_jsonb(payment) order by payment.paid_at desc)
      from public.collaborator_payments as payment
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.period_start, item.work_date_snapshot)
      from public.payment_attendance_items as item
    ), '[]'::jsonb),
    'compensation_history', coalesce((
      select jsonb_agg(to_jsonb(history) order by history.effective_from, history.recorded_at)
      from public.collaborator_compensation_history as history
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(to_jsonb(attendance) order by attendance.attendance_date)
      from public.attendance_records as attendance
      where attendance.attendance_date <= (now() at time zone 'America/Mexico_City')::date
    ), '[]'::jsonb)
  );
end;
$$;

-- Un pago store_cash puede pertenecer a un único corte. Caja central nunca
-- entra en esta relación.
create table if not exists public.cash_closing_payment_items (
  cash_closing_id uuid not null
    references public.cash_closings(id) on delete restrict,
  payment_id uuid not null references public.collaborator_payments(id) on delete restrict,
  amount_snapshot numeric(12, 2) not null check (amount_snapshot > 0),
  collaborator_name_snapshot text not null check (
    length(btrim(collaborator_name_snapshot)) > 0
    and length(collaborator_name_snapshot) <= 120
  ),
  created_at timestamptz not null default now(),
  primary key (cash_closing_id, payment_id),
  unique (payment_id)
);

create index if not exists cash_closing_payment_items_closing_idx
  on public.cash_closing_payment_items(cash_closing_id);

create or replace function private.operations_guard_assigned_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'expenses' and exists (
    select 1
    from public.cash_closing_expense_items as item
    where item.expense_id = old.id
  ) then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = '55000', detail = 'El gasto pertenece a un corte cerrado.';
  end if;

  if tg_table_name = 'merchandise_transfers' and exists (
    select 1
    from public.cash_closing_transfer_items as item
    where item.transfer_id = old.id
  ) then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = '55000', detail = 'La transferencia pertenece a un corte cerrado.';
  end if;

  if tg_table_name = 'collaborator_payments' and exists (
    select 1
    from public.cash_closing_payment_items as item
    where item.payment_id = old.id
  ) then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = '55000', detail = 'El pago pertenece a un corte cerrado.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'collaborator_payments_guard_assigned_movement'
      and tgrelid = 'public.collaborator_payments'::regclass
      and not tgisinternal
  ) then
    create trigger collaborator_payments_guard_assigned_movement
    before update or delete on public.collaborator_payments
    for each row execute function private.operations_guard_assigned_movement();
  end if;
end;
$$;

create or replace function public.get_cash_closing_candidates(
  p_store_id uuid,
  p_business_date date
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
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Sólo administración puede consultar candidatos de corte'
      using errcode = '42501';
  end if;
  if p_store_id is null or p_business_date is null then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND'
      using errcode = '22023', detail = 'La tienda y fecha operativa son obligatorias.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(expense) order by expense.created_at), '[]'::jsonb)
  into v_expenses
  from public.expenses as expense
  where expense.store_id = p_store_id
    and expense.business_date = p_business_date
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

  select coalesce(jsonb_agg(to_jsonb(payment) order by payment.created_at), '[]'::jsonb)
  into v_payments
  from public.collaborator_payments as payment
  where payment.funding_source = 'store_cash'
    and payment.source_store_id = p_store_id
    and payment.business_date = p_business_date
    and not exists (
      select 1 from public.cash_closing_payment_items as item
      where item.payment_id = payment.id
    );

  return jsonb_build_object(
    'expenses', v_expenses,
    'transfers', v_transfers,
    'payments', v_payments
  );
end;
$$;

-- Nueva firma de cierre con selección de pagos. La firma anterior se conserva
-- para compatibilidad binaria pero queda sin permiso para clientes.
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
  p_payment_ids uuid[]
)
returns public.cash_closings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_ids uuid[] := coalesce(p_payment_ids, '{}'::uuid[]);
  v_existing public.cash_closings;
  v_closing public.cash_closings;
  v_store_cash_payments_total numeric(12, 2);
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Sólo administración puede cerrar caja'
      using errcode = '42501';
  end if;
  if cardinality(v_payment_ids) <> (
    select count(distinct selected.id)
    from unnest(v_payment_ids) as selected(id)
  ) then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND'
      using errcode = '22023', detail = 'La selección contiene pagos duplicados.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_store_id::text || ':' || p_business_date::text,
    0
  ));

  select closing.* into v_existing
  from public.cash_closings as closing
  where closing.id = p_id
  for update;

  if found then
    if v_existing.store_id = p_store_id
      and v_existing.business_date = p_business_date
      and v_existing.status = 'closed' then
      return v_existing;
    end if;
    raise exception 'CLOSING_ALREADY_EXISTS'
      using errcode = '23505';
  end if;

  perform 1
  from public.collaborator_payments as payment
  where payment.id = any(v_payment_ids)
  order by payment.id
  for update;

  if cardinality(v_payment_ids) <> (
    select count(*)
    from public.collaborator_payments as payment
    where payment.id = any(v_payment_ids)
      and payment.funding_source = 'store_cash'
      and payment.source_store_id = p_store_id
      and payment.business_date = p_business_date
  ) then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND'
      using errcode = 'P0001',
      detail = 'Uno o más pagos no pertenecen a la caja y fecha del corte.';
  end if;

  if exists (
    select 1
    from public.cash_closing_payment_items as item
    where item.payment_id = any(v_payment_ids)
  ) then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = 'P0001', detail = 'Uno o más pagos pertenecen a otro corte.';
  end if;

  -- La implementación previa sigue siendo la autoridad para gastos,
  -- transferencias, billetes y numeración. Su permiso externo se revoca abajo.
  v_closing := public.close_cash_closing(
    p_id,
    p_store_id,
    p_business_date,
    p_gross_sales,
    p_bills,
    p_balance_bills,
    p_notes,
    p_expense_ids,
    p_transfer_ids
  );

  select coalesce(sum(payment.paid_amount), 0)
  into v_store_cash_payments_total
  from public.collaborator_payments as payment
  where payment.id = any(v_payment_ids);

  begin
    insert into public.cash_closing_payment_items (
      cash_closing_id,
      payment_id,
      amount_snapshot,
      collaborator_name_snapshot
    )
    select
      v_closing.id,
      payment.id,
      payment.paid_amount,
      payment.collaborator_name_snapshot
    from public.collaborator_payments as payment
    where payment.id = any(v_payment_ids);
  exception when unique_violation then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = 'P0001', detail = 'Uno o más pagos fueron consumidos por otro corte.';
  end;

  update public.cash_closings
  set
    store_cash_payments_total_snapshot = v_store_cash_payments_total,
    operational_outflows_total_snapshot = round(
      expenses_total_snapshot
      + outgoing_transfers_total_snapshot
      + v_store_cash_payments_total,
      2
    ),
    cash_outflows_total_snapshot = round(
      cash_expenses_total_snapshot + v_store_cash_payments_total,
      2
    ),
    expected_cash = round(
      gross_sales - cash_expenses_total_snapshot - v_store_cash_payments_total,
      2
    ),
    difference = round(
      counted_cash
      - (gross_sales - cash_expenses_total_snapshot - v_store_cash_payments_total),
      2
    )
  where id = v_closing.id
  returning * into v_closing;

  return v_closing;
end;
$$;

alter table public.collaborator_compensation_history enable row level security;
alter table public.collaborator_payments enable row level security;
alter table public.payment_attendance_items enable row level security;
alter table public.cash_closing_payment_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'collaborator_compensation_history'
      and policyname = 'admins can read compensation history'
  ) then
    create policy "admins can read compensation history"
    on public.collaborator_compensation_history for select to authenticated
    using ((select private.is_admin()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'collaborator_payments'
      and policyname = 'admins can read collaborator payments'
  ) then
    create policy "admins can read collaborator payments"
    on public.collaborator_payments for select to authenticated
    using ((select private.is_admin()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'payment_attendance_items'
      and policyname = 'admins can read payment attendance items'
  ) then
    create policy "admins can read payment attendance items"
    on public.payment_attendance_items for select to authenticated
    using ((select private.is_admin()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'cash_closing_payment_items'
      and policyname = 'admins can read closing payment snapshots'
  ) then
    create policy "admins can read closing payment snapshots"
    on public.cash_closing_payment_items for select to authenticated
    using ((select private.is_admin()));
  end if;
end;
$$;

revoke all on public.collaborator_compensation_history
  from public, anon, authenticated;
revoke all on public.collaborator_payments from public, anon, authenticated;
revoke all on public.payment_attendance_items
  from public, anon, authenticated;
revoke all on public.cash_closing_payment_items
  from public, anon, authenticated;

grant select on public.collaborator_compensation_history to authenticated;
grant select on public.collaborator_payments to authenticated;
grant select on public.payment_attendance_items to authenticated;
grant select on public.cash_closing_payment_items to authenticated;

-- Toda modificación salarial nueva debe pasar por update_collaborator para
-- que la versión efectiva se escriba en el historial en la misma transacción.
revoke insert, update on public.collaborator_compensation from authenticated;

-- Firma antigua de creación: se conserva, pero ya no puede producir altas sin
-- día de raya. El trigger también la rechazaría aunque se invocara internamente.
revoke all on function public.create_collaborator(
  uuid, text, uuid, smallint, numeric
) from public, anon, authenticated;

revoke all on function public.create_collaborator(
  uuid, text, uuid, smallint, numeric, smallint
) from public, anon, authenticated;
grant execute on function public.create_collaborator(
  uuid, text, uuid, smallint, numeric, smallint
) to authenticated;

revoke all on function public.update_collaborator(
  uuid, text, uuid, smallint, numeric, smallint
) from public, anon, authenticated;
grant execute on function public.update_collaborator(
  uuid, text, uuid, smallint, numeric, smallint
) to authenticated;

-- Flujo de pagos antiguo deshabilitado. La tabla weekly_payments permanece
-- intacta y consultable para historia; no se crean pagos ni gastos nuevos ahí.
revoke all on function public.register_weekly_payment(
  uuid, date, date, numeric, smallint, numeric, numeric, timestamptz, text, text
) from public, anon, authenticated;

revoke all on function public.confirm_collaborator_payment(
  uuid, uuid, uuid[], numeric, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.confirm_collaborator_payment(
  uuid, uuid, uuid[], numeric, text, uuid, text
) to authenticated;

revoke all on function public.get_payment_module_data()
  from public, anon, authenticated;
grant execute on function public.get_payment_module_data() to authenticated;

revoke all on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[]
) from public, anon, authenticated;
revoke all on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[]
) from public, anon, authenticated;
grant execute on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[]
) to authenticated;

revoke all on function private.operations_require_pay_cycle_on_insert()
  from public, anon, authenticated;
revoke all on function private.operations_validate_attendance_date()
  from public, anon, authenticated;
revoke all on function private.operations_guard_paid_attendance()
  from public, anon, authenticated;

comment on function public.confirm_collaborator_payment(
  uuid, uuid, uuid[], numeric, text, uuid, text
) is 'Confirma un pago idempotente, recalcula sugerencias en servidor y cubre asistencias exactas sin crear gastos.';
comment on function public.get_payment_module_data() is
  'Entrega a administración pagos, días cubiertos, salarios efectivos y asistencias pagables para el cache local-first.';
comment on table public.cash_closing_payment_items is
  'Evidencia histórica de pagos store_cash seleccionados para un único corte.';
