-- Conecta Gastos con Caja Central sin cambiar la semántica histórica de
-- Gastos existentes. Revisar y aplicar manualmente después de las migraciones
-- de Compras y desglose de efectivo.

alter table public.expenses
  add column funding_source text not null default 'store_cash',
  add column source_store_id uuid references public.stores(id) on delete restrict;

-- La asociación a un Corte sigue siendo inmutable. La única excepción
-- permitida aquí es el backfill derivado de metadata para Gastos legacy:
-- ningún dato financiero, autor, fecha o versión puede cambiar.
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
    if tg_op = 'UPDATE'
      and old.funding_source = 'store_cash'
      and old.source_store_id is null
      and new.funding_source = 'store_cash'
      and new.source_store_id = old.store_id
      and new.store_id is not distinct from old.store_id
      and new.business_date is not distinct from old.business_date
      and new.amount is not distinct from old.amount
      and new.concept is not distinct from old.concept
      and new.payment_method is not distinct from old.payment_method
      and new.notes is not distinct from old.notes
      and new.weekly_payment_id is not distinct from old.weekly_payment_id
      and new.created_by is not distinct from old.created_by
      and new.created_at is not distinct from old.created_at
      and new.updated_at is not distinct from old.updated_at
      and new.version is not distinct from old.version then
      return new;
    end if;

    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = '55000',
      detail = 'El gasto pertenece a un corte cerrado.';
  end if;

  if tg_table_name = 'merchandise_transfers' and exists (
    select 1
    from public.cash_closing_transfer_items as item
    where item.transfer_id = old.id
  ) then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = '55000',
      detail = 'La transferencia pertenece a un corte cerrado.';
  end if;

  if tg_table_name = 'collaborator_payments' and exists (
    select 1
    from public.cash_closing_payment_items as item
    where item.payment_id = old.id
  ) then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = '55000',
      detail = 'El pago pertenece a un corte cerrado.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- El backfill sólo agrega metadata derivada. Los Gastos ya asociados a un
-- Corte son inmutables, por lo que se suspende únicamente su trigger de
-- asociación durante este UPDATE y se reactiva incluso si el backfill falla.
do $$
begin
  execute
    'alter table public.expenses disable trigger expenses_guard_assigned_movement';

  update public.expenses
  set source_store_id = store_id
  where source_store_id is null;

  execute
    'alter table public.expenses enable trigger expenses_guard_assigned_movement';
exception when others then
  execute
    'alter table public.expenses enable trigger expenses_guard_assigned_movement';
  raise;
end;
$$;

alter table public.expenses
  add constraint expenses_funding_source_check check (
    funding_source in ('store_cash', 'central_cash')
  ),
  add constraint expenses_funding_source_store_check check (
    (funding_source = 'store_cash' and source_store_id is not null)
    or (funding_source = 'central_cash' and source_store_id is null)
  );

create index expenses_source_store_date_idx
  on public.expenses(source_store_id, business_date desc)
  where funding_source = 'store_cash';

alter table public.central_cash_movements
  drop constraint if exists central_cash_movements_source_type_check;

alter table public.central_cash_movements
  add constraint central_cash_movements_source_type_check check (source_type in (
    'cash_closing',
    'manual_adjustment',
    'purchase',
    'purchase_coin_compensation',
    'expense',
    'expense_coin_compensation',
    'collaborator_payment',
    'bank_deposit',
    'other'
  ));

-- El flujo local-first existente sólo puede crear Gastos de Caja de Tienda.
-- Los Gastos de Caja Central usan la RPC atómica de abajo y nunca pasan por
-- SyncQueue.
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
    if v_existing.funding_source <> 'store_cash' then
      raise exception 'EXPENSE_CENTRAL_IMMUTABLE' using errcode = '55000';
    end if;
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
      notes, funding_source, source_store_id, created_by, created_at,
      updated_at, version
    )
    values (
      p_id, p_store_id, p_business_date, p_amount, btrim(p_concept),
      p_payment_method, nullif(btrim(p_notes), ''), 'store_cash', p_store_id,
      p_created_by, p_created_at, p_updated_at, 1
    )
    returning * into v_expense;
  end if;

  return v_expense;
end;
$$;

