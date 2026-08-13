-- Integra salidas operativas al cierre sin mezclar transferencias de mercancía
-- con las salidas físicas de efectivo.

alter table public.cash_closings
  add column expenses_total_snapshot numeric(12, 2) not null default 0,
  add column cash_expenses_total_snapshot numeric(12, 2) not null default 0,
  add column outgoing_transfers_total_snapshot numeric(12, 2) not null default 0,
  add column store_cash_payments_total_snapshot numeric(12, 2) not null default 0,
  add column operational_outflows_total_snapshot numeric(12, 2) not null default 0,
  add column cash_outflows_total_snapshot numeric(12, 2) not null default 0;

update public.cash_closings
set
  expenses_total_snapshot = expense_total,
  cash_expenses_total_snapshot = cash_expense_total,
  operational_outflows_total_snapshot = expense_total,
  cash_outflows_total_snapshot = cash_expense_total;

alter table public.cash_closings
  add constraint cash_closings_expenses_snapshot_check check (
    expenses_total_snapshot >= 0
    and cash_expenses_total_snapshot >= 0
    and cash_expenses_total_snapshot <= expenses_total_snapshot
  ),
  add constraint cash_closings_transfer_snapshot_check check (
    outgoing_transfers_total_snapshot >= 0
  ),
  add constraint cash_closings_store_payments_snapshot_check check (
    store_cash_payments_total_snapshot >= 0
  ),
  add constraint cash_closings_operational_outflows_snapshot_check check (
    operational_outflows_total_snapshot =
      expenses_total_snapshot
      + outgoing_transfers_total_snapshot
      + store_cash_payments_total_snapshot
  ),
  add constraint cash_closings_cash_outflows_snapshot_check check (
    cash_outflows_total_snapshot =
      cash_expenses_total_snapshot + store_cash_payments_total_snapshot
  );

create table public.cash_closing_transfer_items (
  cash_closing_id uuid not null
    references public.cash_closings(id) on delete restrict,
  transfer_id uuid not null
    references public.merchandise_transfers(id) on delete restrict,
  amount_snapshot numeric(12, 2) not null check (amount_snapshot > 0),
  ticket_number_snapshot text not null check (
    length(btrim(ticket_number_snapshot)) > 0
    and length(ticket_number_snapshot) <= 80
  ),
  created_at timestamptz not null default now(),
  primary key (cash_closing_id, transfer_id),
  unique (transfer_id)
);

create index cash_closing_transfer_items_closing_idx
  on public.cash_closing_transfer_items(cash_closing_id);

-- Serializa un cierre con altas o correcciones del mismo día operativo. También
-- impide que gastos o transferencias cambien después de congelar el corte.
create or replace function private.operations_guard_closed_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_store_id uuid;
  v_old_business_date date;
  v_new_store_id uuid;
  v_new_business_date date;
  v_lock_key bigint;
begin
  if tg_table_name = 'expenses' then
    v_new_store_id := new.store_id;
    v_new_business_date := new.business_date;
    if tg_op <> 'INSERT' then
      v_old_store_id := old.store_id;
      v_old_business_date := old.business_date;
    end if;
  else
    v_new_store_id := new.origin_store_id;
    v_new_business_date := new.business_date;
    if tg_op <> 'INSERT' then
      v_old_store_id := old.origin_store_id;
      v_old_business_date := old.business_date;
    end if;
  end if;

  for v_lock_key in
    select distinct hashtextextended(
      scope.store_id::text || ':' || scope.business_date::text,
      0
    ) as lock_key
    from (
      values
        (v_old_store_id, v_old_business_date),
        (v_new_store_id, v_new_business_date)
    ) as scope(store_id, business_date)
    where scope.store_id is not null and scope.business_date is not null
    order by lock_key
  loop
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  if tg_op <> 'INSERT' and exists (
    select 1
    from public.cash_closings as closing
    where closing.store_id = v_old_store_id
      and closing.business_date = v_old_business_date
      and closing.status = 'closed'
  ) then
    raise exception 'El movimiento pertenece a un corte cerrado y no puede modificarse'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.cash_closings as closing
    where closing.store_id = v_new_store_id
      and closing.business_date = v_new_business_date
      and closing.status = 'closed'
  ) then
    raise exception 'No se pueden registrar movimientos en un corte cerrado'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger expenses_guard_closed_movement
before insert or update on public.expenses
for each row execute function private.operations_guard_closed_movement();

create trigger merchandise_transfers_guard_closed_movement
before insert or update on public.merchandise_transfers
for each row execute function private.operations_guard_closed_movement();

