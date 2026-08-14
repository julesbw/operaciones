-- Exportación v2 de Cortes cerrados. La migración es aditiva y no se aplica
-- automáticamente: debe revisarse y ejecutarse después de las migraciones de
-- pagos y snapshots de Corte.

alter table public.cash_closings
  add column if not exists store_name_snapshot text;

update public.cash_closings as closing
set store_name_snapshot = store.name
from public.stores as store
where store.id = closing.store_id
  and closing.store_name_snapshot is null;

alter table public.cash_closings
  alter column store_name_snapshot set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cash_closings_store_name_snapshot_check'
      and conrelid = 'public.cash_closings'::regclass
  ) then
    alter table public.cash_closings
      add constraint cash_closings_store_name_snapshot_check check (
        length(btrim(store_name_snapshot)) > 0
        and length(store_name_snapshot) <= 120
      );
  end if;
end;
$$;

create or replace function private.operations_snapshot_closing_store_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select store.name
    into new.store_name_snapshot
    from public.stores as store
    where store.id = new.store_id;
  elsif new.store_id is distinct from old.store_id
    or new.store_name_snapshot is null then
    select store.name
    into new.store_name_snapshot
    from public.stores as store
    where store.id = new.store_id;
  end if;

  if new.store_name_snapshot is null then
    raise exception 'La tienda del corte no existe'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists cash_closings_snapshot_store_name
  on public.cash_closings;
create trigger cash_closings_snapshot_store_name
before insert or update of store_id on public.cash_closings
for each row execute function private.operations_snapshot_closing_store_name();

create table public.export_batches (
  id uuid primary key,
  contract_version text not null default '2.0'
    check (contract_version = '2.0'),
  status text not null default 'prepared'
    check (status in ('prepared', 'confirmed', 'cancelled')),
  payload_snapshot jsonb not null
    check (jsonb_typeof(payload_snapshot) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete restrict,
  cancelled_at timestamptz,
  constraint export_batches_state_check check (
    (
      status = 'prepared'
      and confirmed_by is null and confirmed_at is null
      and cancelled_by is null and cancelled_at is null
    )
    or (
      status = 'confirmed'
      and confirmed_by is not null and confirmed_at is not null
      and cancelled_by is null and cancelled_at is null
    )
    or (
      status = 'cancelled'
      and cancelled_by is not null and cancelled_at is not null
      and confirmed_by is null and confirmed_at is null
    )
  )
);

create index export_batches_created_at_idx
  on public.export_batches(created_at desc);
create index export_batches_status_created_at_idx
  on public.export_batches(status, created_at desc);

create table public.export_batch_items (
  batch_id uuid not null
    references public.export_batches(id) on delete restrict,
  source_type text not null default 'cash_closing',
  source_id uuid not null,
  cash_closing_id uuid references public.cash_closings(id) on delete restrict,
  reservation_status text not null default 'reserved'
    check (reservation_status in ('reserved', 'confirmed', 'released')),
  created_at timestamptz not null default now(),
  primary key (batch_id, source_type, source_id),
  constraint export_batch_items_closing_source_check check (
    source_type <> 'cash_closing'
    or (cash_closing_id is not null and cash_closing_id = source_id)
  )
);

create index export_batch_items_batch_idx
  on public.export_batch_items(batch_id);
create unique index export_batch_items_active_closing_key
  on public.export_batch_items(cash_closing_id)
  where cash_closing_id is not null
    and reservation_status in ('reserved', 'confirmed');

create or replace function private.operations_export_require_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'EXPORT_REQUIRES_ADMIN'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.operations_export_valid_physical_cash(
  p_bills jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_bills) = 'object'
    and coalesce((p_bills ->> 'b1000') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b500') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b200') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b100') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b50') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b20') ~ '^[0-9]+$', false)
    and coalesce(
      (p_bills ->> 'monedas') ~ '^[0-9]+([.][0-9]{1,2})?$',
      false
    );
$$;

