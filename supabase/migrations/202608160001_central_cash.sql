-- Caja Central v1. Esta migración es aditiva y debe revisarse y probarse en
-- local/dev antes de aplicarse a una base remota.

create table public.central_cash_movements (
  id uuid primary key,
  movement_type text not null
    check (movement_type in ('inflow', 'outflow')),
  source_type text not null
    check (source_type in (
      'cash_closing',
      'manual_adjustment',
      'purchase',
      'expense',
      'collaborator_payment',
      'bank_deposit',
      'other'
    )),
  source_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  business_date date not null,
  concept text not null check (
    length(btrim(concept)) > 0 and length(concept) <= 160
  ),
  notes text check (notes is null or length(notes) <= 500),
  bills_snapshot jsonb not null check (jsonb_typeof(bills_snapshot) = 'object'),
  coins_amount numeric(12, 2) not null default 0 check (coins_amount >= 0),
  store_id_snapshot uuid,
  store_name_snapshot text check (
    store_name_snapshot is null
    or (
      length(btrim(store_name_snapshot)) > 0
      and length(store_name_snapshot) <= 120
    )
  ),
  sequence_number_snapshot integer check (
    sequence_number_snapshot is null or sequence_number_snapshot > 0
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_name_snapshot text not null check (
    length(btrim(created_by_name_snapshot)) > 0
    and length(created_by_name_snapshot) <= 160
  ),
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index central_cash_movements_business_date_idx
  on public.central_cash_movements(business_date desc, created_at desc);
create index central_cash_movements_store_date_idx
  on public.central_cash_movements(store_id_snapshot, business_date desc);

create table public.central_cash_receipts (
  id uuid primary key,
  cash_closing_id uuid not null unique
    references public.cash_closings(id) on delete restrict,
  movement_id uuid not null unique
    references public.central_cash_movements(id) on delete restrict,
  amount_snapshot numeric(12, 2) not null check (amount_snapshot > 0),
  bills_snapshot jsonb not null check (jsonb_typeof(bills_snapshot) = 'object'),
  coins_amount_snapshot numeric(12, 2) not null default 0
    check (coins_amount_snapshot >= 0),
  store_id_snapshot uuid not null,
  store_name_snapshot text not null check (
    length(btrim(store_name_snapshot)) > 0
    and length(store_name_snapshot) <= 120
  ),
  sequence_number_snapshot integer not null
    check (sequence_number_snapshot > 0),
  business_date date not null,
  notes text check (notes is null or length(notes) <= 500),
  received_by uuid not null references auth.users(id) on delete restrict,
  received_by_name_snapshot text not null check (
    length(btrim(received_by_name_snapshot)) > 0
    and length(received_by_name_snapshot) <= 160
  ),
  received_at timestamptz not null default now()
);

create index central_cash_receipts_business_date_idx
  on public.central_cash_receipts(business_date desc, received_at desc);

create or replace function private.operations_central_cash_require_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'CENTRAL_CASH_REQUIRES_ADMIN'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.operations_central_cash_valid_bills(
  p_bills jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_bills) = 'object'
    and coalesce((p_bills ->> 'b1000') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b500') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b200') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b100') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b50') ~ '^[0-9]+$', false)
    and coalesce((p_bills ->> 'b20') ~ '^[0-9]+$', false);
$$;

create or replace function private.operations_central_cash_bills_total(
  p_bills jsonb
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(
    (p_bills ->> 'b1000')::numeric * 1000
    + (p_bills ->> 'b500')::numeric * 500
    + (p_bills ->> 'b200')::numeric * 200
    + (p_bills ->> 'b100')::numeric * 100
    + (p_bills ->> 'b50')::numeric * 50
    + (p_bills ->> 'b20')::numeric * 20,
    2
  );
$$;

create or replace function private.operations_central_cash_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'CENTRAL_CASH_HISTORY_IMMUTABLE'
    using errcode = '55000';
end;
$$;

create trigger central_cash_movements_immutable
before update or delete on public.central_cash_movements
for each row execute function private.operations_central_cash_immutable();

create trigger central_cash_receipts_immutable
before update or delete on public.central_cash_receipts
for each row execute function private.operations_central_cash_immutable();

create or replace function public.get_central_cash_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'America/Mexico_City')::date;
  v_result jsonb;