create or replace function public.close_cash_closing(
  p_id uuid,
  p_store_id uuid,
  p_business_date date,
  p_gross_sales numeric,
  p_bills jsonb,
  p_balance_bills jsonb,
  p_notes text
)
returns public.cash_closings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.cash_closings;
  v_closing public.cash_closings;
  v_expenses_total numeric(12, 2);
  v_cash_expenses_total numeric(12, 2);
  v_outgoing_transfers_total numeric(12, 2);
  v_store_cash_payments_total numeric(12, 2) := 0;
  v_operational_outflows_total numeric(12, 2);
  v_cash_outflows_total numeric(12, 2);
  v_counted_cash numeric(12, 2);
  v_cash_balance numeric(12, 2);
  v_cash_to_withdraw numeric(12, 2);
  v_expected_cash numeric(12, 2);
  v_difference numeric(12, 2);
  v_withdraw_bills jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Sólo administración puede cerrar caja'
      using errcode = '42501';
  end if;
  if p_id is null or p_store_id is null or p_business_date is null then
    raise exception 'El corte requiere identificador, tienda y fecha'
      using errcode = '22023';
  end if;
  if p_business_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'La fecha del corte no puede ser futura'
      using errcode = '22007';
  end if;
  if p_gross_sales is null
    or p_gross_sales < 0
    or p_gross_sales <> round(p_gross_sales, 2) then
    raise exception 'Las ventas brutas no son válidas'
      using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Las notas no pueden exceder 1000 caracteres'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.stores as store where store.id = p_store_id
  ) then
    raise exception 'La tienda del corte no existe'
      using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_store_id::text || ':' || p_business_date::text,
    0
  ));

  select closing.* into v_existing
  from public.cash_closings as closing
  where closing.store_id = p_store_id
    and closing.business_date = p_business_date
  for update;

  if found then
    if v_existing.id = p_id and v_existing.status = 'closed' then
      return v_existing;
    end if;
    raise exception 'Ya existe un corte para esta tienda y fecha'
      using errcode = '23505';
  end if;

  if p_bills is null
    or p_balance_bills is null
    or jsonb_typeof(p_bills) <> 'object'
    or jsonb_typeof(p_balance_bills) <> 'object' then
    raise exception 'El desglose de efectivo es obligatorio'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (values
      ('b1000'), ('b500'), ('b200'), ('b100'), ('b50'), ('b20'), ('monedas')
    ) as denomination(key)
    where (p_bills ? denomination.key
      and jsonb_typeof(p_bills -> denomination.key) <> 'number')
      or (p_balance_bills ? denomination.key
        and jsonb_typeof(p_balance_bills -> denomination.key) <> 'number')
  ) then
    raise exception 'El desglose de efectivo no es válido'
      using errcode = '22023';
  end if;

  begin
    v_counted_cash := round(
      coalesce((p_bills ->> 'b1000')::numeric, 0) * 1000
      + coalesce((p_bills ->> 'b500')::numeric, 0) * 500
      + coalesce((p_bills ->> 'b200')::numeric, 0) * 200
      + coalesce((p_bills ->> 'b100')::numeric, 0) * 100
      + coalesce((p_bills ->> 'b50')::numeric, 0) * 50
      + coalesce((p_bills ->> 'b20')::numeric, 0) * 20
      + coalesce((p_bills ->> 'monedas')::numeric, 0),
      2
    );
    v_cash_balance := round(
      coalesce((p_balance_bills ->> 'b1000')::numeric, 0) * 1000
      + coalesce((p_balance_bills ->> 'b500')::numeric, 0) * 500
      + coalesce((p_balance_bills ->> 'b200')::numeric, 0) * 200
      + coalesce((p_balance_bills ->> 'b100')::numeric, 0) * 100
      + coalesce((p_balance_bills ->> 'b50')::numeric, 0) * 50
      + coalesce((p_balance_bills ->> 'b20')::numeric, 0) * 20
      + coalesce((p_balance_bills ->> 'monedas')::numeric, 0),
      2
    );
  exception when invalid_text_representation then
    raise exception 'El desglose de efectivo no es válido'
      using errcode = '22023';
  end;

  if exists (
    select 1
    from (values
      ('b1000'), ('b500'), ('b200'), ('b100'), ('b50'), ('b20')
    ) as denomination(key)
    where coalesce((p_bills ->> denomination.key)::numeric, 0) < 0
      or coalesce((p_bills ->> denomination.key)::numeric, 0) <> trunc(
        coalesce((p_bills ->> denomination.key)::numeric, 0)
      )
      or coalesce((p_balance_bills ->> denomination.key)::numeric, 0) < 0
      or coalesce((p_balance_bills ->> denomination.key)::numeric, 0) <> trunc(
        coalesce((p_balance_bills ->> denomination.key)::numeric, 0)
      )
      or coalesce((p_balance_bills ->> denomination.key)::numeric, 0) >
        coalesce((p_bills ->> denomination.key)::numeric, 0)
  )
  or coalesce((p_bills ->> 'monedas')::numeric, 0) < 0
  or coalesce((p_bills ->> 'monedas')::numeric, 0) <>
    round(coalesce((p_bills ->> 'monedas')::numeric, 0), 2)
  or coalesce((p_balance_bills ->> 'monedas')::numeric, 0) < 0
  or coalesce((p_balance_bills ->> 'monedas')::numeric, 0) <>
    round(coalesce((p_balance_bills ->> 'monedas')::numeric, 0), 2)
  or coalesce((p_balance_bills ->> 'monedas')::numeric, 0) >
    coalesce((p_bills ->> 'monedas')::numeric, 0) then
    raise exception 'El saldo de caja no puede superar el efectivo contado'
      using errcode = '22023';
  end if;

  select
    coalesce(sum(expense.amount), 0),
    coalesce(sum(expense.amount) filter (
      where expense.payment_method = 'efectivo'
    ), 0)
  into v_expenses_total, v_cash_expenses_total
  from public.expenses as expense
  where expense.store_id = p_store_id
    and expense.business_date = p_business_date;

  select coalesce(sum(transfer.amount), 0)
  into v_outgoing_transfers_total
  from public.merchandise_transfers as transfer
  where transfer.origin_store_id = p_store_id
    and transfer.business_date = p_business_date;

  v_operational_outflows_total := round(
    v_expenses_total
    + v_outgoing_transfers_total
    + v_store_cash_payments_total,
    2
  );
  v_cash_outflows_total := round(
    v_cash_expenses_total + v_store_cash_payments_total,
    2
  );
  v_cash_to_withdraw := round(v_counted_cash - v_cash_balance, 2);
  v_expected_cash := round(p_gross_sales - v_cash_outflows_total, 2);
  v_difference := round(v_counted_cash - v_expected_cash, 2);
  v_withdraw_bills := jsonb_build_object(
    'b1000', coalesce((p_bills ->> 'b1000')::numeric, 0) - coalesce((p_balance_bills ->> 'b1000')::numeric, 0),
    'b500', coalesce((p_bills ->> 'b500')::numeric, 0) - coalesce((p_balance_bills ->> 'b500')::numeric, 0),
    'b200', coalesce((p_bills ->> 'b200')::numeric, 0) - coalesce((p_balance_bills ->> 'b200')::numeric, 0),
    'b100', coalesce((p_bills ->> 'b100')::numeric, 0) - coalesce((p_balance_bills ->> 'b100')::numeric, 0),
    'b50', coalesce((p_bills ->> 'b50')::numeric, 0) - coalesce((p_balance_bills ->> 'b50')::numeric, 0),
    'b20', coalesce((p_bills ->> 'b20')::numeric, 0) - coalesce((p_balance_bills ->> 'b20')::numeric, 0),
    'monedas', coalesce((p_bills ->> 'monedas')::numeric, 0) - coalesce((p_balance_bills ->> 'monedas')::numeric, 0)
  );

  insert into public.cash_closings (
    id, store_id, business_date, gross_sales, expense_total,
    cash_expense_total, expenses_total_snapshot,
    cash_expenses_total_snapshot, outgoing_transfers_total_snapshot,
    store_cash_payments_total_snapshot, operational_outflows_total_snapshot,
    cash_outflows_total_snapshot, other_movements, opening_balance,
    counted_cash, cash_balance, cash_to_withdraw, expected_cash, difference,
    bills, balance_bills, withdraw_bills, notes, status, closed_at,
    closed_by, created_by
  )
  values (
    p_id, p_store_id, p_business_date, p_gross_sales, v_expenses_total,
    v_cash_expenses_total, v_expenses_total, v_cash_expenses_total,
    v_outgoing_transfers_total, v_store_cash_payments_total,
    v_operational_outflows_total, v_cash_outflows_total, 0, 0,
    v_counted_cash, v_cash_balance, v_cash_to_withdraw, v_expected_cash,
    v_difference, p_bills, p_balance_bills, v_withdraw_bills,
    nullif(btrim(p_notes), ''), 'closed', now(), auth.uid(), auth.uid()
  )
  returning * into v_closing;

  insert into public.cash_closing_transfer_items (
    cash_closing_id, transfer_id, amount_snapshot, ticket_number_snapshot
  )
  select
    v_closing.id, transfer.id, transfer.amount, transfer.ticket_number
  from public.merchandise_transfers as transfer
  where transfer.origin_store_id = p_store_id
    and transfer.business_date = p_business_date;

  return v_closing;
end;
$$;

alter table public.cash_closing_transfer_items enable row level security;

create policy "admins can read closing transfer snapshots"
on public.cash_closing_transfer_items for select to authenticated
using ((select private.is_admin()));

revoke all on public.cash_closing_transfer_items
  from public, anon, authenticated;
grant select on public.cash_closing_transfer_items to authenticated;
revoke insert, update on public.cash_closings from authenticated;

revoke all on function private.operations_guard_closed_movement()
  from public, anon, authenticated;
revoke all on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text
) to authenticated;

comment on table public.cash_closing_transfer_items is
  'Evidencia histórica de las transferencias salientes incluidas al cerrar caja.';
comment on column public.cash_closings.operational_outflows_total_snapshot is
  'Gastos, transferencias salientes y pagos de tienda congelados al cerrar.';
comment on column public.cash_closings.cash_outflows_total_snapshot is
  'Salidas físicas de efectivo congeladas al cerrar; excluye mercancía.';
comment on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text
) is 'Cierra caja calculando salidas y snapshots desde datos autoritativos.';
