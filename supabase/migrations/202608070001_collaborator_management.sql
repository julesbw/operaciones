-- Alta atómica de colaboradores y su compensación.
create or replace function public.create_collaborator(
  p_id uuid,
  p_name text,
  p_store_id uuid,
  p_rest_day smallint,
  p_weekly_pay numeric
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
    raise exception 'Solo un administrador puede crear colaboradores'
      using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'El identificador es obligatorio' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 or length(p_name) > 120 then
    raise exception 'El nombre del colaborador no es válido'
      using errcode = '22023';
  end if;
  if p_rest_day is null or p_rest_day not between 0 and 6 then
    raise exception 'El día de descanso no es válido' using errcode = '22023';
  end if;
  if p_weekly_pay is null or p_weekly_pay < 0
    or p_weekly_pay <> round(p_weekly_pay, 2) then
    raise exception 'El pago semanal no es válido' using errcode = '22003';
  end if;
  if not exists (
    select 1
    from public.stores as store
    where store.id = p_store_id and store.status = 'active'
  ) then
    raise exception 'La tienda no existe o está inactiva' using errcode = 'P0002';
  end if;

  insert into public.collaborators (id, name, store_id, rest_day, status)
  values (p_id, btrim(p_name), p_store_id, p_rest_day, 'active')
  returning * into v_collaborator;

  insert into public.collaborator_compensation (
    collaborator_id,
    weekly_pay,
    updated_by
  )
  values (v_collaborator.id, p_weekly_pay, auth.uid());

  return v_collaborator;
end;
$$;

revoke all on function public.create_collaborator(
  uuid, text, uuid, smallint, numeric
) from public, anon, authenticated;

grant execute on function public.create_collaborator(
  uuid, text, uuid, smallint, numeric
) to authenticated;

comment on function public.create_collaborator(
  uuid, text, uuid, smallint, numeric
) is 'Crea un colaborador y su compensación en una sola transacción administrativa.';
