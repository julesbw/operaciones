-- Transferencias de mercancía local-first.
-- Este módulo registra salidas operativas; no representa movimientos de efectivo
-- ni modifica inventarios.

create table public.merchandise_transfers (
  id uuid primary key default gen_random_uuid(),
  origin_store_id uuid not null references public.stores(id) on delete restrict,
  destination_store_id uuid not null references public.stores(id) on delete restrict,
  ticket_number text not null check (
    length(btrim(ticket_number)) > 0 and length(ticket_number) <= 80
  ),
  amount numeric(12, 2) not null check (
    amount > 0 and amount = round(amount, 2)
  ),
  business_date date not null,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint merchandise_transfers_distinct_stores_check check (
    origin_store_id <> destination_store_id
  )
);

create index merchandise_transfers_origin_date_idx
  on public.merchandise_transfers(origin_store_id, business_date desc);
create index merchandise_transfers_destination_date_idx
  on public.merchandise_transfers(destination_store_id, business_date desc);
create index merchandise_transfers_ticket_idx
  on public.merchandise_transfers(ticket_number);

-- La fecha futura depende de la zona operativa, por lo que se valida en un
-- trigger en lugar de un CHECK dependiente del reloj.
create or replace function private.operations_validate_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.business_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'La fecha de la transferencia no puede ser futura'
      using errcode = '22007';
  end if;
  return new;
end;
$$;

create trigger merchandise_transfers_validate
before insert or update on public.merchandise_transfers
for each row execute function private.operations_validate_transfer();

-- Escritura idempotente para altas offline. Los retries de una cashier pueden
-- devolver la fila ya insertada, pero sólo administración puede corregirla.
create or replace function public.sync_merchandise_transfer(
  p_id uuid,
  p_base_version integer,
  p_origin_store_id uuid,
  p_destination_store_id uuid,
  p_ticket_number text,
  p_amount numeric,
  p_business_date date,
  p_notes text,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_created_by uuid
)
returns public.merchandise_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.merchandise_transfers;
  v_transfer public.merchandise_transfers;
  v_origin_active boolean;
  v_destination_active boolean;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if p_base_version is null or p_base_version < 0 then
    raise exception 'La versión local no es válida' using errcode = '22023';
  end if;
  if p_origin_store_id is not distinct from p_destination_store_id then
    raise exception 'La tienda de destino debe ser diferente al origen'
      using errcode = '22023';
  end if;
  if p_business_date > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'La fecha de la transferencia no puede ser futura'
      using errcode = '22007';
  end if;
  if not private.is_admin()
    and p_origin_store_id is distinct from private.operations_current_store_id() then
    raise exception 'No puedes registrar transferencias de otra tienda'
      using errcode = '42501';
  end if;

  select transfer.* into v_existing
  from public.merchandise_transfers as transfer
  where transfer.id = p_id
  for update;

  if found then
    if v_existing.origin_store_id <> p_origin_store_id
      or v_existing.created_by <> p_created_by then
      raise exception 'No puedes cambiar la identidad de esta transferencia'
        using errcode = '42501';
    end if;
    if v_existing.version = p_base_version + 1
      and v_existing.destination_store_id = p_destination_store_id
      and v_existing.ticket_number = btrim(p_ticket_number)
      and v_existing.amount = p_amount
      and v_existing.business_date = p_business_date
      and v_existing.notes is not distinct from nullif(btrim(p_notes), '')
      and v_existing.updated_at = p_updated_at then
      return v_existing;
    end if;
    if not private.is_admin() then
      raise exception 'Sólo administración puede corregir transferencias registradas'
        using errcode = '42501';
    end if;
    if v_existing.version <> p_base_version then
      raise exception 'La transferencia remota cambió; requiere revisión'
        using errcode = '40001';
    end if;

    update public.merchandise_transfers
    set
      destination_store_id = p_destination_store_id,
      ticket_number = btrim(p_ticket_number),
      amount = p_amount,
      business_date = p_business_date,
      notes = nullif(btrim(p_notes), ''),
      updated_at = p_updated_at,
      version = v_existing.version + 1
    where id = p_id
    returning * into v_transfer;
  else
    if p_base_version <> 0 then
      raise exception 'No existe la versión remota esperada de la transferencia'
        using errcode = '40001';
    end if;
    if p_created_by is distinct from auth.uid() then
      raise exception 'El autor local no corresponde a la sesión'
        using errcode = '42501';
    end if;

    select store.status = 'active' into v_origin_active
    from public.stores as store
    where store.id = p_origin_store_id;
    select store.status = 'active' into v_destination_active
    from public.stores as store
    where store.id = p_destination_store_id;
    if not coalesce(v_origin_active, false)
      or not coalesce(v_destination_active, false) then
      raise exception 'El origen y el destino deben ser tiendas activas'
        using errcode = '22023';
    end if;

    insert into public.merchandise_transfers (
      id, origin_store_id, destination_store_id, ticket_number, amount,
      business_date, notes, created_by, created_at, updated_at, version
    )
    values (
      p_id, p_origin_store_id, p_destination_store_id,
      btrim(p_ticket_number), p_amount, p_business_date,
      nullif(btrim(p_notes), ''), p_created_by, p_created_at, p_updated_at, 1
    )
    returning * into v_transfer;
  end if;

  return v_transfer;
end;
$$;

alter table public.merchandise_transfers enable row level security;

create policy "users can read outgoing transfers from their store"
on public.merchandise_transfers for select to authenticated
using (
  (select private.is_admin())
  or origin_store_id = (select private.operations_current_store_id())
);

-- Una cashier necesita los nombres de todas las tiendas activas para elegir
-- destino. También conserva lectura de su tienda asignada si después se
-- desactiva, para que los históricos sigan mostrando su nombre.
drop policy "users can read assigned stores and admins can read all"
  on public.stores;
create policy "users can read active stores and admins can read all"
on public.stores for select to authenticated
using (
  (select private.is_admin())
  or status = 'active'
  or id = (select private.operations_current_store_id())
);

revoke all on public.merchandise_transfers from public, anon, authenticated;
grant select on public.merchandise_transfers to authenticated;

revoke all on function private.operations_validate_transfer()
  from public, anon, authenticated;
revoke all on function public.sync_merchandise_transfer(
  uuid, integer, uuid, uuid, text, numeric, date, text,
  timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.sync_merchandise_transfer(
  uuid, integer, uuid, uuid, text, numeric, date, text,
  timestamptz, timestamptz, uuid
) to authenticated;

comment on table public.merchandise_transfers is
  'Transferencias salientes de mercancía; son salida operativa, no salida física de efectivo.';
comment on column public.merchandise_transfers.business_date is
  'Fecha operativa utilizada junto con origin_store_id para integrar Cortes.';
comment on function public.sync_merchandise_transfer(
  uuid, integer, uuid, uuid, text, numeric, date, text,
  timestamptz, timestamptz, uuid
) is 'Sincroniza de forma idempotente una transferencia creada localmente.';
