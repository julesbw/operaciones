-- Amplía el cierre remoto para conservar los conceptos del flujo guiado.
alter table public.cash_closings
  add column cash_expense_total numeric(12, 2) not null default 0,
  add column cash_balance numeric(12, 2) not null default 0,
  add column cash_to_withdraw numeric(12, 2) not null default 0,
  add column created_by uuid references auth.users(id);

-- Los cierres anteriores asumían que todos los gastos reducían el efectivo.
update public.cash_closings
set
  cash_expense_total = expense_total,
  cash_balance = opening_balance,
  cash_to_withdraw = greatest(counted_cash - opening_balance, 0),
  created_by = closed_by;

alter table public.cash_closings
  alter column created_by set not null,
  add constraint cash_closings_cash_expense_total_check check (
    cash_expense_total >= 0 and cash_expense_total <= expense_total
  ),
  add constraint cash_closings_cash_balance_check check (
    cash_balance >= 0 and cash_balance <= counted_cash
  ),
  add constraint cash_closings_cash_to_withdraw_check check (
    cash_to_withdraw >= 0
  ),
  add constraint cash_closings_withdraw_calculation_check check (
    cash_to_withdraw = counted_cash - cash_balance
  );

comment on column public.cash_closings.cash_expense_total is
  'Gastos pagados en efectivo utilizados para reconciliar la caja.';
comment on column public.cash_closings.cash_balance is
  'Efectivo que permanece físicamente en caja después del corte.';
comment on column public.cash_closings.cash_to_withdraw is
  'Efectivo contado menos el saldo que permanece en caja.';
