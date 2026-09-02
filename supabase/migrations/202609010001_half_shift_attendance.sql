-- Medios turnos en asistencias y pagos.
--
-- La columna attendance_type es la fuente de verdad del turno trabajado:
--   present + full/half = asistencia pagable
--   absent/rest_day + null = sin asistencia pagable
-- Se conservan status y las firmas anteriores para no romper históricos ni
-- clientes que todavía envíen la forma anterior de una asistencia.

alter table public.attendance_records
  add column if not exists attendance_type text;

update public.attendance_records
set attendance_type = case
  when status = 'present' then coalesce(attendance_type, 'full')
  else null
end
where attendance_type is null
   or status <> 'present';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_records_type_check'
      and conrelid = 'public.attendance_records'::regclass
  ) then
    alter table public.attendance_records
      add constraint attendance_records_type_check
      check (
        (status = 'present' and attendance_type is not null
          and attendance_type in ('full', 'half'))
        or (status in ('absent', 'rest_day') and attendance_type is null)
      );
  end if;
end;
$$;

alter table public.payment_attendance_items
  add column if not exists attendance_type_snapshot text;

update public.payment_attendance_items as item
set attendance_type_snapshot = coalesce(attendance.attendance_type, 'full')
from public.attendance_records as attendance
where attendance.id = item.attendance_id
  and item.attendance_type_snapshot is null;

alter table public.payment_attendance_items
  alter column attendance_type_snapshot set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_attendance_items_type_snapshot_check'
      and conrelid = 'public.payment_attendance_items'::regclass
  ) then
    alter table public.payment_attendance_items
      add constraint payment_attendance_items_type_snapshot_check
      check (attendance_type_snapshot in ('full', 'half'));
  end if;
end;
$$;

comment on column public.attendance_records.attendance_type is
  'Tipo de turno: full, half o NULL cuando status no es present. Los presentes históricos se migran a full.';
comment on column public.payment_attendance_items.attendance_type_snapshot is
  'Tipo de turno congelado al confirmar el pago; permite conservar la evidencia histórica.';

-- Firma actual para administración y operadores. El argumento nuevo se coloca
-- junto a status; las firmas previas quedan como wrappers de compatibilidad.
create or replace function public.sync_attendance(
  p_id uuid,
  p_base_version integer,
  p_collaborator_id uuid,
  p_store_id uuid,
  p_attendance_date date,
  p_status text,
  p_attendance_type text,
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
  if p_status is null
    or p_status not in ('present', 'absent', 'rest_day')
    or (p_status = 'present' and (
      p_attendance_type is null
      or p_attendance_type not in ('full', 'half')
    ))
    or (p_status <> 'present' and p_attendance_type is not null) then
    raise exception 'ATTENDANCE_NOT_PAYABLE'
      using errcode = '22023', detail = 'El estado y tipo de asistencia no son compatibles.';
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
      and v_existing.attendance_type is not distinct from p_attendance_type
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
      attendance_type = p_attendance_type,
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
      id, collaborator_id, store_id, attendance_date, status, attendance_type,
      recorded_by, recorded_by_operator_account_id, created_at, updated_at, version
    ) values (
      p_id, p_collaborator_id, p_store_id, p_attendance_date, p_status,
      p_attendance_type, auth.uid(), v_operator_account_id, p_created_at,
      p_updated_at, 1
    ) returning * into v_attendance;
  end if;

  return v_attendance;
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
begin
  return public.sync_attendance(
    p_id,
    p_base_version,
    p_collaborator_id,
    p_store_id,
    p_attendance_date,
    p_status,
    case when p_status = 'present' then 'full' else null end,
    p_created_at,
    p_updated_at,
    p_recorded_by,
    p_operator_token
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
  p_recorded_by uuid
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
    p_id,
    p_base_version,
    p_collaborator_id,
    p_store_id,
    p_attendance_date,
    p_status,
    case when p_status = 'present' then 'full' else null end,
    p_created_at,
    p_updated_at,
    p_recorded_by,
    null
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
  p_attendance_type text,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_recorded_by uuid
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
    p_id,
    p_base_version,
    p_collaborator_id,
    p_store_id,
    p_attendance_date,
    p_status,
    p_attendance_type,
    p_created_at,
    p_updated_at,
    p_recorded_by,
    null
  );
