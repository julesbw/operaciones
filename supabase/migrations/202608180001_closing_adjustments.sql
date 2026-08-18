-- Ajustes append-only para Cortes cerrados.
-- Revisar y aplicar manualmente después de 202608170002_collaborator_status.sql.

create table public.cash_closing_adjustments (
  id uuid primary key,
  cash_closing_id uuid not null
    references public.cash_closings(id) on delete restrict,
  type text not null check (type in ('inflow', 'outflow')),
  amount numeric(12, 2) not null check (amount > 0),
  concept text not null check (length(btrim(concept)) between 1 and 200),
  notes text check (notes is null or length(notes) <= 1000),
  bills jsonb not null check (jsonb_typeof(bills) = 'object'),
  coins_amount numeric(12, 2) not null default 0 check (coins_amount >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index cash_closing_adjustments_closing_idx
  on public.cash_closing_adjustments(cash_closing_id, created_at, id);

create or replace function private.operations_closing_adjustment_net(
  p_cash_closing_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(coalesce(sum(
    case when adjustment.type = 'inflow'
      then adjustment.amount
      else -adjustment.amount
    end
  ), 0), 2)
  from public.cash_closing_adjustments as adjustment
  where adjustment.cash_closing_id = p_cash_closing_id;
$$;

create or replace function private.operations_closing_effective_withdraw_bills(
  p_cash_closing_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'b1000', (closing.withdraw_bills ->> 'b1000')::numeric + coalesce(sum(
      case when adjustment.type = 'inflow'
        then (adjustment.bills ->> 'b1000')::numeric
        else -(adjustment.bills ->> 'b1000')::numeric
      end
    ), 0),
    'b500', (closing.withdraw_bills ->> 'b500')::numeric + coalesce(sum(
      case when adjustment.type = 'inflow'
        then (adjustment.bills ->> 'b500')::numeric
        else -(adjustment.bills ->> 'b500')::numeric
      end
    ), 0),
    'b200', (closing.withdraw_bills ->> 'b200')::numeric + coalesce(sum(
      case when adjustment.type = 'inflow'
        then (adjustment.bills ->> 'b200')::numeric
        else -(adjustment.bills ->> 'b200')::numeric
      end
    ), 0),
    'b100', (closing.withdraw_bills ->> 'b100')::numeric + coalesce(sum(
      case when adjustment.type = 'inflow'
        then (adjustment.bills ->> 'b100')::numeric
        else -(adjustment.bills ->> 'b100')::numeric
      end
    ), 0),
    'b50', (closing.withdraw_bills ->> 'b50')::numeric + coalesce(sum(
      case when adjustment.type = 'inflow'
        then (adjustment.bills ->> 'b50')::numeric
        else -(adjustment.bills ->> 'b50')::numeric
      end
    ), 0),
    'b20', (closing.withdraw_bills ->> 'b20')::numeric + coalesce(sum(
      case when adjustment.type = 'inflow'
        then (adjustment.bills ->> 'b20')::numeric
        else -(adjustment.bills ->> 'b20')::numeric
      end
    ), 0),
    'monedas', (closing.withdraw_bills ->> 'monedas')::numeric + coalesce(sum(
      case when adjustment.type = 'inflow'
        then adjustment.coins_amount
        else -adjustment.coins_amount
      end
    ), 0)
  )
  from public.cash_closings as closing
  left join public.cash_closing_adjustments as adjustment
    on adjustment.cash_closing_id = closing.id
  where closing.id = p_cash_closing_id
  group by closing.id, closing.withdraw_bills;
$$;

create or replace function private.operations_closing_adjustment_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'CLOSING_ADJUSTMENT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

create trigger cash_closing_adjustments_immutable
before update or delete on public.cash_closing_adjustments
for each row execute function private.operations_closing_adjustment_immutable();

create or replace function public.create_cash_closing_adjustment(
  p_id uuid,
  p_cash_closing_id uuid,
  p_type text,
  p_amount numeric,
  p_concept text,
  p_notes text,
  p_bills jsonb,
  p_coins_amount numeric
)
returns public.cash_closing_adjustments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.cash_closing_adjustments;
  v_adjustment public.cash_closing_adjustments;
  v_closing public.cash_closings;
  v_effective_bills jsonb;
  v_effective_coins numeric(12, 2);
  v_effective_amount numeric(12, 2);
  v_effective_counted numeric(12, 2);
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'CLOSING_ADJUSTMENT_REQUIRES_ADMIN' using errcode = '42501';
  end if;

  if p_id is null or p_cash_closing_id is null then
    raise exception 'CLOSING_ADJUSTMENT_NOT_FOUND' using errcode = '22023';
  end if;

  select adjustment.* into v_existing
  from public.cash_closing_adjustments as adjustment
  where adjustment.id = p_id;

  if found then
    if v_existing.cash_closing_id is distinct from p_cash_closing_id
      or v_existing.type is distinct from p_type
      or v_existing.amount is distinct from round(p_amount, 2)
      or v_existing.concept is distinct from btrim(p_concept)
      or v_existing.notes is distinct from nullif(btrim(p_notes), '')
      or v_existing.bills is distinct from p_bills
      or v_existing.coins_amount is distinct from round(p_coins_amount, 2) then
      raise exception 'CLOSING_ADJUSTMENT_REQUEST_ID_CONFLICT'
        using errcode = '23505';
    end if;
    return v_existing;
  end if;

  if p_type not in ('inflow', 'outflow') then
    raise exception 'CLOSING_ADJUSTMENT_INVALID_TYPE' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    raise exception 'CLOSING_ADJUSTMENT_INVALID_AMOUNT' using errcode = '22023';
  end if;
  if p_concept is null or length(btrim(p_concept)) = 0
    or length(btrim(p_concept)) > 200 then
    raise exception 'CLOSING_ADJUSTMENT_INVALID_CONCEPT' using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    raise exception 'CLOSING_ADJUSTMENT_INVALID_NOTES' using errcode = '22023';
  end if;
  if p_coins_amount is null or p_coins_amount < 0
    or round(p_coins_amount, 2) <> p_coins_amount then
    raise exception 'CLOSING_ADJUSTMENT_BILLS_MISMATCH' using errcode = '22023';
  end if;
  if not private.operations_central_cash_valid_bills(p_bills) then
    raise exception 'CLOSING_ADJUSTMENT_BILLS_MISMATCH' using errcode = '23514';
  end if;
  if round(
    private.operations_central_cash_bills_total(p_bills) + p_coins_amount, 2
  ) is distinct from round(p_amount, 2) then
    raise exception 'CLOSING_ADJUSTMENT_BILLS_MISMATCH' using errcode = '23514';
  end if;

  select closing.* into v_closing
  from public.cash_closings as closing
  where closing.id = p_cash_closing_id
  for update;

  if not found then
    raise exception 'CLOSING_ADJUSTMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_closing.status <> 'closed' then
    raise exception 'CLOSING_ADJUSTMENT_NOT_CLOSED' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.central_cash_receipts as receipt
    where receipt.cash_closing_id = p_cash_closing_id
  ) then
    raise exception 'CLOSING_ADJUSTMENT_ALREADY_RECEIVED' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.export_batch_items as item
    join public.export_batches as batch on batch.id = item.batch_id
    where item.cash_closing_id = p_cash_closing_id
      and batch.status = 'prepared'
  ) then
    raise exception 'CLOSING_ADJUSTMENT_EXPORT_PREPARED' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.export_batch_items as item
    join public.export_batches as batch on batch.id = item.batch_id
    where item.cash_closing_id = p_cash_closing_id
      and batch.status = 'confirmed'
  ) then
    raise exception 'CLOSING_ADJUSTMENT_ALREADY_EXPORTED' using errcode = '55000';
  end if;

  insert into public.cash_closing_adjustments (
    id, cash_closing_id, type, amount, concept, notes, bills, coins_amount,
    created_by
  ) values (
    p_id, p_cash_closing_id, p_type, round(p_amount, 2), btrim(p_concept),
    nullif(btrim(p_notes), ''), p_bills, round(p_coins_amount, 2), auth.uid()
  ) returning * into v_adjustment;

  v_effective_bills := private.operations_closing_effective_withdraw_bills(
    p_cash_closing_id
  );
  v_effective_coins := round((v_effective_bills ->> 'monedas')::numeric, 2);
  v_effective_amount := round(
    v_closing.cash_to_withdraw
      + private.operations_closing_adjustment_net(p_cash_closing_id), 2
  );
  v_effective_counted := round(
    v_closing.counted_cash
      + private.operations_closing_adjustment_net(p_cash_closing_id), 2
  );

  if v_effective_amount < 0 or v_effective_counted < v_closing.cash_balance
    or round(
      private.operations_central_cash_bills_total(v_effective_bills - 'monedas')
        + v_effective_coins, 2
    ) is distinct from v_effective_amount then
    raise exception 'CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT'
      using errcode = '23514';
  end if;

  return v_adjustment;
