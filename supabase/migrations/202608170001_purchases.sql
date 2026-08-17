-- Compras v1 + Proveedores. Migración aditiva pendiente de revisión y
-- aplicación manual en local/dev. No modifica migraciones históricas.

create table public.suppliers (
  id uuid primary key,
  name text not null check (
    length(btrim(name)) > 0 and length(name) <= 120
  ),
  is_active boolean not null default true,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index suppliers_normalized_name_key
  on public.suppliers (
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
  );

create trigger suppliers_set_updated_at
before update on public.suppliers
for each row execute function private.set_updated_at();

create table public.purchases (
  id uuid primary key,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_name_snapshot text not null check (
    length(btrim(supplier_name_snapshot)) > 0
    and length(supplier_name_snapshot) <= 120
  ),
  business_date date not null,
  folio text check (folio is null or length(folio) <= 80),
  amount numeric(12, 2) not null check (amount > 0),
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index purchases_supplier_date_idx
  on public.purchases(supplier_id, business_date desc);
create index purchases_business_date_idx
  on public.purchases(business_date desc, created_at desc);

create table public.purchase_payments (
  id uuid primary key,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  funding_source text not null check (
    funding_source in ('central_cash', 'store_cash')
  ),
  source_store_id uuid references public.stores(id) on delete restrict,
  payment_method text not null check (
    payment_method in ('efectivo', 'tarjeta', 'transferencia', 'otro')
  ),
  bills jsonb check (bills is null or jsonb_typeof(bills) = 'object'),
  coins_amount numeric(12, 2) not null default 0 check (coins_amount >= 0),
  paid_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  constraint purchase_payments_source_check check (
    (funding_source = 'central_cash' and source_store_id is null)
    or (funding_source = 'store_cash' and source_store_id is not null)
  ),
  constraint purchase_payments_cash_breakdown_check check (
    (payment_method = 'efectivo' and bills is not null)
    or (payment_method <> 'efectivo' and bills is null and coins_amount = 0)
  )
);

create index purchase_payments_purchase_idx
  on public.purchase_payments(purchase_id, paid_at);
create index purchase_payments_store_idx
  on public.purchase_payments(source_store_id, paid_at)
  where funding_source = 'store_cash';

alter table public.cash_closings
  add column purchases_total_snapshot numeric(12, 2) not null default 0,
  add column cash_purchases_total_snapshot numeric(12, 2) not null default 0;

alter table public.cash_closings
  drop constraint cash_closings_operational_outflows_snapshot_check,
  drop constraint cash_closings_cash_outflows_snapshot_check,
  add constraint cash_closings_purchases_snapshot_check check (
    purchases_total_snapshot >= 0
    and cash_purchases_total_snapshot >= 0
    and cash_purchases_total_snapshot <= purchases_total_snapshot
  ),
  add constraint cash_closings_operational_outflows_snapshot_check check (
    operational_outflows_total_snapshot =
      expenses_total_snapshot
      + outgoing_transfers_total_snapshot
      + store_cash_payments_total_snapshot
      + purchases_total_snapshot
  ),
  add constraint cash_closings_cash_outflows_snapshot_check check (
    cash_outflows_total_snapshot =
      cash_expenses_total_snapshot
      + store_cash_payments_total_snapshot
      + cash_purchases_total_snapshot
  );

create table public.cash_closing_purchase_items (
  cash_closing_id uuid not null
    references public.cash_closings(id) on delete restrict,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  purchase_payment_id uuid not null unique
    references public.purchase_payments(id) on delete restrict,
  supplier_id uuid not null,
  supplier_name_snapshot text not null check (
    length(btrim(supplier_name_snapshot)) > 0
    and length(supplier_name_snapshot) <= 120
  ),
  folio_snapshot text check (
    folio_snapshot is null or length(folio_snapshot) <= 80
  ),
  amount_snapshot numeric(12, 2) not null check (amount_snapshot > 0),
  payment_method_snapshot text not null check (
    payment_method_snapshot in ('efectivo', 'tarjeta', 'transferencia', 'otro')
  ),
  business_date_snapshot date not null,
  created_at timestamptz not null default now(),
  primary key (cash_closing_id, purchase_payment_id)
);

create index cash_closing_purchase_items_closing_idx
  on public.cash_closing_purchase_items(cash_closing_id);

create or replace function private.operations_purchase_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'PURCHASE_LOCKED' using errcode = '55000';
end;
$$;

create trigger purchases_immutable
before update or delete on public.purchases
for each row execute function private.operations_purchase_immutable();

create trigger purchase_payments_immutable
before update or delete on public.purchase_payments
for each row execute function private.operations_purchase_immutable();

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
  p_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.suppliers;
  v_purchase public.purchases;
  v_payment public.purchase_payments;
  v_movement public.central_cash_movements;
  v_existing_purchase public.purchases;
  v_existing_payment public.purchase_payments;
  v_amount numeric(12, 2) := round(p_amount, 2);
  v_coins numeric(12, 2) := round(coalesce(p_coins_amount, 0), 2);
  v_empty_bills jsonb := jsonb_build_object(
    'b1000', 0, 'b500', 0, 'b200', 0,
    'b100', 0, 'b50', 0, 'b20', 0
  );
  v_movement_bills jsonb;
  v_profile_name text;
  v_store_active boolean;
  v_balance numeric(12, 2);
  v_available_bills jsonb;
  v_available_coins numeric(12, 2);
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'PURCHASE_REQUIRES_ADMIN' using errcode = '42501';
  end if;
  if p_purchase_id is null or p_payment_id is null then
    raise exception 'PURCHASE_REQUEST_ID_CONFLICT' using errcode = '22023';
  end if;

  -- Serializa retries concurrentes del mismo UUID antes de comprobar si ya
  -- existe. El segundo request devuelve el resultado original, no un conflicto.
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
      or v_existing_purchase.supplier_id is distinct from p_supplier_id
      or v_existing_purchase.business_date is distinct from p_business_date
      or v_existing_purchase.folio is distinct from nullif(btrim(p_folio), '')
      or v_existing_purchase.amount is distinct from v_amount
      or v_existing_purchase.notes is distinct from nullif(btrim(p_notes), '')
      or v_existing_payment.amount is distinct from v_amount
      or v_existing_payment.funding_source is distinct from p_funding_source
      or v_existing_payment.source_store_id is distinct from p_source_store_id
      or v_existing_payment.payment_method is distinct from p_payment_method
      or v_existing_payment.bills is distinct from p_bills
      or v_existing_payment.coins_amount is distinct from v_coins then
      raise exception 'PURCHASE_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;

    select movement.* into v_movement
    from public.central_cash_movements as movement
    where movement.source_type = 'purchase'
      and movement.source_id = v_existing_payment.id;

    return jsonb_build_object(
      'purchase', to_jsonb(v_existing_purchase),
      'payment', to_jsonb(v_existing_payment),
      'movement', case when v_movement.id is null then null else to_jsonb(v_movement) end
    );
  end if;

  if exists (
    select 1 from public.purchase_payments where id = p_payment_id
  ) then
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

  if p_funding_source not in ('central_cash', 'store_cash') then
    raise exception 'PURCHASE_STORE_FORBIDDEN' using errcode = '22023';
  end if;
  if p_funding_source = 'central_cash' and p_source_store_id is not null then
    raise exception 'PURCHASE_STORE_FORBIDDEN' using errcode = '22023';
  end if;
  if p_funding_source = 'store_cash' and p_source_store_id is null then
    raise exception 'PURCHASE_STORE_REQUIRED' using errcode = '22023';
  end if;
  if p_funding_source = 'store_cash' then
    select store.status = 'active' into v_store_active
    from public.stores as store
    where store.id = p_source_store_id
    for share;
    if not coalesce(v_store_active, false) then
      raise exception 'PURCHASE_STORE_FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;
  if p_payment_method not in ('efectivo', 'tarjeta', 'transferencia', 'otro') then
    raise exception 'PURCHASE_INVALID_PAYMENT_METHOD' using errcode = '22023';
  end if;

  if p_payment_method = 'efectivo' then
    if p_bills is null
      or v_coins < 0
      or not private.operations_central_cash_valid_bills(p_bills)
      or round(private.operations_central_cash_bills_total(p_bills) + v_coins, 2)
        <> v_amount then
      raise exception 'PURCHASE_BILLS_MISMATCH' using errcode = '22023';
    end if;
    v_movement_bills := p_bills;
  else
    if p_bills is not null or v_coins <> 0 then
      raise exception 'PURCHASE_BILLS_MISMATCH' using errcode = '22023';
    end if;
    v_movement_bills := v_empty_bills;
  end if;

  if p_funding_source = 'central_cash' then
    perform pg_advisory_xact_lock(
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
      ),
      coalesce(sum(case when movement_type = 'inflow' then coins_amount else -coins_amount end), 0)
    into v_balance, v_available_bills, v_available_coins
    from public.central_cash_movements;

    if v_balance < v_amount then
      raise exception 'PURCHASE_INSUFFICIENT_CENTRAL_CASH' using errcode = 'P0001';
    end if;
    if p_payment_method = 'efectivo' and (
      (v_available_bills->>'b1000')::integer < (p_bills->>'b1000')::integer
      or (v_available_bills->>'b500')::integer < (p_bills->>'b500')::integer
      or (v_available_bills->>'b200')::integer < (p_bills->>'b200')::integer
      or (v_available_bills->>'b100')::integer < (p_bills->>'b100')::integer
      or (v_available_bills->>'b50')::integer < (p_bills->>'b50')::integer
      or (v_available_bills->>'b20')::integer < (p_bills->>'b20')::integer
      or v_available_coins < v_coins
    ) then
      raise exception 'PURCHASE_INSUFFICIENT_CENTRAL_CASH' using errcode = 'P0001';
    end if;
  end if;

  insert into public.purchases (
    id, supplier_id, supplier_name_snapshot, business_date, folio,
    amount, notes, created_by, created_at, updated_at
  ) values (
    p_purchase_id, v_supplier.id, v_supplier.name, p_business_date,
    nullif(btrim(p_folio), ''), v_amount, nullif(btrim(p_notes), ''),
    auth.uid(), p_created_at, p_created_at
  ) returning * into v_purchase;

  insert into public.purchase_payments (
    id, purchase_id, amount, funding_source, source_store_id,
    payment_method, bills, coins_amount, paid_at, created_by, created_at
  ) values (
    p_payment_id, v_purchase.id, v_amount, p_funding_source, p_source_store_id,
    p_payment_method, case when p_payment_method = 'efectivo' then p_bills else null end,
    v_coins, p_created_at, auth.uid(), p_created_at
  ) returning * into v_payment;

  if p_funding_source = 'central_cash' then
    select profile.full_name into v_profile_name
    from public.profiles as profile where profile.id = auth.uid();

    insert into public.central_cash_movements (
      id, movement_type, source_type, source_id, amount, business_date,
      concept, notes, bills_snapshot, coins_amount, created_by,
      created_by_name_snapshot, created_at
    ) values (
      pg_catalog.gen_random_uuid(), 'outflow', 'purchase', v_payment.id,
      v_amount, v_purchase.business_date, 'Compra - ' || v_purchase.supplier_name_snapshot,
      v_purchase.notes, v_movement_bills,
      case when p_payment_method = 'efectivo' then v_coins else 0 end,
      auth.uid(), coalesce(nullif(btrim(v_profile_name), ''), 'Administración'), now()
    ) returning * into v_movement;
  end if;

  return jsonb_build_object(
    'purchase', to_jsonb(v_purchase),
    'payment', to_jsonb(v_payment),
    'movement', case when v_movement.id is null then null else to_jsonb(v_movement) end
  );
exception when unique_violation then
  raise exception 'PURCHASE_REQUEST_ID_CONFLICT' using errcode = '23505';
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

-- La firma anterior permanece como implementación interna. Sólo la firma con
-- selección de compras queda ejecutable para clientes.
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

drop function public.get_export_candidates(uuid, date, date);

create function public.get_export_candidates(
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
  purchases_total numeric,
  cash_purchases_total numeric,
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
    raise exception 'El rango de fechas no es válido' using errcode = '22007';
  end if;

  return query
  select
    closing.id, closing.store_id, closing.store_name_snapshot,
    closing.business_date, closing.closing_number,
    round(
      closing.counted_cash + closing.cash_expenses_total_snapshot
      + closing.store_cash_payments_total_snapshot
      + closing.cash_purchases_total_snapshot, 2
    ),
    closing.expenses_total_snapshot,
    closing.cash_expenses_total_snapshot,
    closing.store_cash_payments_total_snapshot,
    closing.purchases_total_snapshot,
    closing.cash_purchases_total_snapshot,
    closing.counted_cash, closing.cash_balance, closing.cash_to_withdraw,
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

alter function public.prepare_export_batch(uuid, uuid[])
  rename to prepare_export_batch_without_purchases;

create function public.prepare_export_batch(
  p_batch_id uuid,
  p_closing_ids uuid[]
)
returns public.export_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preexisting boolean;
  v_batch public.export_batches;
  v_closing jsonb;
  v_closing_id uuid;
  v_purchase_items jsonb;
  v_purchase_movements jsonb;
  v_purchases_total numeric(12, 2);
  v_cash_purchases_total numeric(12, 2);
  v_snapshot_purchases_total numeric(12, 2);
  v_snapshot_cash_purchases_total numeric(12, 2);
  v_cortes jsonb := '[]'::jsonb;
begin
  perform private.operations_export_require_admin();
  select exists (
    select 1 from public.export_batches where id = p_batch_id
  ) into v_preexisting;

  v_batch := public.prepare_export_batch_without_purchases(
    p_batch_id, p_closing_ids
  );
  if v_preexisting or exists (
    select 1
    from jsonb_array_elements(v_batch.payload_snapshot -> 'cortes') as item(value)
    where item.value ? 'purchases_total'
  ) then
    return v_batch;
  end if;

  for v_closing in
    select value from jsonb_array_elements(v_batch.payload_snapshot -> 'cortes')
  loop
    v_closing_id := (v_closing ->> 'id')::uuid;
    select
      coalesce(sum(item.amount_snapshot), 0),
      coalesce(sum(item.amount_snapshot) filter (
        where item.payment_method_snapshot = 'efectivo'
      ), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'id', item.purchase_id,
        'payment_id', item.purchase_payment_id,
        'amount', item.amount_snapshot,
        'supplier_id', item.supplier_id,
        'supplier_name', item.supplier_name_snapshot,
        'folio', item.folio_snapshot,
        'payment_method', item.payment_method_snapshot,
        'affects_cash', item.payment_method_snapshot = 'efectivo'
      ) order by item.created_at, item.purchase_payment_id), '[]'::jsonb),
      coalesce(jsonb_agg(jsonb_build_object(
        'id', item.purchase_payment_id,
        'source_type', 'purchase',
        'source_id', item.purchase_payment_id,
        'tipo', 'salida',
        'fecha_movimiento', item.business_date_snapshot,
        'monto', item.amount_snapshot,
        'concepto', 'Compra - ' || item.supplier_name_snapshot,
        'categoria', 'Compra',
        'store_id', v_closing ->> 'store_id'
      ) order by item.created_at, item.purchase_payment_id)
        filter (where item.payment_method_snapshot = 'efectivo'), '[]'::jsonb)
    into v_purchases_total, v_cash_purchases_total,
      v_purchase_items, v_purchase_movements
    from public.cash_closing_purchase_items as item
    where item.cash_closing_id = v_closing_id;

    select
      closing.purchases_total_snapshot,
      closing.cash_purchases_total_snapshot
    into v_snapshot_purchases_total, v_snapshot_cash_purchases_total
    from public.cash_closings as closing
    where closing.id = v_closing_id;

    if round(v_purchases_total, 2) <> v_snapshot_purchases_total
      or round(v_cash_purchases_total, 2) <> v_snapshot_cash_purchases_total then
      raise exception 'EXPORT_RECONCILIATION_ERROR'
        using errcode = 'P0001',
        detail = 'Las Compras históricas no coinciden con el Corte ' || v_closing_id::text || '.';
    end if;

    v_cortes := v_cortes || jsonb_build_array(
      v_closing || jsonb_build_object(
        'gross_cash', round((v_closing ->> 'gross_cash')::numeric
          + v_cash_purchases_total, 2),
        'purchases_total', v_purchases_total,
        'cash_purchases_total', v_cash_purchases_total,
        'purchase_items', v_purchase_items,
        'financial_movements',
          (v_closing -> 'financial_movements') || v_purchase_movements
      )
    );
  end loop;

  update public.export_batches
  set payload_snapshot = jsonb_set(payload_snapshot, '{cortes}', v_cortes)
  where id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_payments enable row level security;
alter table public.cash_closing_purchase_items enable row level security;

create policy "admins can read suppliers"
on public.suppliers for select to authenticated
using ((select private.is_admin()));
create policy "admins can insert suppliers"
on public.suppliers for insert to authenticated
with check ((select private.is_admin()) and created_by = (select auth.uid()));
create policy "admins can update suppliers"
on public.suppliers for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "admins can read purchases"
on public.purchases for select to authenticated
using ((select private.is_admin()));
create policy "admins can read purchase payments"
on public.purchase_payments for select to authenticated
using ((select private.is_admin()));
create policy "admins can read closing purchase snapshots"
on public.cash_closing_purchase_items for select to authenticated
using ((select private.is_admin()));

revoke all on public.suppliers from public, anon, authenticated;
revoke all on public.purchases from public, anon, authenticated;
revoke all on public.purchase_payments from public, anon, authenticated;
revoke all on public.cash_closing_purchase_items from public, anon, authenticated;
grant select, insert (id, name), update (name, is_active)
  on public.suppliers to authenticated;
grant select on public.purchases to authenticated;
grant select on public.purchase_payments to authenticated;
grant select on public.cash_closing_purchase_items to authenticated;

revoke all on function private.operations_purchase_immutable() from public, anon, authenticated;
revoke all on function public.create_paid_purchase(
  uuid, uuid, uuid, date, text, numeric, text, text, uuid, text, jsonb, numeric, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_paid_purchase(
  uuid, uuid, uuid, date, text, numeric, text, text, uuid, text, jsonb, numeric, timestamptz
) to authenticated;

revoke all on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[]
) from public, anon, authenticated;
revoke all on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[], uuid[]
) from public, anon, authenticated;
grant execute on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[], uuid[]
) to authenticated;

revoke all on function public.get_export_candidates(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.get_export_candidates(uuid, date, date)
  to authenticated;
revoke all on function public.prepare_export_batch_without_purchases(uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.prepare_export_batch(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.prepare_export_batch(uuid, uuid[])
  to authenticated;

comment on table public.suppliers is
  'Catálogo administrativo de proveedores; se desactiva en lugar de eliminar.';
comment on table public.purchases is
  'Hecho comercial inmutable, separado del pago y de los gastos.';
comment on table public.purchase_payments is
  'Liquidaciones de compras; v1 crea exactamente una por compra mediante RPC.';
comment on table public.cash_closing_purchase_items is
  'Snapshots inmutables de pagos de compras incluidos en un Corte.';
comment on function public.create_paid_purchase(
  uuid, uuid, uuid, date, text, numeric, text, text, uuid, text, jsonb, numeric, timestamptz
) is 'Crea Compra y Pago atómicamente; Caja Central añade una salida autoritativa.';
