-- Corrige la validación de ajustes para impedir denominaciones físicas negativas.
-- Revisar y aplicar manualmente después de 202608180001_closing_adjustments.sql.

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

  if not private.operations_central_cash_valid_bills(v_effective_bills - 'monedas')
    or v_effective_coins < 0
    or v_effective_amount < 0
    or v_effective_counted < v_closing.cash_balance
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

comment on function public.create_cash_closing_adjustment(uuid, uuid, text, numeric, text, text, jsonb, numeric) is
  'Crea un ajuste idempotente y rechaza resultados físicos con denominaciones negativas.';
