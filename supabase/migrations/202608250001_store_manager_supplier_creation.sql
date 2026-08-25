-- Permite a store_manager crear proveedores mediante una AppSession protegida.
-- Renombrar, activar y desactivar proveedores permanece estrictamente admin-only.

create or replace function private.operator_has_capability(
  p_role text,
  p_capability text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_role
    when 'cashier' then p_capability in (
      'expense_store_cash', 'attendance', 'transfer'
    )
    when 'store_manager' then p_capability in (
      'expense_store_cash', 'attendance', 'transfer',
      'purchase_store_cash', 'cash_closing', 'supplier_create'
    )
    else false
  end;
$$;

create or replace function public.create_supplier(
  p_id uuid,
  p_name text,
  p_operator_token text
)
returns public.suppliers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_supplier public.suppliers;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;

  if not private.is_admin() then
    select * into v_session
    from private.require_operator_session(p_operator_token);
    if not private.operator_has_capability(
      v_session.role, 'supplier_create'
    ) then
      raise exception 'OPERATOR_CAPABILITY_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if p_id is null then
    raise exception 'SUPPLIER_ID_REQUIRED' using errcode = '22023';
  end if;
  if p_name is null
    or length(btrim(p_name)) = 0
    or length(btrim(p_name)) > 120 then
    raise exception 'SUPPLIER_NAME_INVALID' using errcode = '22023';
  end if;

  insert into public.suppliers (id, name, created_by)
  values (p_id, btrim(p_name), auth.uid())
  returning * into v_supplier;

  return v_supplier;
end;
$$;

revoke all on function public.create_supplier(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_supplier(uuid, text, text)
  to authenticated;

comment on function public.create_supplier(uuid, text, text) is
  'Crea un proveedor para admin o store_manager autorizado; no implementa aprobación ni permite modificar proveedores.';