create or replace function public.create_central_cash_expense(
  p_expense_id uuid,
  p_store_id uuid,
  p_business_date date,
  p_amount numeric,
  p_concept text,
  p_payment_method text,
  p_notes text,
  p_funding_source text,
  p_bills jsonb,
  p_coins_amount numeric,
  p_created_at timestamptz,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.expenses;
  v_expense public.expenses;
  v_movement public.central_cash_movements;
  v_coin_compensation public.central_cash_movements;
  v_amount numeric(12, 2) := round(p_amount, 2);
  v_coins numeric(12, 2) := round(coalesce(p_coins_amount, 0), 2);
  v_empty_bills jsonb := jsonb_build_object(
    'b1000', 0, 'b500', 0, 'b200', 0,
    'b100', 0, 'b50', 0, 'b20', 0
  );
  v_profile_name text;
  v_store_active boolean;
  v_balance numeric(12, 2);
  v_available_bills jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'EXPENSE_REQUIRES_ADMIN' using errcode = '42501';
  end if;
  if p_created_by is distinct from auth.uid() then
    raise exception 'EXPENSE_AUTHOR_MISMATCH' using errcode = '42501';
  end if;
  if p_expense_id is null or p_store_id is null or p_created_at is null then
    raise exception 'EXPENSE_INVALID_INPUT' using errcode = '22023';
  end if;

  -- Serializa retries concurrentes del mismo UUID antes de comprobar si ya
  -- existe. El segundo request devuelve el resultado original.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('operations.expense:' || p_expense_id::text, 0)
  );

  select expense.* into v_existing
  from public.expenses as expense
  where expense.id = p_expense_id
  for update;

  if found then
    select movement.* into v_movement
    from public.central_cash_movements as movement
    where movement.source_type = 'expense'
      and movement.source_id = p_expense_id;

    select movement.* into v_coin_compensation
    from public.central_cash_movements as movement
    where movement.source_type = 'expense_coin_compensation'
      and movement.source_id = p_expense_id;

    if v_existing.funding_source = 'central_cash'
      and v_existing.store_id = p_store_id
      and v_existing.business_date = p_business_date
      and v_existing.amount = v_amount
      and v_existing.concept = btrim(p_concept)
      and v_existing.payment_method = p_payment_method
      and v_existing.notes is not distinct from nullif(btrim(p_notes), '')
      and v_existing.created_by = p_created_by
      and v_movement.id is not null
      and (
        (v_coins = 0 and v_coin_compensation.id is null)
        or (
          v_coins > 0
          and v_coin_compensation.id is not null
          and v_coin_compensation.amount = v_coins
        )
      ) then
      return jsonb_build_object(
        'expense', to_jsonb(v_existing),
        'movement', to_jsonb(v_movement),
        'coin_compensation', case
          when v_coin_compensation.id is null then null
          else to_jsonb(v_coin_compensation)
        end
      );
    end if;

    if v_existing.funding_source = 'central_cash'
      and v_existing.store_id = p_store_id
      and v_existing.business_date = p_business_date
      and v_existing.amount = v_amount
      and v_existing.concept = btrim(p_concept)
      and v_existing.payment_method = p_payment_method
      and v_existing.notes is not distinct from nullif(btrim(p_notes), '')
      and v_existing.created_by = p_created_by then
      raise exception 'EXPENSE_CENTRAL_LEDGER_INCOMPLETE' using errcode = '55000';
    end if;
    raise exception 'EXPENSE_REQUEST_ID_CONFLICT' using errcode = '23505';
  end if;

  if p_funding_source is distinct from 'central_cash' then
    raise exception 'EXPENSE_FUNDING_SOURCE_INVALID' using errcode = '22023';
  end if;
  if p_business_date is null or p_amount is null or v_amount <= 0
    or p_amount <> v_amount then
    raise exception 'EXPENSE_INVALID_AMOUNT' using errcode = '22023';
  end if;
  if p_concept is null or length(btrim(p_concept)) = 0
    or length(p_concept) > 160 then
    raise exception 'EXPENSE_INVALID_INPUT' using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 500 then
    raise exception 'EXPENSE_INVALID_INPUT' using errcode = '22001';
  end if;
  if p_payment_method is distinct from 'efectivo' then
    raise exception 'EXPENSE_CENTRAL_CASH_PAYMENT_METHOD' using errcode = '22023';
  end if;
  if p_coins_amount is null or p_coins_amount < 0
    or round(p_coins_amount, 2) is distinct from p_coins_amount
    or not private.operations_central_cash_valid_bills(p_bills)
    or round(
      private.operations_central_cash_bills_total(p_bills) + v_coins,
      2
    ) is distinct from v_amount then
    raise exception 'EXPENSE_BILLS_MISMATCH' using errcode = '22023';
  end if;

  select store.status = 'active'
  into v_store_active
  from public.stores as store
  where store.id = p_store_id
  for share;
  if not coalesce(v_store_active, false) then
    raise exception 'EXPENSE_STORE_FORBIDDEN' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('operations.central_cash_ledger')
  );

  select
    coalesce(sum(case when movement_type = 'inflow' then amount else -amount end), 0),
    jsonb_build_object(
      'b1000', coalesce(sum(case when movement_type = 'inflow' then (bills_snapshot->>'b1000')::integer else -(bills_snapshot->>'b1000')::integer end), 0),
      'b500', coalesce(sum(case when movement_type = 'inflow' then (bills_snapshot->>'b500')::integer else -(bills_snapshot->>'b500')::integer end), 0),
      'b200', coalesce(sum(case when movement_type = 'inflow' then (bills_snapshot->>'b200')::integer else -(bills_snapshot->>'b200')::integer end), 0),
      'b100', coalesce(sum(case when movement_type = 'inflow' then (bills_snapshot->>'b100')::integer else -(bills_snapshot->>'b100')::integer end), 0),
      'b50', coalesce(sum(case when movement_type = 'inflow' then (bills_snapshot->>'b50')::integer else -(bills_snapshot->>'b50')::integer end), 0),
      'b20', coalesce(sum(case when movement_type = 'inflow' then (bills_snapshot->>'b20')::integer else -(bills_snapshot->>'b20')::integer end), 0)
    )
  into v_balance, v_available_bills
  from public.central_cash_movements;

  -- Las monedas declaradas se compensan dentro de esta transacción. La
  -- disponibilidad de billetes se valida por denominación y de forma
  -- independiente: las monedas nunca cubren un billete faltante.
  if (v_balance + v_coins) < v_amount
    or (v_available_bills->>'b1000')::integer < (p_bills->>'b1000')::integer
    or (v_available_bills->>'b500')::integer < (p_bills->>'b500')::integer
    or (v_available_bills->>'b200')::integer < (p_bills->>'b200')::integer
    or (v_available_bills->>'b100')::integer < (p_bills->>'b100')::integer
    or (v_available_bills->>'b50')::integer < (p_bills->>'b50')::integer
    or (v_available_bills->>'b20')::integer < (p_bills->>'b20')::integer then
    raise exception 'EXPENSE_INSUFFICIENT_CENTRAL_CASH' using errcode = 'P0001';
  end if;

  select coalesce(nullif(btrim(profile.full_name), ''), 'Administración')
  into v_profile_name
  from public.profiles as profile
  where profile.id = auth.uid();
  v_profile_name := coalesce(v_profile_name, 'Administración');

  insert into public.expenses (
    id, store_id, business_date, amount, concept, payment_method, notes,
    funding_source, source_store_id, created_by, created_at, updated_at, version
  )
  values (
    p_expense_id, p_store_id, p_business_date, v_amount, btrim(p_concept),
    p_payment_method, nullif(btrim(p_notes), ''), 'central_cash', null,
    p_created_by, p_created_at, p_created_at, 1
  )
  returning * into v_expense;

  if v_coins > 0 then
    insert into public.central_cash_movements (
      id, movement_type, source_type, source_id, amount, business_date,
      concept, notes, bills_snapshot, coins_amount, created_by,
      created_by_name_snapshot, created_at
    )
    values (
      pg_catalog.gen_random_uuid(), 'inflow', 'expense_coin_compensation',
      v_expense.id, v_coins, v_expense.business_date,
      'Compensación de monedas · Gasto', null, v_empty_bills, v_coins,
      auth.uid(), v_profile_name, pg_catalog.now()
    )
    returning * into v_coin_compensation;
  end if;

  insert into public.central_cash_movements (
    id, movement_type, source_type, source_id, amount, business_date,
    concept, notes, bills_snapshot, coins_amount, created_by,
    created_by_name_snapshot, created_at
  )
  values (
    pg_catalog.gen_random_uuid(), 'outflow', 'expense', v_expense.id,
    v_amount, v_expense.business_date, 'Gasto · ' || v_expense.concept,
    v_expense.notes, p_bills, v_coins, auth.uid(), v_profile_name,
    pg_catalog.now()
  )
  returning * into v_movement;

  return jsonb_build_object(
    'expense', to_jsonb(v_expense),
    'movement', to_jsonb(v_movement),
    'coin_compensation', case
      when v_coin_compensation.id is null then null
      else to_jsonb(v_coin_compensation)
    end
  );