begin
  perform private.operations_central_cash_require_admin();

  select pg_catalog.jsonb_build_object(
    'balance', coalesce(sum(
      case when movement.movement_type = 'inflow'
        then movement.amount else -movement.amount end
    ), 0),
    'today_inflows', coalesce(sum(movement.amount) filter (
      where movement.business_date = v_today
        and movement.movement_type = 'inflow'
    ), 0),
    'today_outflows', coalesce(sum(movement.amount) filter (
      where movement.business_date = v_today
        and movement.movement_type = 'outflow'
    ), 0),
    'today_net', coalesce(sum(
      case when movement.movement_type = 'inflow'
        then movement.amount else -movement.amount end
    ) filter (where movement.business_date = v_today), 0),
    'bills', pg_catalog.jsonb_build_object(
      'b1000', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b1000')::integer
        else -(movement.bills_snapshot ->> 'b1000')::integer end), 0),
      'b500', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b500')::integer
        else -(movement.bills_snapshot ->> 'b500')::integer end), 0),
      'b200', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b200')::integer
        else -(movement.bills_snapshot ->> 'b200')::integer end), 0),
      'b100', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b100')::integer
        else -(movement.bills_snapshot ->> 'b100')::integer end), 0),
      'b50', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b50')::integer
        else -(movement.bills_snapshot ->> 'b50')::integer end), 0),
      'b20', coalesce(sum(case when movement.movement_type = 'inflow'
        then (movement.bills_snapshot ->> 'b20')::integer
        else -(movement.bills_snapshot ->> 'b20')::integer end), 0)
    ),
    'coins_amount', coalesce(sum(case when movement.movement_type = 'inflow'
      then movement.coins_amount else -movement.coins_amount end), 0)
  )
  into v_result
  from public.central_cash_movements as movement;

  return v_result || pg_catalog.jsonb_build_object(
    'pending_closings_count', (
      select count(*)
      from public.cash_closings as closing
      where closing.status = 'closed'
        and not exists (
          select 1
          from public.central_cash_receipts as receipt
          where receipt.cash_closing_id = closing.id
        )
    ),
    'pending_closings_amount', (
      select coalesce(sum(closing.cash_to_withdraw), 0)
      from public.cash_closings as closing
      where closing.status = 'closed'
        and not exists (
          select 1
          from public.central_cash_receipts as receipt
          where receipt.cash_closing_id = closing.id
        )
    )
  );
end;
$$;

