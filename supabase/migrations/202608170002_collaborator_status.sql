-- Activación/desactivación administrativa y protección de nuevas asistencias.
-- Esta migración debe aplicarse después de 202608130003_payments_module.sql.

create or replace function public.set_collaborator_status(
  p_id uuid,
  p_status text
)
returns public.collaborators
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collaborator public.collaborators;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Sólo un administrador puede cambiar el estado de colaboradores'
      using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'El identificador del colaborador es obligatorio'
      using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'El estado del colaborador no es válido'
      using errcode = '22023';
  end if;

  update public.collaborators
  set status = p_status
  where id = p_id
  returning * into v_collaborator;

  if not found then
    raise exception 'El colaborador no existe' using errcode = 'P0002';
  end if;

  return v_collaborator;
end;
$$;

-- La protección vive también en el trigger para cubrir escrituras directas y
-- cualquier futura RPC que inserte o actualice attendance_records.
create or replace function private.operations_validate_attendance_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_status text;
begin
  select collaborator.store_id, collaborator.status
  into v_store_id, v_status
  from public.collaborators as collaborator
  where collaborator.id = new.collaborator_id;

  if v_status is not null and v_status <> 'active' then
    raise exception 'COLLABORATOR_INACTIVE' using errcode = '55000';
  end if;
  if v_store_id is null or v_store_id <> new.store_id then
    raise exception 'La tienda no corresponde al colaborador' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.set_collaborator_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_collaborator_status(uuid, text)
  to authenticated;

revoke all on function private.operations_validate_attendance_store()
  from public, anon, authenticated;

comment on function public.set_collaborator_status(uuid, text) is
  'Activa o desactiva un colaborador sin eliminar ni modificar su historial.';
