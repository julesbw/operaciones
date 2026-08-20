-- Identidad operativa paralela. No reemplaza profiles, auth.uid() ni autorización de dominios.
create extension if not exists pgcrypto;

create table public.app_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null check (
    username = lower(btrim(username))
    and username ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    and length(username) between 1 and 60
  ),
  display_name text not null check (
    length(btrim(display_name)) between 1 and 120
  ),
  role text not null check (role in ('cashier', 'store_manager')),
  store_id uuid not null references public.stores(id) on delete restrict,
  collaborator_id uuid references public.collaborators(id) on delete set null,
  pin_hash text not null,
  is_active boolean not null default true,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict
);

create unique index app_accounts_normalized_username_key
  on public.app_accounts (lower(username));
create index app_accounts_store_id_idx on public.app_accounts(store_id);
create index app_accounts_collaborator_id_idx on public.app_accounts(collaborator_id)
  where collaborator_id is not null;

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  app_account_id uuid not null references public.app_accounts(id) on delete restrict,
  device_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or length(revoke_reason) <= 120),
  check (expires_at > created_at)
);

create unique index app_sessions_one_active_session_per_device_key
  on public.app_sessions(device_user_id)
  where revoked_at is null;
create index app_sessions_account_active_idx
  on public.app_sessions(app_account_id)
  where revoked_at is null;

create or replace function private.set_app_account_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.revoke_app_account_sessions_on_security_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if old.is_active is distinct from new.is_active
    or old.pin_hash is distinct from new.pin_hash
    or old.role is distinct from new.role
    or old.store_id is distinct from new.store_id then
    v_reason := case
      when old.is_active and not new.is_active then 'account_deactivated'
      when old.pin_hash is distinct from new.pin_hash then 'pin_reset'
      when old.role is distinct from new.role then 'role_changed'
      else 'store_changed'
    end;

    update public.app_sessions
    set revoked_at = now(), revoke_reason = v_reason
    where app_account_id = new.id
      and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger app_accounts_set_audit_fields
before insert or update on public.app_accounts
for each row execute function private.set_app_account_audit_fields();

create trigger app_accounts_revoke_sessions_on_security_change
after update on public.app_accounts
for each row execute function private.revoke_app_account_sessions_on_security_change();

create or replace function private.assert_app_account_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo un administrador puede administrar usuarios operativos'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.assert_valid_app_account_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'El PIN debe tener exactamente 6 dígitos'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function private.assert_valid_app_account_fields(
  p_display_name text,
  p_username text,
  p_role text,
  p_store_id uuid,
  p_collaborator_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collaborator_store_id uuid;
begin
  if length(btrim(coalesce(p_display_name, ''))) not between 1 and 120 then
    raise exception 'El nombre del usuario no es válido' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_username, ''))) !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    or length(lower(btrim(coalesce(p_username, '')))) not between 1 and 60 then
    raise exception 'El username no es válido' using errcode = '22023';
  end if;
  if p_role not in ('cashier', 'store_manager') then
    raise exception 'El rol operativo no es válido' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.stores as store
    where store.id = p_store_id and store.status = 'active'
  ) then
    raise exception 'La tienda no existe o está inactiva' using errcode = 'P0002';
  end if;
  if p_collaborator_id is not null then
    select collaborator.store_id into v_collaborator_store_id
    from public.collaborators as collaborator
    where collaborator.id = p_collaborator_id;
    if v_collaborator_store_id is null then
      raise exception 'El colaborador relacionado no existe' using errcode = 'P0002';
    end if;
    if v_collaborator_store_id <> p_store_id then
      raise exception 'El colaborador relacionado pertenece a otra tienda'
        using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function public.list_app_accounts()