create or replace function private.operations_export_bills_total(
  p_bills jsonb
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(
    (p_bills ->> 'b1000')::numeric * 1000
    + (p_bills ->> 'b500')::numeric * 500
    + (p_bills ->> 'b200')::numeric * 200
    + (p_bills ->> 'b100')::numeric * 100
    + (p_bills ->> 'b50')::numeric * 50
    + (p_bills ->> 'b20')::numeric * 20,
    2
  );
$$;

create or replace function public.get_export_candidates(
  p_store_id uuid default null,
  p_date_from date default null,
  p_date_to date default null
)
returns table (
  id uuid,
  store_id uuid,
  store_name text,
  business_date date,
  sequence_number integer,
  gross_cash numeric,
  expenses_total numeric,
  cash_expenses_total numeric,
  store_cash_payments_total numeric,
  net_cash numeric,
  cash_balance numeric,
  physical_cash_amount numeric,
  transfers_total numeric,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.operations_export_require_admin();

  if p_date_from is not null and p_date_to is not null
    and p_date_from > p_date_to then
    raise exception 'El rango de fechas no es válido'
      using errcode = '22007';
  end if;

  return query
  select
    closing.id,
    closing.store_id,
    closing.store_name_snapshot,
    closing.business_date,
    closing.closing_number,
    round(
      closing.counted_cash
      + closing.cash_expenses_total_snapshot
      + closing.store_cash_payments_total_snapshot,
      2
    ),
    closing.expenses_total_snapshot,
    closing.cash_expenses_total_snapshot,
    closing.store_cash_payments_total_snapshot,
    closing.counted_cash,
    closing.cash_balance,
    closing.cash_to_withdraw,
    closing.outgoing_transfers_total_snapshot,
    closing.closed_at
  from public.cash_closings as closing
  where closing.status = 'closed'
    and (p_store_id is null or closing.store_id = p_store_id)
    and (p_date_from is null or closing.business_date >= p_date_from)
    and (p_date_to is null or closing.business_date <= p_date_to)
    and not exists (
      select 1
      from public.export_batch_items as item
      where item.cash_closing_id = closing.id
        and item.reservation_status in ('reserved', 'confirmed')
    )
  order by closing.business_date desc, closing.closing_number desc;
end;
$$;

create or replace function public.prepare_export_batch(
  p_batch_id uuid,
  p_closing_ids uuid[]
)
returns public.export_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.export_batches;
  v_requested_ids uuid[];
  v_existing_ids uuid[];
  v_created_at timestamptz := now();
  v_closing record;
  v_expenses_total numeric(12, 2);
  v_cash_expenses_total numeric(12, 2);
  v_payments_total numeric(12, 2);
  v_transfers_total numeric(12, 2);
  v_gross_cash numeric(12, 2);
  v_bills_total numeric(12, 2);
  v_coins_amount numeric(12, 2);
  v_expense_items jsonb;
  v_payment_items jsonb;
  v_transfer_items jsonb;
  v_expense_movements jsonb;
  v_payment_movements jsonb;
  v_financial_movements jsonb;
  v_cortes jsonb := '[]'::jsonb;
  v_payload jsonb;
begin
  perform private.operations_export_require_admin();

  if p_batch_id is null then
    raise exception 'EXPORT_BATCH_NOT_FOUND'
      using errcode = '22023', detail = 'El identificador del lote es obligatorio.';
  end if;

  select coalesce(array_agg(selected.id order by selected.id), '{}'::uuid[])
  into v_requested_ids
  from (
    select distinct id
    from unnest(coalesce(p_closing_ids, '{}'::uuid[])) as requested(id)
  ) as selected;

  if cardinality(v_requested_ids) = 0
    or cardinality(v_requested_ids) <> cardinality(coalesce(p_closing_ids, '{}'::uuid[])) then
    raise exception 'EXPORT_CLOSING_NOT_FOUND'
      using errcode = '22023', detail = 'La selección está vacía o contiene duplicados.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('operations_export_batch:' || p_batch_id::text, 0)
  );

  select batch.*
  into v_batch
  from public.export_batches as batch
  where batch.id = p_batch_id
  for update;

  if found then
    select coalesce(array_agg(item.source_id order by item.source_id), '{}'::uuid[])
    into v_existing_ids
    from public.export_batch_items as item
    where item.batch_id = p_batch_id
      and item.source_type = 'cash_closing';

    if v_existing_ids <> v_requested_ids then
      raise exception 'EXPORT_BATCH_ID_CONFLICT'
        using errcode = '23505', detail = 'El lote ya existe con otra selección.';
    end if;
    if v_batch.status = 'cancelled' then
      raise exception 'EXPORT_BATCH_CANCELLED' using errcode = '55000';
    end if;
    if v_batch.status = 'confirmed' then
      raise exception 'EXPORT_BATCH_ALREADY_CONFIRMED' using errcode = '55000';
    end if;
    return v_batch;
  end if;

  perform 1
  from public.cash_closings as closing
  where closing.id = any(v_requested_ids)
  order by closing.id
  for update;

  if cardinality(v_requested_ids) <> (
    select count(*)
    from public.cash_closings as closing
    where closing.id = any(v_requested_ids)
  ) then
    raise exception 'EXPORT_CLOSING_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.cash_closings as closing
    where closing.id = any(v_requested_ids)
      and closing.status <> 'closed'
  ) then
    raise exception 'EXPORT_CLOSING_NOT_CLOSED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.export_batch_items as item
    where item.cash_closing_id = any(v_requested_ids)
      and item.reservation_status = 'confirmed'
  ) then
    raise exception 'EXPORT_CLOSING_ALREADY_EXPORTED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.export_batch_items as item
    where item.cash_closing_id = any(v_requested_ids)
      and item.reservation_status = 'reserved'
  ) then
    raise exception 'EXPORT_CLOSING_ALREADY_RESERVED' using errcode = 'P0001';
  end if;

  for v_closing in
    select closing.*
    from public.cash_closings as closing
    where closing.id = any(v_requested_ids)
    order by closing.business_date, closing.store_name_snapshot, closing.closing_number
  loop
    select
      coalesce(sum(item.amount_snapshot), 0),
      coalesce(sum(item.amount_snapshot) filter (
        where item.payment_method_snapshot = 'efectivo'
      ), 0),
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', item.expense_id,
          'amount', item.amount_snapshot,
          'concept', item.concept_snapshot,
          'payment_method', item.payment_method_snapshot,
          'affects_cash', item.payment_method_snapshot = 'efectivo'
        ) order by item.created_at, item.expense_id
      ), '[]'::jsonb),
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', item.expense_id,
          'source_type', 'expense',
          'source_id', item.expense_id,
          'tipo', 'salida',
          'fecha_movimiento', v_closing.business_date,
          'monto', item.amount_snapshot,
          'concepto', item.concept_snapshot,
          'categoria', 'Gasto',
          'store_id', v_closing.store_id
        ) order by item.created_at, item.expense_id
      ) filter (where item.payment_method_snapshot = 'efectivo'), '[]'::jsonb)
    into
      v_expenses_total,
      v_cash_expenses_total,
      v_expense_items,
      v_expense_movements
    from public.cash_closing_expense_items as item
    where item.cash_closing_id = v_closing.id;

    select
      coalesce(sum(item.amount_snapshot), 0),
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', item.payment_id,
          'paid_amount', item.amount_snapshot,
          'collaborator_name', item.collaborator_name_snapshot,
          'funding_source', 'store_cash'
        ) order by item.created_at, item.payment_id
      ), '[]'::jsonb),
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', item.payment_id,
          'source_type', 'payment',
          'source_id', item.payment_id,
          'tipo', 'salida',
          'fecha_movimiento', v_closing.business_date,
          'monto', item.amount_snapshot,
          'concepto', 'Pago - ' || item.collaborator_name_snapshot,
          'categoria', 'Pago a colaborador',
          'store_id', v_closing.store_id
        ) order by item.created_at, item.payment_id
      ), '[]'::jsonb)
    into v_payments_total, v_payment_items, v_payment_movements
    from public.cash_closing_payment_items as item
    where item.cash_closing_id = v_closing.id;

    select
      coalesce(sum(item.amount_snapshot), 0),
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', item.transfer_id,
          'amount', item.amount_snapshot,
          'ticket_number', item.ticket_number_snapshot
        ) order by item.created_at, item.transfer_id
      ), '[]'::jsonb)
    into v_transfers_total, v_transfer_items
    from public.cash_closing_transfer_items as item
    where item.cash_closing_id = v_closing.id;

    if round(v_expenses_total, 2) <> v_closing.expenses_total_snapshot
      or round(v_cash_expenses_total, 2) <> v_closing.cash_expenses_total_snapshot
      or round(v_payments_total, 2) <> v_closing.store_cash_payments_total_snapshot
      or round(v_transfers_total, 2) <> v_closing.outgoing_transfers_total_snapshot then
      raise exception 'EXPORT_RECONCILIATION_ERROR'
        using errcode = 'P0001',
        detail = 'Los detalles históricos no coinciden con los totales del corte ' || v_closing.id::text || '.';
    end if;

    v_gross_cash := round(
      v_closing.counted_cash
      + v_closing.cash_expenses_total_snapshot
      + v_closing.store_cash_payments_total_snapshot,
      2
    );

    if round(
      v_gross_cash - v_cash_expenses_total - v_payments_total,
      2
    ) <> v_closing.counted_cash
      or round(v_closing.counted_cash - v_closing.cash_balance, 2)
        <> v_closing.cash_to_withdraw then
      raise exception 'EXPORT_RECONCILIATION_ERROR'
        using errcode = 'P0001',
        detail = 'La identidad financiera no se cumple para el corte ' || v_closing.id::text || '.';
    end if;

    if not private.operations_export_valid_physical_cash(v_closing.withdraw_bills) then
      raise exception 'EXPORT_BILLS_MISMATCH'
        using errcode = 'P0001',
        detail = 'El desglose físico no es válido para el corte ' || v_closing.id::text || '.';
    end if;

    v_bills_total := private.operations_export_bills_total(v_closing.withdraw_bills);
    v_coins_amount := round((v_closing.withdraw_bills ->> 'monedas')::numeric, 2);

    if round(v_bills_total + v_coins_amount, 2) <> v_closing.cash_to_withdraw then
      raise exception 'EXPORT_BILLS_MISMATCH'
        using errcode = 'P0001',
        detail = 'Billetes y monedas no coinciden con el retiro del corte ' || v_closing.id::text || '.';
    end if;

    v_financial_movements := jsonb_build_array(
      jsonb_build_object(
        'id', v_closing.id,
        'source_type', 'cash_closing',
        'source_id', v_closing.id,
        'tipo', 'entrada',
        'fecha_movimiento', v_closing.business_date,
        'monto', v_gross_cash,
        'concepto', 'Efectivo del día - ' || v_closing.store_name_snapshot
          || ' - Corte #' || v_closing.closing_number::text,
        'categoria', 'Corte de caja',
        'store_id', v_closing.store_id
      )
    ) || v_expense_movements || v_payment_movements;

    v_cortes := v_cortes || jsonb_build_array(
      jsonb_build_object(
        'id', v_closing.id,
        'store_id', v_closing.store_id,
        'store_name', v_closing.store_name_snapshot,
        'business_date', v_closing.business_date,
        'sequence_number', v_closing.closing_number,
        'gross_cash', v_gross_cash,
        'expenses_total', v_closing.expenses_total_snapshot,
        'cash_expenses_total', v_closing.cash_expenses_total_snapshot,
        'store_cash_payments_total', v_closing.store_cash_payments_total_snapshot,
        'net_cash', v_closing.counted_cash,
        'cash_balance', v_closing.cash_balance,
        'physical_cash_amount', v_closing.cash_to_withdraw,
        'transfers_total', v_closing.outgoing_transfers_total_snapshot,
        'expense_items', v_expense_items,
        'payment_items', v_payment_items,
        'transfer_items', v_transfer_items,
        'financial_movements', v_financial_movements,
        'physical_cash', jsonb_build_object(
          'amount', v_closing.cash_to_withdraw,
          'bills_total', v_bills_total,
          'bills', jsonb_build_object(
            'b1000', (v_closing.withdraw_bills ->> 'b1000')::integer,
            'b500', (v_closing.withdraw_bills ->> 'b500')::integer,
            'b200', (v_closing.withdraw_bills ->> 'b200')::integer,
            'b100', (v_closing.withdraw_bills ->> 'b100')::integer,
            'b50', (v_closing.withdraw_bills ->> 'b50')::integer,
            'b20', (v_closing.withdraw_bills ->> 'b20')::integer
          ),
          'coins_amount', v_coins_amount
        ),
        'closed_at', v_closing.closed_at
      )
    );
  end loop;

  v_payload := jsonb_build_object(
    'version', '2.0',
    'origen', 'operaciones_pwa',
    'tipo_exportacion', 'cash_closings',
    'lote_exportacion_id', p_batch_id,
    'fecha_exportacion', v_created_at,
    'zona_horaria', 'America/Mexico_City',
    'total_cortes', cardinality(v_requested_ids),
    'cortes', v_cortes
  );

  insert into public.export_batches (
    id, contract_version, status, payload_snapshot, created_by, created_at
  ) values (
    p_batch_id, '2.0', 'prepared', v_payload, auth.uid(), v_created_at
  )
  returning * into v_batch;

  begin
    insert into public.export_batch_items (
      batch_id, source_type, source_id, cash_closing_id, reservation_status
    )
    select p_batch_id, 'cash_closing', closing_id, closing_id, 'reserved'
    from unnest(v_requested_ids) as selected(closing_id);
  exception when unique_violation then
    raise exception 'EXPORT_CLOSING_ALREADY_RESERVED'
      using errcode = 'P0001', detail = 'Un corte fue reservado concurrentemente.';
  end;

  return v_batch;