end;
$$;

alter table public.cash_closing_adjustments enable row level security;
create policy "admins can read closing adjustments"
on public.cash_closing_adjustments for select to authenticated
using ((select private.is_admin()));

revoke all on public.cash_closing_adjustments from public, anon, authenticated;
grant select on public.cash_closing_adjustments to authenticated;
revoke all on function public.create_cash_closing_adjustment(
  uuid, uuid, text, numeric, text, text, jsonb, numeric
) from public, anon, authenticated;
grant execute on function public.create_cash_closing_adjustment(
  uuid, uuid, text, numeric, text, text, jsonb, numeric
) to authenticated;

-- The existing central-cash readers now expose effective values.
create or replace function public.get_central_cash_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'America/Mexico_City')::date;
  v_result jsonb;
begin
  perform private.operations_central_cash_require_admin();
  select pg_catalog.jsonb_build_object(
    'balance', coalesce(sum(case when movement.movement_type = 'inflow'
      then movement.amount else -movement.amount end), 0),
    'today_inflows', coalesce(sum(movement.amount) filter (
      where movement.business_date = v_today and movement.movement_type = 'inflow'
    ), 0),
    'today_outflows', coalesce(sum(movement.amount) filter (
      where movement.business_date = v_today and movement.movement_type = 'outflow'
    ), 0),
    'today_net', coalesce(sum(case when movement.movement_type = 'inflow'
      then movement.amount else -movement.amount end)
      filter (where movement.business_date = v_today), 0),
    'bills', pg_catalog.jsonb_build_object(
      'b1000', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b1000')::integer
        else -(movement.bills_snapshot ->> 'b1000')::integer end), 0),
      'b500', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b500')::integer
        else -(movement.bills_snapshot ->> 'b500')::integer end), 0),
      'b200', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b200')::integer
        else -(movement.bills_snapshot ->> 'b200')::integer end), 0),
      'b100', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b100')::integer
        else -(movement.bills_snapshot ->> 'b100')::integer end), 0),
      'b50', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b50')::integer
        else -(movement.bills_snapshot ->> 'b50')::integer end), 0),
      'b20', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b20')::integer
        else -(movement.bills_snapshot ->> 'b20')::integer end), 0)
    ),
    'coins_amount', coalesce(sum(case when movement.movement_type = 'inflow'
      then movement.coins_amount else -movement.coins_amount end), 0)
  ) into v_result
  from public.central_cash_movements as movement;

  return v_result || pg_catalog.jsonb_build_object(
    'pending_closings_count', (
      select count(*) from public.cash_closings as closing
      where closing.status = 'closed'
        and not exists (select 1 from public.central_cash_receipts as receipt
          where receipt.cash_closing_id = closing.id)
    ),
    'pending_closings_amount', (
      select coalesce(sum(round(
        closing.cash_to_withdraw
          + private.operations_closing_adjustment_net(closing.id), 2
      )), 0)
      from public.cash_closings as closing
      where closing.status = 'closed'
        and not exists (select 1 from public.central_cash_receipts as receipt
          where receipt.cash_closing_id = closing.id)
    )
  );