returns table (
  id uuid,
  username text,
  display_name text,
  role text,
  store_id uuid,
  store_name text,
  collaborator_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_app_account_admin();
  return query
  select account.id, account.username, account.display_name, account.role,
    account.store_id, store.name, account.collaborator_id, account.is_active,
    account.created_at, account.updated_at
  from public.app_accounts as account
  join public.stores as store on store.id = account.store_id
  order by account.display_name, account.username;
end;
$$;

create or replace function public.create_app_account(
  p_display_name text,
  p_username text,
  p_role text,
  p_store_id uuid,
  p_collaborator_id uuid,
  p_pin text
)
returns table (
  id uuid,
  username text,
  display_name text,
  role text,
  store_id uuid,
  store_name text,
  collaborator_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_app_account_admin();
  perform private.assert_valid_app_account_fields(
    p_display_name, p_username, p_role, p_store_id, p_collaborator_id
  );
  perform private.assert_valid_app_account_pin(p_pin);

  return query
  with inserted as (
    insert into public.app_accounts (
      username, display_name, role, store_id, collaborator_id, pin_hash,
      created_by, updated_by
    )
    values (
      lower(btrim(p_username)), btrim(p_display_name), p_role, p_store_id,
      p_collaborator_id, public.crypt(p_pin, public.gen_salt('bf', 12)),
      auth.uid(), auth.uid()
    )
    returning *
  )
  select account.id, account.username, account.display_name, account.role,
    account.store_id, store.name, account.collaborator_id, account.is_active,
    account.created_at, account.updated_at
  from inserted as account
  join public.stores as store on store.id = account.store_id;
end;
$$;

create or replace function public.update_app_account(
  p_id uuid,
  p_display_name text,
  p_username text,
  p_role text,
  p_store_id uuid,
  p_collaborator_id uuid
)
returns table (
  id uuid,
  username text,
  display_name text,
  role text,
  store_id uuid,
  store_name text,
  collaborator_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_app_account_admin();
  if p_id is null then
    raise exception 'El usuario operativo no es válido' using errcode = '22023';
  end if;
  perform private.assert_valid_app_account_fields(
    p_display_name, p_username, p_role, p_store_id, p_collaborator_id
  );

  return query
  with updated as (
    update public.app_accounts
    set username = lower(btrim(p_username)),
      display_name = btrim(p_display_name),
      role = p_role,
      store_id = p_store_id,
      collaborator_id = p_collaborator_id
    where app_accounts.id = p_id
    returning *
  )
  select account.id, account.username, account.display_name, account.role,
    account.store_id, store.name, account.collaborator_id, account.is_active,
    account.created_at, account.updated_at
  from updated as account
  join public.stores as store on store.id = account.store_id;

  if not found then
    raise exception 'El usuario operativo ya no existe' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_app_account_status(
  p_id uuid,
  p_is_active boolean
)
returns table (
  id uuid,
  username text,
  display_name text,
  role text,
  store_id uuid,
  store_name text,
  collaborator_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_app_account_admin();
  if p_id is null or p_is_active is null then
    raise exception 'El estado del usuario operativo no es válido' using errcode = '22023';
  end if;
  return query
  with updated as (
    update public.app_accounts
    set is_active = p_is_active
    where app_accounts.id = p_id
    returning *
  )
  select account.id, account.username, account.display_name, account.role,
    account.store_id, store.name, account.collaborator_id, account.is_active,
    account.created_at, account.updated_at
  from updated as account
  join public.stores as store on store.id = account.store_id;
  if not found then
    raise exception 'El usuario operativo ya no existe' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.reset_app_account_pin(p_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_app_account_admin();
  if p_id is null then
    raise exception 'El usuario operativo no es válido' using errcode = '22023';
  end if;
  perform private.assert_valid_app_account_pin(p_pin);
  update public.app_accounts
  set pin_hash = public.crypt(p_pin, public.gen_salt('bf', 12)),
    failed_attempts = 0,
    locked_until = null
  where id = p_id;
  if not found then
    raise exception 'El usuario operativo ya no existe' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.login_app_account(p_username text, p_pin text)
returns table (
  session_token text,
  account_id uuid,
  username text,
  display_name text,
  role text,
  store_id uuid,
  store_name text,
  collaborator_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_user_id uuid := auth.uid();
  v_technical_store_id uuid;
  v_account public.app_accounts;
  v_token text;
  v_token_hash bytea;
  v_expires_at timestamptz := now() + interval '12 hours';
  v_store_name text;
begin
  if v_device_user_id is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if private.is_admin() then
    raise exception 'La sesión técnica administrativa no puede iniciar un operador'
      using errcode = '42501';
  end if;
  select profile.store_id into v_technical_store_id
  from public.profiles as profile
  where profile.id = v_device_user_id;
  if v_technical_store_id is null then
    raise exception 'La sesión técnica no tiene una tienda asignada' using errcode = '42501';
  end if;

  select account.* into v_account
  from public.app_accounts as account
  where account.username = lower(btrim(coalesce(p_username, '')))
  for update;
  if not found or not v_account.is_active
    or v_account.store_id <> v_technical_store_id then
    raise exception 'Usuario o PIN incorrecto' using errcode = '28000';
  end if;
  if v_account.locked_until is not null and v_account.locked_until > now() then
    raise exception 'Usuario o PIN incorrecto' using errcode = '28000';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$'
    or public.crypt(p_pin, v_account.pin_hash) <> v_account.pin_hash then
    update public.app_accounts
    set failed_attempts = case
          when v_account.failed_attempts + 1 >= 5 then 5
          else v_account.failed_attempts + 1
        end,
        locked_until = case
          when v_account.failed_attempts + 1 >= 5 then now() + interval '15 minutes'
          else null
        end
    where id = v_account.id;
    raise exception 'Usuario o PIN incorrecto' using errcode = '28000';
  end if;

  update public.app_accounts
  set failed_attempts = 0, locked_until = null
  where id = v_account.id;
  update public.app_sessions
  set revoked_at = now(), revoke_reason = 'replaced_by_new_login'
  where device_user_id = v_device_user_id and revoked_at is null;

  v_token := replace(replace(replace(
    encode(public.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'
  ), '=', '');
  v_token_hash := public.digest(v_token, 'sha256');
  insert into public.app_sessions (
    app_account_id, device_user_id, token_hash, expires_at
  ) values (
    v_account.id, v_device_user_id, v_token_hash, v_expires_at
  );
  select store.name into v_store_name
  from public.stores as store where store.id = v_account.store_id;

  return query select v_token, v_account.id, v_account.username,
    v_account.display_name, v_account.role, v_account.store_id,
    v_store_name, v_account.collaborator_id, v_expires_at;
end;
$$;

create or replace function public.validate_app_session(p_session_token text)
returns table (
  account_id uuid,
  username text,
  display_name text,
  role text,
  store_id uuid,
  store_name text,
  collaborator_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_device_user_id is null or p_session_token is null
    or length(p_session_token) = 0 then
    raise exception 'Sesión operativa inválida' using errcode = '28000';
  end if;
  select session.id into v_session_id
  from public.app_sessions as session
  join public.app_accounts as account on account.id = session.app_account_id
  where session.token_hash = public.digest(p_session_token, 'sha256')
    and session.device_user_id = v_device_user_id
    and session.revoked_at is null
    and session.expires_at > now()
    and account.is_active;
  if v_session_id is null then
    raise exception 'Sesión operativa inválida' using errcode = '28000';
  end if;
  update public.app_sessions set last_seen_at = now() where id = v_session_id;
  return query
  select account.id, account.username, account.display_name, account.role,
    account.store_id, store.name, account.collaborator_id, session.expires_at
  from public.app_sessions as session
  join public.app_accounts as account on account.id = session.app_account_id
  join public.stores as store on store.id = account.store_id
  where session.id = v_session_id;
end;
$$;

create or replace function public.revoke_app_session(p_session_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_session_token is null or length(p_session_token) = 0 then
    raise exception 'Sesión operativa inválida' using errcode = '28000';
  end if;
  update public.app_sessions
  set revoked_at = now(), revoke_reason = 'operator_logout'
  where token_hash = public.digest(p_session_token, 'sha256')
    and device_user_id = auth.uid()
    and revoked_at is null;
end;
$$;

alter table public.app_accounts enable row level security;
alter table public.app_sessions enable row level security;

revoke all on public.app_accounts from public, anon, authenticated;
revoke all on public.app_sessions from public, anon, authenticated;

revoke all on function private.set_app_account_audit_fields() from public, anon, authenticated;
revoke all on function private.revoke_app_account_sessions_on_security_change() from public, anon, authenticated;
revoke all on function private.assert_app_account_admin() from public, anon, authenticated;
revoke all on function private.assert_valid_app_account_pin(text) from public, anon, authenticated;
revoke all on function private.assert_valid_app_account_fields(text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_app_accounts() from public, anon, authenticated;
revoke all on function public.create_app_account(text, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.update_app_account(uuid, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_app_account_status(uuid, boolean) from public, anon, authenticated;
revoke all on function public.reset_app_account_pin(uuid, text) from public, anon, authenticated;
revoke all on function public.login_app_account(text, text) from public, anon, authenticated;
revoke all on function public.validate_app_session(text) from public, anon, authenticated;
revoke all on function public.revoke_app_session(text) from public, anon, authenticated;

grant execute on function public.list_app_accounts() to authenticated;
grant execute on function public.create_app_account(text, text, text, uuid, uuid, text) to authenticated;
grant execute on function public.update_app_account(uuid, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.set_app_account_status(uuid, boolean) to authenticated;
grant execute on function public.reset_app_account_pin(uuid, text) to authenticated;
grant execute on function public.login_app_account(text, text) to authenticated;
grant execute on function public.validate_app_session(text) to authenticated;
grant execute on function public.revoke_app_session(text) to authenticated;

comment on table public.app_accounts is
  'Identidades operativas independientes de profiles; no concede permisos de dominio en esta fase.';
comment on table public.app_sessions is
  'Sesiones operativas vinculadas a la sesión técnica auth.uid(); conserva únicamente hashes de token.';
comment on function public.login_app_account(text, text) is
  'Valida username/PIN online y crea una sesión operativa opaca; no altera la autorización actual.';
