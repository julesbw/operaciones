-- Hace opcional el desglose físico únicamente para Compras en efectivo desde
-- Caja de Tienda. Revisar y aplicar manualmente después de
-- 202608180003_purchase_coin_compensation.sql.

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
  v_coin_compensation public.central_cash_movements;
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

    select movement.* into v_coin_compensation
    from public.central_cash_movements as movement
    where movement.source_type = 'purchase_coin_compensation'
      and movement.source_id = v_existing_payment.id;

    return jsonb_build_object(
      'purchase', to_jsonb(v_existing_purchase),
      'payment', to_jsonb(v_existing_payment),
      'movement', case when v_movement.id is null then null else to_jsonb(v_movement) end,
      'coin_compensation', case
        when v_coin_compensation.id is null then null
        else to_jsonb(v_coin_compensation)
      end
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
    if p_funding_source = 'central_cash' then
      -- Caja Central siempre exige conocer el efectivo físico que salió.
      if p_bills is null
        or v_coins < 0
        or not private.operations_central_cash_valid_bills(p_bills)
        or round(private.operations_central_cash_bills_total(p_bills) + v_coins, 2)
          <> v_amount then
        raise exception 'PURCHASE_BILLS_MISMATCH' using errcode = '22023';
      end if;
      v_movement_bills := p_bills;
    elsif p_bills is null then
      -- En Caja de Tienda null significa que el usuario no capturó desglose.
      -- En ese caso monedas también debe permanecer sin captura.
      if v_coins <> 0 then
        raise exception 'PURCHASE_BILLS_MISMATCH' using errcode = '22023';
      end if;
    else
      -- Si Caja de Tienda trae desglose, éste sigue siendo obligatorio y exacto.
      if v_coins < 0
        or not private.operations_central_cash_valid_bills(p_bills)
        or round(private.operations_central_cash_bills_total(p_bills) + v_coins, 2)
          <> v_amount then
        raise exception 'PURCHASE_BILLS_MISMATCH' using errcode = '22023';
      end if;
    end if;
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
      )
    into v_balance, v_available_bills
    from public.central_cash_movements;

    -- Las monedas se compensan dentro de esta misma transacción. La
    -- disponibilidad física que debe existir antes de la compra son los
    -- billetes declarados; nunca se usan monedas existentes para cubrirlos.
    if (v_balance + (
      case when p_payment_method = 'efectivo' then v_coins else 0 end
    )) < v_amount then
      raise exception 'PURCHASE_INSUFFICIENT_CENTRAL_CASH' using errcode = 'P0001';
    end if;
    if p_payment_method = 'efectivo' and (
      (v_available_bills->>'b1000')::integer < (p_bills->>'b1000')::integer
      or (v_available_bills->>'b500')::integer < (p_bills->>'b500')::integer
      or (v_available_bills->>'b200')::integer < (p_bills->>'b200')::integer
      or (v_available_bills->>'b100')::integer < (p_bills->>'b100')::integer
      or (v_available_bills->>'b50')::integer < (p_bills->>'b50')::integer
      or (v_available_bills->>'b20')::integer < (p_bills->>'b20')::integer
    ) then
      raise exception 'PURCHASE_INSUFFICIENT_CENTRAL_CASH' using errcode = 'P0001';
    end if;
  end if;

  select coalesce(nullif(btrim(profile.full_name), ''), 'Administración')
  into v_profile_name
  from public.profiles as profile
  where profile.id = auth.uid();
  v_profile_name := coalesce(v_profile_name, 'Administración');

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
    if p_payment_method = 'efectivo' and v_coins > 0 then
      insert into public.central_cash_movements (
        id, movement_type, source_type, source_id, amount, business_date,
        concept, notes, bills_snapshot, coins_amount, created_by,
        created_by_name_snapshot, created_at
      ) values (
        pg_catalog.gen_random_uuid(), 'inflow', 'purchase_coin_compensation',
        v_payment.id, v_coins, v_purchase.business_date,
        'Compensación de monedas · Compra', null, v_empty_bills, v_coins,
        auth.uid(), v_profile_name, now()
      ) returning * into v_coin_compensation;
    end if;

    insert into public.central_cash_movements (
      id, movement_type, source_type, source_id, amount, business_date,
      concept, notes, bills_snapshot, coins_amount, created_by,
      created_by_name_snapshot, created_at
    ) values (
      pg_catalog.gen_random_uuid(), 'outflow', 'purchase', v_payment.id,
      v_amount, v_purchase.business_date, 'Compra - ' || v_purchase.supplier_name_snapshot,
      v_purchase.notes, v_movement_bills,
      case when p_payment_method = 'efectivo' then v_coins else 0 end,
      auth.uid(), v_profile_name, now()
    ) returning * into v_movement;
  end if;

  return jsonb_build_object(
    'purchase', to_jsonb(v_purchase),
    'payment', to_jsonb(v_payment),
    'movement', case when v_movement.id is null then null else to_jsonb(v_movement) end,
    'coin_compensation', case
      when v_coin_compensation.id is null then null
      else to_jsonb(v_coin_compensation)
    end
  );
exception when unique_violation then
  raise exception 'PURCHASE_REQUEST_ID_CONFLICT' using errcode = '23505';
end;
$$;

comment on function public.create_paid_purchase(
  uuid, uuid, uuid, date, text, numeric, text, text, uuid, text, jsonb,
  numeric, timestamptz
) is
  'Crea una Compra idempotente; exige desglose en Caja Central y lo hace opcional en Caja de Tienda.';
