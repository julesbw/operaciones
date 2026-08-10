-- Conserva el desglose físico de lo que permanece y lo que se retira.
alter table public.cash_closings
  add column balance_bills jsonb not null default
    '{"b1000":0,"b500":0,"b200":0,"b100":0,"b50":0,"b20":0,"monedas":0}'::jsonb,
  add column withdraw_bills jsonb not null default
    '{"b1000":0,"b500":0,"b200":0,"b100":0,"b50":0,"b20":0,"monedas":0}'::jsonb;

-- Los cierres históricos sólo conservan los importes; se representan como
-- monedas para no inventar una composición de billetes inexistente.
update public.cash_closings
set
  balance_bills = jsonb_build_object(
    'b1000', 0,
    'b500', 0,
    'b200', 0,
    'b100', 0,
    'b50', 0,
    'b20', 0,
    'monedas', cash_balance
  ),
  withdraw_bills = jsonb_build_object(
    'b1000', 0,
    'b500', 0,
    'b200', 0,
    'b100', 0,
    'b50', 0,
    'b20', 0,
    'monedas', cash_to_withdraw
  );

comment on column public.cash_closings.balance_bills is
  'Desglose por denominación del efectivo que permanece en caja.';
comment on column public.cash_closings.withdraw_bills is
  'Diferencia por denominación entre efectivo contado y saldo en caja.';
