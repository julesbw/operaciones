-- Permite múltiples cortes por tienda/fecha y asocia únicamente los
-- movimientos seleccionados. Esta migración reemplaza el cierre automático
-- de todos los movimientos del día creado en 202608130001.

drop function if exists public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text
);

drop trigger if exists expenses_guard_closed_movement on public.expenses;
drop trigger if exists merchandise_transfers_guard_closed_movement
  on public.merchandise_transfers;
drop function if exists private.operations_guard_closed_movement();

alter table public.cash_closings
  drop constraint if exists cash_closings_store_date_key,
  add column closing_number integer;

with numbered as (
  select
    closing.id,
    row_number() over (
      partition by closing.store_id, closing.business_date
      order by closing.closed_at, closing.created_at, closing.id
    ) as closing_number
  from public.cash_closings as closing
)
update public.cash_closings as closing
set closing_number = numbered.closing_number
from numbered
where numbered.id = closing.id;

alter table public.cash_closings
  alter column closing_number set not null,
  add constraint cash_closings_store_date_number_key
    unique (store_id, business_date, closing_number),
  add constraint cash_closings_closing_number_check
    check (closing_number > 0);

create table public.cash_closing_expense_items (
  cash_closing_id uuid not null
    references public.cash_closings(id) on delete restrict,
  expense_id uuid not null
    references public.expenses(id) on delete restrict,
  amount_snapshot numeric(12, 2) not null check (amount_snapshot > 0),
  concept_snapshot text not null check (
    length(btrim(concept_snapshot)) > 0
    and length(concept_snapshot) <= 160
  ),
  payment_method_snapshot text not null check (
    payment_method_snapshot in ('efectivo', 'tarjeta', 'transferencia', 'otro')
  ),
  created_at timestamptz not null default now(),
  primary key (cash_closing_id, expense_id),
  unique (expense_id)
);

create index cash_closing_expense_items_closing_idx
  on public.cash_closing_expense_items(cash_closing_id);

-- Una asociación cerrada vuelve inmutable al movimiento concreto, no a toda
-- la tienda/fecha. Se permiten movimientos nuevos y cortes posteriores.
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

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger expenses_guard_assigned_movement
before update or delete on public.expenses
for each row execute function private.operations_guard_assigned_movement();

create trigger merchandise_transfers_guard_assigned_movement
before update or delete on public.merchandise_transfers
for each row execute function private.operations_guard_assigned_movement();

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
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Sólo administración puede consultar candidatos de corte'
      using errcode = '42501';
  end if;
  if p_store_id is null or p_business_date is null then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND'
      using errcode = '22023',
      detail = 'La tienda y fecha operativa son obligatorias.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(expense) order by expense.created_at), '[]'::jsonb)
  into v_expenses
  from public.expenses as expense
  where expense.store_id = p_store_id
    and expense.business_date = p_business_date
    and not exists (
      select 1
      from public.cash_closing_expense_items as item
      where item.expense_id = expense.id
    );

  select coalesce(jsonb_agg(to_jsonb(transfer) order by transfer.created_at), '[]'::jsonb)
  into v_transfers
  from public.merchandise_transfers as transfer
  where transfer.origin_store_id = p_store_id
    and transfer.business_date = p_business_date
    and not exists (
      select 1
      from public.cash_closing_transfer_items as item
      where item.transfer_id = transfer.id
    );

  return jsonb_build_object(
    'expenses', v_expenses,
    'transfers', v_transfers
  );
end;
$$;

