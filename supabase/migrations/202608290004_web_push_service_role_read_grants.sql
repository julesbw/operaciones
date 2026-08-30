-- La Edge Function necesita leer los datos persistidos
-- para construir el payload Push.
grant select on table
  public.stores,
  public.purchases,
  public.merchandise_transfers,
  public.cash_closings
to service_role;