create or replace function public.list_pending_central_cash_closings(
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
  cash_to_withdraw numeric,
  withdraw_bills jsonb,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.operations_central_cash_require_admin();

  if p_date_from is not null and p_date_to is not null
    and p_date_from > p_date_to then
    raise exception 'El rango de fechas no es válido'
      using errcode = '22007';
  end if;

  return query
  select
    closing.id,
    closing.store_id,
    closing.store_name_snapshot,
    closing.business_date,
    closing.closing_number,
    closing.cash_to_withdraw,
    closing.withdraw_bills,
    closing.closed_at
  from public.cash_closings as closing
  where closing.status = 'closed'
    and (p_store_id is null or closing.store_id = p_store_id)
    and (p_date_from is null or closing.business_date >= p_date_from)
    and (p_date_to is null or closing.business_date <= p_date_to)
    and not exists (
      select 1
      from public.central_cash_receipts as receipt
      where receipt.cash_closing_id = closing.id
    )
  order by closing.business_date desc, closing.closing_number desc;
end;
$$;

create or replace function public.receive_cash_closing_into_central_cash(
  p_receipt_id uuid,
  p_cash_closing_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closing public.cash_closings;
  v_existing_receipt public.central_cash_receipts;
  v_receipt public.central_cash_receipts;
  v_movement public.central_cash_movements;
  v_bills jsonb;
  v_coins numeric(12, 2);
  v_actor_name text;
  v_received_at timestamptz := pg_catalog.now();
begin
  perform private.operations_central_cash_require_admin();

  if p_receipt_id is null or p_cash_closing_id is null then
    raise exception 'Los identificadores de recepción son obligatorios'
      using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 500 then
    raise exception 'Las notas no pueden exceder 500 caracteres'
      using errcode = '22001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('operations.central_cash_ledger')
  );

  select receipt.*
  into v_existing_receipt
  from public.central_cash_receipts as receipt
  where receipt.id = p_receipt_id;

  if found then
    if v_existing_receipt.cash_closing_id is distinct from p_cash_closing_id then
      raise exception 'CENTRAL_CASH_REQUEST_ID_CONFLICT'
        using errcode = '23505';
    end if;
    select movement.*
    into v_movement
    from public.central_cash_movements as movement
    where movement.id = v_existing_receipt.movement_id;
    return pg_catalog.jsonb_build_object(
      'receipt', to_jsonb(v_existing_receipt),
      'movement', to_jsonb(v_movement)
    );
  end if;

  select closing.*
  into v_closing
  from public.cash_closings as closing
  where closing.id = p_cash_closing_id
  for update;

  if not found then
    raise exception 'CENTRAL_CASH_CLOSING_NOT_FOUND'
      using errcode = 'P0002';
  end if;
  if v_closing.status <> 'closed' then
    raise exception 'CENTRAL_CASH_CLOSING_NOT_CLOSED'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.central_cash_receipts as receipt
    where receipt.cash_closing_id = p_cash_closing_id
  ) then
    raise exception 'CENTRAL_CASH_CLOSING_ALREADY_RECEIVED'
      using errcode = '23505';
  end if;

  if not (
    private.operations_central_cash_valid_bills(
      v_closing.withdraw_bills - 'monedas'
    ) and coalesce(
      (v_closing.withdraw_bills ->> 'monedas') ~ '^[0-9]+([.][0-9]{1,2})?$',
      false
    )
  ) then
    raise exception 'CENTRAL_CASH_CLOSING_MISMATCH'
      using errcode = '23514';
  end if;

  v_bills := pg_catalog.jsonb_build_object(
    'b1000', (v_closing.withdraw_bills ->> 'b1000')::integer,
    'b500', (v_closing.withdraw_bills ->> 'b500')::integer,
    'b200', (v_closing.withdraw_bills ->> 'b200')::integer,
    'b100', (v_closing.withdraw_bills ->> 'b100')::integer,
    'b50', (v_closing.withdraw_bills ->> 'b50')::integer,
    'b20', (v_closing.withdraw_bills ->> 'b20')::integer
  );
  v_coins := round((v_closing.withdraw_bills ->> 'monedas')::numeric, 2);

  if v_closing.cash_to_withdraw <= 0
    or round(
      private.operations_central_cash_bills_total(v_bills) + v_coins,
      2
    ) is distinct from round(v_closing.cash_to_withdraw, 2) then
    raise exception 'CENTRAL_CASH_CLOSING_MISMATCH'
      using errcode = '23514';
  end if;

  select coalesce(nullif(btrim(profile.full_name), ''), 'Administrador')
  into v_actor_name
  from public.profiles as profile
  where profile.id = auth.uid();
  v_actor_name := coalesce(v_actor_name, 'Administrador');

  insert into public.central_cash_movements (
    id, movement_type, source_type, source_id, amount, business_date,
    concept, notes, bills_snapshot, coins_amount, store_id_snapshot,
    store_name_snapshot, sequence_number_snapshot, created_by,
    created_by_name_snapshot, created_at
  )
  values (
    pg_catalog.gen_random_uuid(), 'inflow', 'cash_closing', v_closing.id,
    v_closing.cash_to_withdraw, v_closing.business_date,
    pg_catalog.format(
      'Corte #%s · %s',
      v_closing.closing_number,
      v_closing.store_name_snapshot
    ),
    nullif(btrim(p_notes), ''), v_bills, v_coins, v_closing.store_id,
    v_closing.store_name_snapshot, v_closing.closing_number, auth.uid(),
    v_actor_name, v_received_at
  )
  returning * into v_movement;

  insert into public.central_cash_receipts (
    id, cash_closing_id, movement_id, amount_snapshot, bills_snapshot,
    coins_amount_snapshot, store_id_snapshot, store_name_snapshot,
    sequence_number_snapshot, business_date, notes, received_by,
    received_by_name_snapshot, received_at
  )
  values (
    p_receipt_id, v_closing.id, v_movement.id, v_closing.cash_to_withdraw,
    v_bills, v_coins, v_closing.store_id, v_closing.store_name_snapshot,
    v_closing.closing_number, v_closing.business_date,
    nullif(btrim(p_notes), ''), auth.uid(), v_actor_name, v_received_at
  )
  returning * into v_receipt;

  return pg_catalog.jsonb_build_object(
    'receipt', to_jsonb(v_receipt),
    'movement', to_jsonb(v_movement)
  );