create or replace function public.close_cash_closing(
  p_id uuid,
  p_store_id uuid,
  p_business_date date,
  p_gross_sales numeric,
  p_bills jsonb,
  p_balance_bills jsonb,
  p_notes text,
  p_expense_ids uuid[],
  p_transfer_ids uuid[]
)
returns public.cash_closings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense_ids uuid[] := coalesce(p_expense_ids, '{}'::uuid[]);
  v_transfer_ids uuid[] := coalesce(p_transfer_ids, '{}'::uuid[]);
  v_existing public.cash_closings;
  v_closing public.cash_closings;
  v_closing_number integer;
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
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND'
      using errcode = '22023',
      detail = 'El corte requiere identificador, tienda y fecha.';
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
  if cardinality(v_expense_ids) <> (
    select count(distinct selected.id)
    from unnest(v_expense_ids) as selected(id)
  ) or cardinality(v_transfer_ids) <> (
    select count(distinct selected.id)
    from unnest(v_transfer_ids) as selected(id)
  ) then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND'
      using errcode = '22023',
      detail = 'La selección contiene identificadores duplicados.';
  end if;

  -- Todos los cierres de la misma tienda/fecha comparten este bloqueo. Con él
  -- se asigna el consecutivo y se serializa el consumo de movimientos.
  perform pg_advisory_xact_lock(hashtextextended(
    p_store_id::text || ':' || p_business_date::text,
    0
  ));

  select closing.* into v_existing
  from public.cash_closings as closing
  where closing.id = p_id
  for update;

  if found then
    if v_existing.store_id = p_store_id
      and v_existing.business_date = p_business_date
      and v_existing.status = 'closed' then
      return v_existing;
    end if;
    raise exception 'CLOSING_ALREADY_EXISTS'
      using errcode = '23505',
      detail = 'El identificador ya corresponde a otro corte.';
  end if;

  if cardinality(v_expense_ids) <> (
    select count(*)
    from public.expenses as expense
    where expense.id = any(v_expense_ids)
      and expense.store_id = p_store_id
      and expense.business_date = p_business_date
  ) or cardinality(v_transfer_ids) <> (
    select count(*)
    from public.merchandise_transfers as transfer
    where transfer.id = any(v_transfer_ids)
      and transfer.origin_store_id = p_store_id
      and transfer.business_date = p_business_date
  ) then
    raise exception 'SELECTED_MOVEMENT_NOT_FOUND'
      using errcode = 'P0001',
      detail = 'Uno o más movimientos no pertenecen a la tienda y fecha del corte.';
  end if;

  if exists (
    select 1
    from public.cash_closing_expense_items as item
    where item.expense_id = any(v_expense_ids)
  ) or exists (
    select 1
    from public.cash_closing_transfer_items as item
    where item.transfer_id = any(v_transfer_ids)
  ) then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = 'P0001',
      detail = 'Uno o más movimientos pertenecen a otro corte.';
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
  where expense.id = any(v_expense_ids);

  select coalesce(sum(transfer.amount), 0)
  into v_outgoing_transfers_total
  from public.merchandise_transfers as transfer
  where transfer.id = any(v_transfer_ids);

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
  select coalesce(max(closing.closing_number), 0) + 1
  into v_closing_number
  from public.cash_closings as closing
  where closing.store_id = p_store_id
    and closing.business_date = p_business_date;

  begin
    insert into public.cash_closings (
      id, store_id, business_date, closing_number, gross_sales, expense_total,
      cash_expense_total, expenses_total_snapshot,
      cash_expenses_total_snapshot, outgoing_transfers_total_snapshot,
      store_cash_payments_total_snapshot, operational_outflows_total_snapshot,
      cash_outflows_total_snapshot, other_movements, opening_balance,
      counted_cash, cash_balance, cash_to_withdraw, expected_cash, difference,
      bills, balance_bills, withdraw_bills, notes, status, closed_at,
      closed_by, created_by
    )
    values (
      p_id, p_store_id, p_business_date, v_closing_number, p_gross_sales,
      v_expenses_total, v_cash_expenses_total, v_expenses_total,
      v_cash_expenses_total, v_outgoing_transfers_total,
      v_store_cash_payments_total, v_operational_outflows_total,
      v_cash_outflows_total, 0, 0, v_counted_cash, v_cash_balance,
      v_cash_to_withdraw, v_expected_cash, v_difference, p_bills,
      p_balance_bills, v_withdraw_bills, nullif(btrim(p_notes), ''),
      'closed', now(), auth.uid(), auth.uid()
    )
    returning * into v_closing;

    insert into public.cash_closing_expense_items (
      cash_closing_id, expense_id, amount_snapshot, concept_snapshot,
      payment_method_snapshot
    )
    select
      v_closing.id, expense.id, expense.amount, expense.concept,
      expense.payment_method
    from public.expenses as expense
    where expense.id = any(v_expense_ids);

    insert into public.cash_closing_transfer_items (
      cash_closing_id, transfer_id, amount_snapshot, ticket_number_snapshot
    )
    select
      v_closing.id, transfer.id, transfer.amount, transfer.ticket_number
    from public.merchandise_transfers as transfer
    where transfer.id = any(v_transfer_ids);
  exception when unique_violation then
    raise exception 'MOVEMENT_ALREADY_ASSIGNED'
      using errcode = 'P0001',
      detail = 'Uno o más movimientos fueron consumidos por otro corte.';
  end;

  return v_closing;
end;
$$;

alter table public.cash_closing_expense_items enable row level security;

create policy "admins can read closing expense snapshots"
on public.cash_closing_expense_items for select to authenticated
using ((select private.is_admin()));

revoke all on public.cash_closing_expense_items
  from public, anon, authenticated;
grant select on public.cash_closing_expense_items to authenticated;

revoke all on function private.operations_guard_assigned_movement()
  from public, anon, authenticated;
revoke all on function public.get_cash_closing_candidates(uuid, date)
  from public, anon, authenticated;
grant execute on function public.get_cash_closing_candidates(uuid, date)
  to authenticated;
revoke all on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[]
) from public, anon, authenticated;
grant execute on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[]
) to authenticated;

comment on column public.cash_closings.closing_number is
  'Consecutivo del corte dentro de una tienda y fecha operativa.';
comment on table public.cash_closing_expense_items is
  'Evidencia histórica de los gastos seleccionados para un corte.';
comment on function public.get_cash_closing_candidates(uuid, date) is
  'Devuelve movimientos sincronizados de la fecha que todavía no pertenecen a un corte.';
comment on function public.close_cash_closing(
  uuid, uuid, date, numeric, jsonb, jsonb, text, uuid[], uuid[]
) is 'Cierra y numera un corte asociando sólo los movimientos seleccionados.';