end;
$$;

revoke all on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, text, timestamptz,
  timestamptz, uuid, text
) from public, anon, authenticated;
grant execute on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, text, timestamptz,
  timestamptz, uuid, text
) to authenticated;

revoke all on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, text, timestamptz,
  timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.sync_attendance(
  uuid, integer, uuid, uuid, date, text, text, timestamptz,
  timestamptz, uuid
) to authenticated;

-- Esta función mantiene la consolidación en un único punto dentro de la
-- autoridad SQL. La vista de pagos replica la misma operación en TypeScript
-- para poder funcionar offline.
create or replace function private.operations_calculate_shift_payment(
  p_weekly_pay numeric,
  p_full_shifts integer,
  p_half_shifts integer,
  p_weekly_pay_eligible boolean
)
returns table (
  daily_pay numeric,
  half_pay numeric,
  paired_halves integer,
  remaining_half integer,
  equivalent_full_shifts integer,
  amount numeric,
  weekly_pay_applied boolean
)
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_daily_pay numeric := floor(p_weekly_pay / 6);
  v_half_pay numeric := floor(floor(p_weekly_pay / 6) / 2);
  v_paired_halves integer := floor(p_half_shifts / 2.0)::integer;
  v_remaining_half integer := p_half_shifts % 2;
  v_equivalent_full_shifts integer := p_full_shifts + v_paired_halves;
  v_weekly_pay_applied boolean :=
    p_weekly_pay_eligible
    and v_equivalent_full_shifts = 6
    and v_remaining_half = 0;
begin
  return query
  select
    v_daily_pay,
    v_half_pay,
    v_paired_halves,
    v_remaining_half,
    v_equivalent_full_shifts,
    case
      when v_weekly_pay_applied then p_weekly_pay
      else v_equivalent_full_shifts * v_daily_pay
        + v_remaining_half * v_half_pay
    end,
    v_weekly_pay_applied;
end;
$$;

