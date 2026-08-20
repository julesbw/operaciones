-- Supabase instala pgcrypto en extensions; la migración inicial de AppAccount
-- calificó esas funciones como public. Se añaden wrappers privados a la API de
-- aplicación ya desplegada, sin mover ni alterar la extensión compartida.
create or replace function public.gen_salt(p_type text, p_iterations integer)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select extensions.gen_salt(p_type, p_iterations);
$$;

create or replace function public.crypt(p_password text, p_salt text)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select extensions.crypt(p_password, p_salt);
$$;

create or replace function public.gen_random_bytes(p_count integer)
returns bytea
language sql
volatile
security invoker
set search_path = ''
as $$
  select extensions.gen_random_bytes(p_count);
$$;

create or replace function public.digest(p_data text, p_type text)
returns bytea
language sql
immutable
security invoker
set search_path = ''
as $$
  select extensions.digest(p_data, p_type);
$$;

revoke all on function public.gen_salt(text, integer) from public, anon, authenticated;
revoke all on function public.crypt(text, text) from public, anon, authenticated;
revoke all on function public.gen_random_bytes(integer) from public, anon, authenticated;
revoke all on function public.digest(text, text) from public, anon, authenticated;

comment on function public.gen_salt(text, integer) is
  'Compatibilidad interna para AppAccount: delega en extensions.pgcrypto; sin acceso cliente.';