exception when unique_violation then
  raise exception 'EXPENSE_REQUEST_ID_CONFLICT' using errcode = '23505';
end;
$$;

-- Defensa adicional para cualquier llamada interna que intente asociar un
-- Gasto de Caja Central a un Corte.
create or replace function private.operations_reject_central_expense_closing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.expenses as expense
    where expense.id = new.expense_id
      and expense.funding_source = 'central_cash'
  ) then
    raise exception 'CENTRAL_CASH_EXPENSE_NOT_ELIGIBLE'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists cash_closing_expense_items_guard_central_cash
  on public.cash_closing_expense_items;
create trigger cash_closing_expense_items_guard_central_cash
before insert on public.cash_closing_expense_items
for each row execute function private.operations_reject_central_expense_closing();

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
  v_purchases jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Sólo administración puede consultar candidatos de corte'
      using errcode = '42501';
  end if;
  if p_store_id is null or p_business_date is null then
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

  select coalesce(jsonb_agg(
    jsonb_build_object('purchase', to_jsonb(purchase), 'payment', to_jsonb(payment))
    order by purchase.created_at
  ), '[]'::jsonb)
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

-- Conserva la firma final introducida por Compras y rechaza explícitamente
-- Gastos centrales antes de delegar en la implementación histórica del cierre.
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
  p_purchase_payment_ids uuid[]
)
returns public.cash_closings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_payment_ids uuid[] := coalesce(p_purchase_payment_ids, '{}'::uuid[]);
  v_existing public.cash_closings;
  v_closing public.cash_closings;
  v_purchases_total numeric(12, 2);
  v_cash_purchases_total numeric(12, 2);
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Sólo administración puede cerrar caja' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.expenses as expense
    where expense.id = any(coalesce(p_expense_ids, '{}'::uuid[]))
      and expense.funding_source = 'central_cash'
  ) then
    raise exception 'CENTRAL_CASH_EXPENSE_NOT_ELIGIBLE'
      using errcode = 'P0001';
  end if;
  if cardinality(v_purchase_payment_ids) <> (
    select count(distinct selected.id)
    from unnest(v_purchase_payment_ids) as selected(id)
  ) then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
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
      and not exists (
        (select unnest(v_purchase_payment_ids))
        except
        (select item.purchase_payment_id
         from public.cash_closing_purchase_items as item
         where item.cash_closing_id = p_id)
      )
      and not exists (
        (select item.purchase_payment_id
         from public.cash_closing_purchase_items as item
         where item.cash_closing_id = p_id)
        except
        (select unnest(v_purchase_payment_ids))
      ) then
      return v_existing;
    end if;
    raise exception 'CLOSING_ALREADY_EXISTS' using errcode = '23505';
  end if;

  perform 1
  from public.purchase_payments as payment
  where payment.id = any(v_purchase_payment_ids)
  order by payment.id
  for update;

  if cardinality(v_purchase_payment_ids) <> (
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
    select 1 from public.cash_closing_purchase_items
    where purchase_payment_id = any(v_purchase_payment_ids)
  ) then
    raise exception 'PURCHASE_ALREADY_IN_CLOSING' using errcode = 'P0001';
  end if;

  v_closing := public.close_cash_closing(
    p_id, p_store_id, p_business_date, p_gross_sales, p_bills,
    p_balance_bills, p_notes, p_expense_ids, p_transfer_ids, p_payment_ids
  );

  select
    coalesce(sum(payment.amount), 0),
    coalesce(sum(payment.amount) filter (
      where payment.payment_method = 'efectivo'
    ), 0)
  into v_purchases_total, v_cash_purchases_total
  from public.purchase_payments as payment
  where payment.id = any(v_purchase_payment_ids);

  begin
    insert into public.cash_closing_purchase_items (
      cash_closing_id, purchase_id, purchase_payment_id, supplier_id,
      supplier_name_snapshot, folio_snapshot, amount_snapshot,
      payment_method_snapshot, business_date_snapshot
    )
    select
      v_closing.id, purchase.id, payment.id, purchase.supplier_id,
      purchase.supplier_name_snapshot, purchase.folio, payment.amount,
      payment.payment_method, purchase.business_date
    from public.purchase_payments as payment
    join public.purchases as purchase on purchase.id = payment.purchase_id
    where payment.id = any(v_purchase_payment_ids);
  exception when unique_violation then
    raise exception 'PURCHASE_ALREADY_IN_CLOSING' using errcode = 'P0001';
  end;

  update public.cash_closings
  set
    purchases_total_snapshot = v_purchases_total,
    cash_purchases_total_snapshot = v_cash_purchases_total,
    operational_outflows_total_snapshot = round(
      operational_outflows_total_snapshot + v_purchases_total, 2
    ),
    cash_outflows_total_snapshot = round(
      cash_outflows_total_snapshot + v_cash_purchases_total, 2
    ),
    expected_cash = round(expected_cash - v_cash_purchases_total, 2),
    difference = round(counted_cash - (expected_cash - v_cash_purchases_total), 2)
  where id = v_closing.id
  returning * into v_closing;

  return v_closing;
end;
$$;

revoke all on function private.operations_reject_central_expense_closing()
  from public, anon, authenticated;
revoke all on function public.create_central_cash_expense(
  uuid, uuid, date, numeric, text, text, text, text, jsonb, numeric,
  timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.create_central_cash_expense(
  uuid, uuid, date, numeric, text, text, text, text, jsonb, numeric,
  timestamptz, uuid
) to authenticated;

comment on function public.create_central_cash_expense(
  uuid, uuid, date, numeric, text, text, text, text, jsonb, numeric,
  timestamptz, uuid
) is
  'Crea un Gasto de Caja Central y sus movimientos auditables de forma atómica e idempotente.';