-- Recalcula la sugerencia desde attendance_type y congela el tipo en cada
-- renglón pagado. La selección parcial también consolida los medios turnos
-- seleccionados antes de aplicar daily_pay o half_pay.
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
      and attendance.attendance_type in ('full', 'half')
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

  with selected_periods as (
    select distinct
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
  period_rates as (
    select
      (period.period_end - 6)::date as period_start,
      period.period_end,
      coalesce(previous.weekly_pay_snapshot, history.weekly_pay) as weekly_pay,
      coalesce(previous.daily_pay_snapshot, floor(history.weekly_pay / 6)) as daily_pay
    from selected_periods as period
    left join lateral (
      select item.weekly_pay_snapshot, item.daily_pay_snapshot
      from public.payment_attendance_items as item
      join public.collaborator_payments as payment on payment.id = item.payment_id
      where payment.collaborator_id = p_collaborator_id
        and item.period_start = (period.period_end - 6)::date
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
      attendance.attendance_type,
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
      count(*)::integer as selected_days,
      count(*) filter (where selected.attendance_type = 'full')::integer as selected_full_shifts,
      count(*) filter (where selected.attendance_type = 'half')::integer as selected_half_shifts
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
          and attendance.attendance_type = 'full'
          and attendance.attendance_date between rate.period_start and rate.period_end
          and attendance.attendance_date <= v_business_date
      ) as worked_full_shifts,
      (
        select count(*)::integer
        from public.attendance_records as attendance
        where attendance.collaborator_id = p_collaborator_id
          and attendance.status = 'present'
          and attendance.attendance_type = 'half'
          and attendance.attendance_date between rate.period_start and rate.period_end
          and attendance.attendance_date <= v_business_date
      ) as worked_half_shifts,
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
      full_calculation.amount as policy_target,
      partial_calculation.amount as selected_partial_amount,
      full_calculation.half_pay
    from period_stats as stats
    cross join lateral private.operations_calculate_shift_payment(
      stats.weekly_pay,
      stats.worked_full_shifts,
      stats.worked_half_shifts,
      stats.period_end <= v_business_date
    ) as full_calculation
    cross join lateral private.operations_calculate_shift_payment(
      stats.weekly_pay,
      stats.selected_full_shifts,
      stats.selected_half_shifts,
      false
    ) as partial_calculation
  ),
  period_suggestions as (
    select
      policy.*,
      case
        when policy.selected_days = policy.remaining_days
          then policy.policy_target - policy.already_allocated
        else policy.selected_partial_amount
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
        attendance.attendance_type,
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
      select
        period_start,
        period_end,
        selected_days,
        count(*) filter (where attendance_type = 'full')::integer as selected_full_shifts,
        count(*) filter (where attendance_type = 'half')::integer as selected_half_shifts
      from selected_numbered
      group by period_start, period_end, selected_days
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
            and attendance.attendance_type = 'full'
            and attendance.attendance_date between rate.period_start and rate.period_end
            and attendance.attendance_date <= v_business_date
        ) as worked_full_shifts,
        (
          select count(*)::integer
          from public.attendance_records as attendance
          where attendance.collaborator_id = p_collaborator_id
            and attendance.status = 'present'
            and attendance.attendance_type = 'half'
            and attendance.attendance_date between rate.period_start and rate.period_end
            and attendance.attendance_date <= v_business_date
        ) as worked_half_shifts,
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
        full_calculation.amount as policy_target,
        partial_calculation.amount as selected_partial_amount,
        full_calculation.half_pay
      from period_stats as stats
      cross join lateral private.operations_calculate_shift_payment(
        stats.weekly_pay,
        stats.worked_full_shifts,
        stats.worked_half_shifts,
        stats.period_end <= v_business_date
      ) as full_calculation
      cross join lateral private.operations_calculate_shift_payment(
        stats.weekly_pay,
        stats.selected_full_shifts,
        stats.selected_half_shifts,
        false
      ) as partial_calculation
    ),
    period_suggestions as (
      select
        policy.*,
        case
          when policy.selected_days = policy.remaining_days
            then policy.policy_target - policy.already_allocated
          else policy.selected_partial_amount
        end as selected_suggestion
      from period_policy as policy
    ),
    selected_with_suggestion as (
      select
        selected.id,
        selected.attendance_date,
        selected.attendance_type,
        selected.period_end,
        selected.period_start,
        selected.selected_number,
        selected.selected_days,
        suggestion.selected_suggestion,
        suggestion.daily_pay,
        suggestion.half_pay,
        suggestion.weekly_pay
      from selected_numbered as selected
      join period_suggestions as suggestion
        on suggestion.period_start = selected.period_start
        and suggestion.period_end = selected.period_end
    ),
    selected_with_base as (
      select
        selected.*,
        case
          when selected.attendance_type = 'half' then selected.half_pay
          else selected.daily_pay
        end as base_allocation
      from selected_with_suggestion as selected
    ),
    selected_with_prior_base as (
      select
        selected.*,
        coalesce(
          sum(selected.base_allocation) over (
            partition by selected.period_end
            order by selected.attendance_date, selected.id
            rows between unbounded preceding and 1 preceding
          ),
          0
        ) as allocated_before
      from selected_with_base as selected
    )
    insert into public.payment_attendance_items (
      payment_id,
      attendance_id,
      work_date_snapshot,
      period_start,
      period_end,
      attendance_type_snapshot,
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
      selected.attendance_type,
      selected.weekly_pay,
      selected.daily_pay,
      case
        when selected.selected_number = selected.selected_days then
          selected.selected_suggestion - selected.allocated_before
        else selected.base_allocation
      end
    from selected_with_prior_base as selected;
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

revoke all on function public.confirm_collaborator_payment(
  uuid, uuid, uuid[], numeric, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.confirm_collaborator_payment(
  uuid, uuid, uuid[], numeric, text, uuid, text
) to authenticated;

revoke all on function private.operations_calculate_shift_payment(
  numeric, integer, integer, boolean
) from public, anon, authenticated;
