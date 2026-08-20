import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608200001_app_accounts_and_sessions.sql',
    import.meta.url,
  ),
  'utf8',
)
const pgcryptoCompatibilityMigration = readFileSync(
  new URL(
    '../../supabase/migrations/202608200002_app_account_pgcrypto_schema_compatibility.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('App account migration', () => {
  it('keeps operational identities separate from profiles and existing roles', () => {
    expect(migration).toContain('create table public.app_accounts')
    expect(migration).toContain("role in ('cashier', 'store_manager')")
    expect(migration).not.toContain('alter table public.profiles')
  })

  it('normalizes usernames and stores only PIN hashes', () => {
    expect(migration).toContain('app_accounts_normalized_username_key')
    expect(migration).toContain("username = lower(btrim(username))")
    expect(migration).toContain("p_pin !~ '^[0-9]{6}$'")
    expect(migration).toContain("public.crypt(p_pin, public.gen_salt('bf', 12))")
    expect(migration).not.toMatch(/\n\s+pin\s+text\s+/i)
  })

  it('restricts operator login to the technical device and its store', () => {
    expect(migration).toContain('if private.is_admin() then')
    expect(migration).toContain('v_account.store_id <> v_technical_store_id')
    expect(migration).toContain('device_user_id = v_device_user_id')
  })

  it('enforces brute-force protection, expiration, hashing and revocation', () => {
    expect(migration).toContain("now() + interval '15 minutes'")
    expect(migration).toContain('v_account.failed_attempts + 1 >= 5')
    expect(migration).toContain("now() + interval '12 hours'")
    expect(migration).toContain("public.digest(v_token, 'sha256')")
    expect(migration).toContain('app_sessions_one_active_session_per_device_key')
    expect(migration).toContain('app_accounts_revoke_sessions_on_security_change')
  })

  it('allows access only through controlled RPCs', () => {
    expect(migration).toContain('alter table public.app_accounts enable row level security')
    expect(migration).toContain('alter table public.app_sessions enable row level security')
    expect(migration).toContain('revoke all on public.app_accounts from public, anon, authenticated')
    expect(migration).toContain('revoke all on public.app_sessions from public, anon, authenticated')
    expect(migration).toContain('grant execute on function public.login_app_account(text, text) to authenticated')
  })

  it('uses the Supabase pgcrypto extension schema without granting client access', () => {
    expect(pgcryptoCompatibilityMigration).toContain('extensions.gen_salt')
    expect(pgcryptoCompatibilityMigration).toContain('extensions.crypt')
    expect(pgcryptoCompatibilityMigration).toContain('extensions.gen_random_bytes')
    expect(pgcryptoCompatibilityMigration).toContain('extensions.digest')
    expect(pgcryptoCompatibilityMigration).toContain(
      'revoke all on function public.crypt(text, text) from public, anon, authenticated',
    )
  })
})