end;
$$;

create or replace function public.confirm_export_batch(p_batch_id uuid)
returns public.export_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.export_batches;
begin
  perform private.operations_export_require_admin();

  select batch.* into v_batch
  from public.export_batches as batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception 'EXPORT_BATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_batch.status = 'confirmed' then
    return v_batch;
  end if;
  if v_batch.status = 'cancelled' then
    raise exception 'EXPORT_BATCH_CANCELLED' using errcode = '55000';
  end if;

  update public.export_batches
  set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_batch_id
  returning * into v_batch;

  update public.export_batch_items
  set reservation_status = 'confirmed'
  where batch_id = p_batch_id and reservation_status = 'reserved';

  return v_batch;
end;
$$;

create or replace function public.cancel_export_batch(p_batch_id uuid)
returns public.export_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.export_batches;
begin
  perform private.operations_export_require_admin();

  select batch.* into v_batch
  from public.export_batches as batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception 'EXPORT_BATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_batch.status = 'cancelled' then
    return v_batch;
  end if;
  if v_batch.status = 'confirmed' then
    raise exception 'EXPORT_BATCH_ALREADY_CONFIRMED' using errcode = '55000';
  end if;

  update public.export_batches
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
  where id = p_batch_id
  returning * into v_batch;

  update public.export_batch_items
  set reservation_status = 'released'
  where batch_id = p_batch_id and reservation_status = 'reserved';

  return v_batch;
