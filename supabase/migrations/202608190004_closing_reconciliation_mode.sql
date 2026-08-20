-- Configura la conciliación por tienda y congela el modo usado en cada Corte.
-- Los registros existentes conservan el comportamiento histórico: normal.

alter table public.stores
  add column closing_reconciliation_mode text not null default 'normal'
    check (closing_reconciliation_mode in ('normal', 'sicar'));

alter table public.cash_closings
  add column closing_reconciliation_mode text not null default 'normal'
    check (closing_reconciliation_mode in ('normal', 'sicar'));

grant update (closing_reconciliation_mode) on public.stores to authenticated;

-- La firma nueva mantiene disponibles las anteriores para las migraciones
-- históricas, pero la aplicación usa ésta y persiste el modo como snapshot.
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
  p_closing_reconciliation_mode text
)
returns public.cash_closings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closing public.cash_closings;
begin
  if p_closing_reconciliation_mode not in ('normal', 'sicar') then
    raise exception 'CLOSING_RECONCILIATION_MODE_INVALID' using errcode = '22023';
  end if;

  v_closing := public.close_cash_closing(
    p_id, p_store_id, p_business_date, p_gross_sales, p_bills,
    p_balance_bills, p_notes, p_expense_ids, p_transfer_ids,
    p_payment_ids, p_purchase_payment_ids
  );

  update public.cash_closings
  set
    closing_reconciliation_mode = p_closing_reconciliation_mode,
    expected_cash = round(
      gross_sales
      - cash_outflows_total_snapshot
      - case when p_closing_reconciliation_mode = 'sicar'
          then outgoing_transfers_total_snapshot
          else 0
        end,
      2
    ),
    difference = round(
      counted_cash
      + cash_outflows_total_snapshot
      + case when p_closing_reconciliation_mode = 'sicar'
          then outgoing_transfers_total_snapshot
          else 0
        end
      - gross_sales,
      2
    )
  where id = v_closing.id
  returning * into v_closing;

  return v_closing;
end;
$$;

revoke all on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[],
  uuid[], text
) from public, anon, authenticated;
grant execute on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[], uuid[],
  uuid[], text
) to authenticated;

comment on column public.stores.closing_reconciliation_mode is
  'Modo operativo predeterminado de conciliación: normal o sicar.';
comment on column public.cash_closings.closing_reconciliation_mode is
  'Snapshot del modo de conciliación usado para cerrar el Corte.';