end;
$$;

create or replace function public.list_pending_central_cash_closings(
  p_store_id uuid default null,
  p_date_from date default null,
  p_date_to date default null
)
returns table (
  id uuid, store_id uuid, store_name text, business_date date,
  sequence_number integer, cash_to_withdraw numeric, withdraw_bills jsonb,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.operations_central_cash_require_admin();
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'El rango de fechas no es válido' using errcode = '22007';
  end if;
  return query
  select closing.id, closing.store_id, closing.store_name_snapshot,
    closing.business_date, closing.closing_number,
    round(closing.cash_to_withdraw
      + private.operations_closing_adjustment_net(closing.id), 2),
    private.operations_closing_effective_withdraw_bills(closing.id),
    closing.closed_at
  from public.cash_closings as closing
  where closing.status = 'closed'
    and (p_store_id is null or closing.store_id = p_store_id)
    and (p_date_from is null or closing.business_date >= p_date_from)
    and (p_date_to is null or closing.business_date <= p_date_to)
    and not exists (select 1 from public.central_cash_receipts as receipt
      where receipt.cash_closing_id = closing.id)
  order by closing.business_date desc, closing.closing_number desc;
end;
$$;

create or replace function public.receive_cash_closing_into_central_cash(
  p_receipt_id uuid,
  p_cash_closing_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closing public.cash_closings;
  v_existing_receipt public.central_cash_receipts;
  v_receipt public.central_cash_receipts;
  v_movement public.central_cash_movements;
  v_effective_bills jsonb;
  v_bills jsonb;
  v_coins numeric(12, 2);
  v_amount numeric(12, 2);
  v_actor_name text;
  v_received_at timestamptz := pg_catalog.now();
begin
  perform private.operations_central_cash_require_admin();
  if p_receipt_id is null or p_cash_closing_id is null then
    raise exception 'Los identificadores de recepción son obligatorios' using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 500 then
    raise exception 'Las notas no pueden exceder 500 caracteres' using errcode = '22001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('operations.central_cash_ledger')
  );
  select receipt.* into v_existing_receipt
  from public.central_cash_receipts as receipt where receipt.id = p_receipt_id;
  if found then
    if v_existing_receipt.cash_closing_id is distinct from p_cash_closing_id then
      raise exception 'CENTRAL_CASH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    select movement.* into v_movement
    from public.central_cash_movements as movement where movement.id = v_existing_receipt.movement_id;
    return pg_catalog.jsonb_build_object('receipt', to_jsonb(v_existing_receipt), 'movement', to_jsonb(v_movement));
  end if;

  select closing.* into v_closing
  from public.cash_closings as closing where closing.id = p_cash_closing_id for update;
  if not found then
    raise exception 'CENTRAL_CASH_CLOSING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_closing.status <> 'closed' then
    raise exception 'CENTRAL_CASH_CLOSING_NOT_CLOSED' using errcode = '55000';
  end if;
  if exists (select 1 from public.central_cash_receipts as receipt
    where receipt.cash_closing_id = p_cash_closing_id) then
    raise exception 'CENTRAL_CASH_CLOSING_ALREADY_RECEIVED' using errcode = '23505';
  end if;

  v_effective_bills := private.operations_closing_effective_withdraw_bills(p_cash_closing_id);
  v_bills := v_effective_bills - 'monedas';
  v_coins := round((v_effective_bills ->> 'monedas')::numeric, 2);
  v_amount := round(v_closing.cash_to_withdraw
    + private.operations_closing_adjustment_net(p_cash_closing_id), 2);
  if v_amount <= 0 or not private.operations_central_cash_valid_bills(v_bills)
    or v_coins < 0
    or round(private.operations_central_cash_bills_total(v_bills) + v_coins, 2)
      is distinct from v_amount then
    raise exception 'CENTRAL_CASH_CLOSING_MISMATCH' using errcode = '23514';
  end if;

  select coalesce(nullif(btrim(profile.full_name), ''), 'Administrador')
  into v_actor_name from public.profiles as profile where profile.id = auth.uid();
  v_actor_name := coalesce(v_actor_name, 'Administrador');

  insert into public.central_cash_movements (
    id, movement_type, source_type, source_id, amount, business_date, concept,
    notes, bills_snapshot, coins_amount, store_id_snapshot, store_name_snapshot,
    sequence_number_snapshot, created_by, created_by_name_snapshot, created_at
  ) values (
    pg_catalog.gen_random_uuid(), 'inflow', 'cash_closing', v_closing.id,
    v_amount, v_closing.business_date,
    pg_catalog.format('Corte #%s · %s', v_closing.closing_number, v_closing.store_name_snapshot),
    nullif(btrim(p_notes), ''), v_bills, v_coins, v_closing.store_id,
    v_closing.store_name_snapshot, v_closing.closing_number, auth.uid(),
    v_actor_name, v_received_at
  ) returning * into v_movement;

  insert into public.central_cash_receipts (
    id, cash_closing_id, movement_id, amount_snapshot, bills_snapshot,
    coins_amount_snapshot, store_id_snapshot, store_name_snapshot,
    sequence_number_snapshot, business_date, notes, received_by,
    received_by_name_snapshot, received_at
  ) values (
    p_receipt_id, v_closing.id, v_movement.id, v_amount, v_bills, v_coins,
    v_closing.store_id, v_closing.store_name_snapshot, v_closing.closing_number,
    v_closing.business_date, nullif(btrim(p_notes), ''), auth.uid(),
    v_actor_name, v_received_at
  ) returning * into v_receipt;
  return pg_catalog.jsonb_build_object('receipt', to_jsonb(v_receipt), 'movement', to_jsonb(v_movement));
end;
$$;

-- Candidates expose effective amounts while keeping the original Corte intact.
create or replace function public.get_export_candidates(
  p_store_id uuid default null,
  p_date_from date default null,
  p_date_to date default null
)
returns table (
  id uuid, store_id uuid, store_name text, business_date date,
  sequence_number integer, gross_cash numeric, expenses_total numeric,
  cash_expenses_total numeric, store_cash_payments_total numeric,
  purchases_total numeric, cash_purchases_total numeric,
  net_cash numeric, cash_balance numeric, physical_cash_amount numeric,
  transfers_total numeric, closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.operations_export_require_admin();
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'El rango de fechas no es válido' using errcode = '22007';
  end if;
  return query
  select closing.id, closing.store_id, closing.store_name_snapshot,
    closing.business_date, closing.closing_number,
    round(closing.counted_cash + private.operations_closing_adjustment_net(closing.id)
      + closing.cash_expenses_total_snapshot + closing.store_cash_payments_total_snapshot
      + closing.cash_purchases_total_snapshot, 2),
    closing.expenses_total_snapshot, closing.cash_expenses_total_snapshot,
    closing.store_cash_payments_total_snapshot,
    closing.purchases_total_snapshot, closing.cash_purchases_total_snapshot,
    round(closing.counted_cash + private.operations_closing_adjustment_net(closing.id), 2),
    closing.cash_balance,
    round(closing.cash_to_withdraw + private.operations_closing_adjustment_net(closing.id), 2),
    closing.outgoing_transfers_total_snapshot, closing.closed_at
  from public.cash_closings as closing
  where closing.status = 'closed'
    and (p_store_id is null or closing.store_id = p_store_id)
    and (p_date_from is null or closing.business_date >= p_date_from)
    and (p_date_to is null or closing.business_date <= p_date_to)
    and not exists (
      select 1 from public.export_batch_items as item
      where item.cash_closing_id = closing.id
        and item.reservation_status in ('reserved', 'confirmed')
    )
  order by closing.business_date desc, closing.closing_number desc;
end;
$$;

-- Keep the existing 2.0 builder as the snapshot validator, then enrich its
-- payload without changing the original cash_closings row.
alter function public.prepare_export_batch(uuid, uuid[])
  rename to prepare_export_batch_original;

create or replace function private.operations_export_apply_closing_adjustments(
  p_batch_id uuid
)
returns public.export_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.export_batches;
  v_closing jsonb;
  v_adjustments jsonb;
  v_adjustment_movements jsonb;
  v_new_cortes jsonb := '[]'::jsonb;
  v_net numeric(12, 2);
  v_amount numeric(12, 2);
  v_bills jsonb;
  v_coins numeric(12, 2);
  v_financial_movements jsonb;
begin
  select batch.* into v_batch from public.export_batches as batch
  where batch.id = p_batch_id for update;
  if not found then raise exception 'EXPORT_BATCH_NOT_FOUND' using errcode = 'P0001'; end if;

  for v_closing in select value from jsonb_array_elements(v_batch.payload_snapshot -> 'cortes') loop
    if v_closing ? 'closing_adjustments' then
      v_new_cortes := v_new_cortes || jsonb_build_array(v_closing);
      continue;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', adjustment.id, 'type', adjustment.type, 'amount', adjustment.amount,
      'concept', adjustment.concept, 'notes', adjustment.notes,
      'bills', adjustment.bills, 'coins_amount', adjustment.coins_amount,
      'created_by', adjustment.created_by, 'created_at', adjustment.created_at
    ) order by adjustment.created_at, adjustment.id), '[]'::jsonb),
      round(coalesce(sum(case when adjustment.type = 'inflow'
        then adjustment.amount else -adjustment.amount end), 0), 2)
    into v_adjustments, v_net
    from public.cash_closing_adjustments as adjustment
    where adjustment.cash_closing_id = (v_closing ->> 'id')::uuid;

    select jsonb_build_object(
      'b1000', (v_closing -> 'physical_cash' -> 'bills' ->> 'b1000')::numeric + coalesce(sum(case when adjustment.type = 'inflow' then (adjustment.bills ->> 'b1000')::numeric else -(adjustment.bills ->> 'b1000')::numeric end), 0),
      'b500', (v_closing -> 'physical_cash' -> 'bills' ->> 'b500')::numeric + coalesce(sum(case when adjustment.type = 'inflow' then (adjustment.bills ->> 'b500')::numeric else -(adjustment.bills ->> 'b500')::numeric end), 0),
      'b200', (v_closing -> 'physical_cash' -> 'bills' ->> 'b200')::numeric + coalesce(sum(case when adjustment.type = 'inflow' then (adjustment.bills ->> 'b200')::numeric else -(adjustment.bills ->> 'b200')::numeric end), 0),
      'b100', (v_closing -> 'physical_cash' -> 'bills' ->> 'b100')::numeric + coalesce(sum(case when adjustment.type = 'inflow' then (adjustment.bills ->> 'b100')::numeric else -(adjustment.bills ->> 'b100')::numeric end), 0),
      'b50', (v_closing -> 'physical_cash' -> 'bills' ->> 'b50')::numeric + coalesce(sum(case when adjustment.type = 'inflow' then (adjustment.bills ->> 'b50')::numeric else -(adjustment.bills ->> 'b50')::numeric end), 0),
      'b20', (v_closing -> 'physical_cash' -> 'bills' ->> 'b20')::numeric + coalesce(sum(case when adjustment.type = 'inflow' then (adjustment.bills ->> 'b20')::numeric else -(adjustment.bills ->> 'b20')::numeric end), 0)
    ), round((v_closing -> 'physical_cash' ->> 'coins_amount')::numeric + coalesce(sum(case when adjustment.type = 'inflow' then adjustment.coins_amount else -adjustment.coins_amount end), 0), 2)
    into v_bills, v_coins
    from public.cash_closing_adjustments as adjustment
    where adjustment.cash_closing_id = (v_closing ->> 'id')::uuid;

    v_amount := round((v_closing -> 'physical_cash' ->> 'amount')::numeric + v_net, 2);
    if v_amount <= 0 or (select bool_and(value::numeric >= 0) from jsonb_each_text(v_bills)) is not true
      or round(private.operations_export_bills_total(v_bills) + v_coins, 2) is distinct from v_amount then
      raise exception 'EXPORT_BILLS_MISMATCH' using errcode = 'P0001';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', adjustment.id, 'source_type', 'closing_adjustment', 'source_id', adjustment.id,
      'tipo', case when adjustment.type = 'inflow' then 'entrada' else 'salida' end,
      'fecha_movimiento', v_closing ->> 'business_date', 'monto', adjustment.amount,
      'concepto', adjustment.concept, 'categoria', 'Ajuste de Corte',
      'store_id', v_closing ->> 'store_id'
    ) order by adjustment.created_at, adjustment.id), '[]'::jsonb)
    into v_adjustment_movements
    from public.cash_closing_adjustments as adjustment
    where adjustment.cash_closing_id = (v_closing ->> 'id')::uuid;
    v_financial_movements := jsonb_set(
      v_closing -> 'financial_movements', '{0,monto}',
      to_jsonb(round((v_closing ->> 'gross_cash')::numeric + v_net, 2)), false
    ) || v_adjustment_movements;

    v_new_cortes := v_new_cortes || jsonb_build_array(
      v_closing || jsonb_build_object(
        'gross_cash', round((v_closing ->> 'gross_cash')::numeric + v_net, 2),
        'net_cash', round((v_closing ->> 'net_cash')::numeric + v_net, 2),
        'physical_cash_amount', v_amount,
        'adjustments_net', v_net,
        'effective_counted_cash', round((v_closing ->> 'net_cash')::numeric + v_net, 2),
        'effective_cash_to_withdraw', v_amount,
        'closing_adjustments', v_adjustments,
        'financial_movements', v_financial_movements,
        'physical_cash', jsonb_build_object(
          'amount', v_amount,
          'bills_total', private.operations_export_bills_total(v_bills),
          'bills', v_bills,
          'coins_amount', v_coins
        )
      )
    );
  end loop;

  update public.export_batches
  set payload_snapshot = v_batch.payload_snapshot || jsonb_build_object('cortes', v_new_cortes)
  where id = p_batch_id
  returning * into v_batch;
  return v_batch;
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
begin
  perform private.operations_export_require_admin();
  v_batch := public.prepare_export_batch_original(p_batch_id, p_closing_ids);
  return private.operations_export_apply_closing_adjustments(v_batch.id);
end;
$$;

revoke all on function public.prepare_export_batch_original(uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.prepare_export_batch(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.prepare_export_batch(uuid, uuid[])
  to authenticated;

comment on table public.cash_closing_adjustments is
  'Movimientos append-only que corrigen efectivo físico y financiero de un Corte cerrado.';
comment on function public.create_cash_closing_adjustment(uuid, uuid, text, numeric, text, text, jsonb, numeric) is
  'Crea un ajuste idempotente y revalida en una sola transacción todos los bloqueos del Corte.';