end;
$$;

alter table public.export_batches enable row level security;
alter table public.export_batch_items enable row level security;

create policy "admins can read export batches"
on public.export_batches for select to authenticated
using ((select private.is_admin()));

create policy "admins can read export batch items"
on public.export_batch_items for select to authenticated
using ((select private.is_admin()));

revoke all on public.export_batches from public, anon, authenticated;
revoke all on public.export_batch_items from public, anon, authenticated;
grant select on public.export_batches to authenticated;
grant select on public.export_batch_items to authenticated;

revoke all on function private.operations_snapshot_closing_store_name()
  from public, anon, authenticated;
revoke all on function private.operations_export_require_admin()
  from public, anon, authenticated;
revoke all on function private.operations_export_valid_physical_cash(jsonb)
  from public, anon, authenticated;
revoke all on function private.operations_export_bills_total(jsonb)
  from public, anon, authenticated;

revoke all on function public.get_export_candidates(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.get_export_candidates(uuid, date, date)
  to authenticated;

revoke all on function public.prepare_export_batch(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.prepare_export_batch(uuid, uuid[])
  to authenticated;

revoke all on function public.confirm_export_batch(uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_export_batch(uuid)
  to authenticated;

revoke all on function public.cancel_export_batch(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_export_batch(uuid)
  to authenticated;

comment on column public.cash_closings.store_name_snapshot is
  'Nombre histórico de la tienda congelado al crear el Corte.';
comment on table public.export_batches is
  'Lotes autoritativos de exportación. payload_snapshot nunca se reconstruye después de preparar.';
comment on table public.export_batch_items is
  'Fuentes reservadas o representadas por un lote; permite agregar otros source_type en fases futuras.';
comment on function public.prepare_export_batch(uuid, uuid[]) is
  'Valida y reserva Cortes cerrados, construye el contrato Operaciones 2.0 sólo desde snapshots y conserva el payload.';
