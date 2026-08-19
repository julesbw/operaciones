-- Corrige la restricción histórica de purchase_payments sin modificar
-- migraciones ya aplicadas. Revisar y aplicar manualmente después de
-- 202608190001_purchase_optional_store_cash_breakdown.sql.

alter table public.purchase_payments
  drop constraint purchase_payments_cash_breakdown_check;

alter table public.purchase_payments
  add constraint purchase_payments_cash_breakdown_check check (
    (
      funding_source = 'central_cash'
      and payment_method = 'efectivo'
      and bills is not null
    )
    or (
      funding_source = 'store_cash'
      and payment_method = 'efectivo'
      and (bills is not null or coins_amount = 0)
    )
    or (
      payment_method <> 'efectivo'
      and bills is null
      and coins_amount = 0
    )
  );
