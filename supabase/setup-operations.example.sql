-- Ejecuta este archivo después de la migración de Operaciones.
-- Sustituye los correos y nombres de ejemplo. No guardes datos reales aquí.

insert into public.stores (name, status)
select 'Tienda Centro', 'active'
where not exists (
  select 1 from public.stores where lower(btrim(name)) = lower('Tienda Centro')
);

insert into public.stores (name, status)
select 'Tienda Norte', 'active'
where not exists (
  select 1 from public.stores where lower(btrim(name)) = lower('Tienda Norte')
);

-- Los administradores pueden conservar store_id nulo porque trabajan con todas las tiendas.
update public.profiles as profile
set store_id = null
from auth.users as auth_user
where profile.id = auth_user.id
  and auth_user.email = 'admin@example.com'
  and profile.role = 'admin';

-- Cada cajera debe quedar asociada a exactamente una tienda operativa.
update public.profiles as profile
set store_id = store.id
from auth.users as auth_user
cross join public.stores as store
where profile.id = auth_user.id
  and auth_user.email = 'cashier@example.com'
  and profile.role = 'cashier'
  and lower(btrim(store.name)) = lower('Tienda Centro');