end;
$$;

create or replace function public.create_central_cash_adjustment(
  p_movement_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_business_date date,
  p_concept text,
  p_notes text,
  p_bills jsonb,
  p_coins_amount numeric
)
returns public.central_cash_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.central_cash_movements;
  v_movement public.central_cash_movements;
  v_actor_name text;
  v_balance numeric(12, 2);
  v_current_bills jsonb;
  v_current_coins numeric(12, 2);
begin
  perform private.operations_central_cash_require_admin();

  if p_movement_id is null or p_business_date is null then
    raise exception 'Los datos del ajuste están incompletos'
      using errcode = '22023';
  end if;
  if p_movement_type not in ('inflow', 'outflow') then
    raise exception 'El tipo de ajuste no es válido'
      using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor que cero'
      using errcode = '22003';
  end if;
  if p_business_date > (
    pg_catalog.now() at time zone 'America/Mexico_City'
  )::date then
    raise exception 'La fecha del ajuste no puede ser futura'
      using errcode = '22007';
  end if;
  if p_concept is null or length(btrim(p_concept)) = 0
    or length(p_concept) > 160 then
    raise exception 'El concepto del ajuste no es válido'
      using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 500 then
    raise exception 'Las notas no pueden exceder 500 caracteres'
      using errcode = '22001';
  end if;
  if not private.operations_central_cash_valid_bills(p_bills)
    or p_coins_amount is null or p_coins_amount < 0
    or round(p_coins_amount, 2) is distinct from p_coins_amount
    or round(
      private.operations_central_cash_bills_total(p_bills) + p_coins_amount,
      2
    ) is distinct from round(p_amount, 2) then
    raise exception 'CENTRAL_CASH_ADJUSTMENT_MISMATCH'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('operations.central_cash_ledger')
  );

  select movement.*
  into v_existing
  from public.central_cash_movements as movement
  where movement.id = p_movement_id;

  if found then
    if v_existing.source_type = 'manual_adjustment'
      and v_existing.source_id = p_movement_id
      and v_existing.movement_type = p_movement_type
      and v_existing.amount = round(p_amount, 2)
      and v_existing.business_date = p_business_date
      and v_existing.concept = btrim(p_concept)
      and v_existing.notes is not distinct from nullif(btrim(p_notes), '')
      and v_existing.bills_snapshot = p_bills
      and v_existing.coins_amount = p_coins_amount then
      return v_existing;
    end if;
    raise exception 'CENTRAL_CASH_REQUEST_ID_CONFLICT'
      using errcode = '23505';
  end if;

  if p_movement_type = 'outflow' then
    select
      coalesce(sum(case when movement.movement_type = 'inflow'
        then movement.amount else -movement.amount end), 0),
      pg_catalog.jsonb_build_object(
        'b1000', coalesce(sum(case when movement.movement_type = 'inflow'
          then (movement.bills_snapshot ->> 'b1000')::integer
          else -(movement.bills_snapshot ->> 'b1000')::integer end), 0),
        'b500', coalesce(sum(case when movement.movement_type = 'inflow'
          then (movement.bills_snapshot ->> 'b500')::integer
          else -(movement.bills_snapshot ->> 'b500')::integer end), 0),
        'b200', coalesce(sum(case when movement.movement_type = 'inflow'
          then (movement.bills_snapshot ->> 'b200')::integer
          else -(movement.bills_snapshot ->> 'b200')::integer end), 0),
        'b100', coalesce(sum(case when movement.movement_type = 'inflow'
          then (movement.bills_snapshot ->> 'b100')::integer
          else -(movement.bills_snapshot ->> 'b100')::integer end), 0),
        'b50', coalesce(sum(case when movement.movement_type = 'inflow'
          then (movement.bills_snapshot ->> 'b50')::integer
          else -(movement.bills_snapshot ->> 'b50')::integer end), 0),
        'b20', coalesce(sum(case when movement.movement_type = 'inflow'
          then (movement.bills_snapshot ->> 'b20')::integer
          else -(movement.bills_snapshot ->> 'b20')::integer end), 0)
      ),
      coalesce(sum(case when movement.movement_type = 'inflow'
        then movement.coins_amount else -movement.coins_amount end), 0)
    into v_balance, v_current_bills, v_current_coins
    from public.central_cash_movements as movement;

    if p_amount > v_balance
      or p_coins_amount > v_current_coins
      or (p_bills ->> 'b1000')::integer > (v_current_bills ->> 'b1000')::integer
      or (p_bills ->> 'b500')::integer > (v_current_bills ->> 'b500')::integer
      or (p_bills ->> 'b200')::integer > (v_current_bills ->> 'b200')::integer
      or (p_bills ->> 'b100')::integer > (v_current_bills ->> 'b100')::integer
      or (p_bills ->> 'b50')::integer > (v_current_bills ->> 'b50')::integer
      or (p_bills ->> 'b20')::integer > (v_current_bills ->> 'b20')::integer then
      raise exception 'CENTRAL_CASH_INSUFFICIENT_FUNDS'
        using errcode = '23514';
    end if;
  end if;

  select coalesce(nullif(btrim(profile.full_name), ''), 'Administrador')
  into v_actor_name
  from public.profiles as profile
  where profile.id = auth.uid();
  v_actor_name := coalesce(v_actor_name, 'Administrador');

  insert into public.central_cash_movements (
    id, movement_type, source_type, source_id, amount, business_date,
    concept, notes, bills_snapshot, coins_amount, created_by,
    created_by_name_snapshot
  )
  values (
    p_movement_id, p_movement_type, 'manual_adjustment', p_movement_id,
    round(p_amount, 2), p_business_date, btrim(p_concept),
    nullif(btrim(p_notes), ''), p_bills, p_coins_amount, auth.uid(),
    v_actor_name
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

alter table public.central_cash_movements enable row level security;
alter table public.central_cash_receipts enable row level security;

create policy "admins can read central cash movements"
on public.central_cash_movements for select to authenticated
using ((select private.is_admin()));

create policy "admins can read central cash receipts"
on public.central_cash_receipts for select to authenticated
using ((select private.is_admin()));

revoke all on public.central_cash_movements from public, anon, authenticated;
revoke all on public.central_cash_receipts from public, anon, authenticated;
grant select on public.central_cash_movements to authenticated;
grant select on public.central_cash_receipts to authenticated;

revoke all on function private.operations_central_cash_require_admin()
  from public, anon, authenticated;
revoke all on function private.operations_central_cash_valid_bills(jsonb)
  from public, anon, authenticated;
revoke all on function private.operations_central_cash_bills_total(jsonb)
  from public, anon, authenticated;
revoke all on function private.operations_central_cash_immutable()
  from public, anon, authenticated;

revoke all on function public.get_central_cash_summary()
  from public, anon, authenticated;
grant execute on function public.get_central_cash_summary()
  to authenticated;

revoke all on function public.list_pending_central_cash_closings(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.list_pending_central_cash_closings(uuid, date, date)
  to authenticated;

revoke all on function public.receive_cash_closing_into_central_cash(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.receive_cash_closing_into_central_cash(uuid, uuid, text)
  to authenticated;

revoke all on function public.create_central_cash_adjustment(
  uuid, text, numeric, date, text, text, jsonb, numeric
) from public, anon, authenticated;
grant execute on function public.create_central_cash_adjustment(
  uuid, text, numeric, date, text, text, jsonb, numeric
) to authenticated;

comment on table public.central_cash_receipts is
  'Evento físico e inmutable de recepción de un Corte en Caja Central.';
comment on table public.central_cash_movements is
  'Ledger inmutable del saldo financiero y físico de Caja Central.';
comment on function public.receive_cash_closing_into_central_cash(uuid, uuid, text) is
  'Recibe un Corte cerrado exactamente una vez y crea su entrada de ledger atómicamente.';
comment on function public.create_central_cash_adjustment(
  uuid, text, numeric, date, text, text, jsonb, numeric
) is 'Crea un ajuste administrativo idempotente sin editar el saldo directamente.';
