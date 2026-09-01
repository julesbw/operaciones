import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608310001_notification_presence.sql',
    import.meta.url,
  ),
  'utf8',
)
const sql = migration.replace(/\s+/g, ' ')

describe('notification presence migration', () => {
  it('stores short-lived presence per source app, admin and session', () => {
    expect(sql).toContain('create table public.notification_presence')
    expect(sql).toContain('last_active_at timestamptz')
    expect(sql).toContain('expires_at timestamptz')
    expect(sql).toContain(
      'unique (source_app, auth_user_id, presence_id)',
    )
    expect(sql).toContain("interval '90 seconds'")
    expect(sql).toContain(
      "source_app in ('operaciones', 'arrendamientos')",
    )
  })

  it('derives the user from auth and exposes only controlled heartbeat RPCs', () => {
    expect(sql).toContain('v_user_id uuid := auth.uid()')
    expect(sql).toContain('not private.is_admin()')
    expect(sql).not.toContain('p_auth_user_id')
    expect(sql).toContain(
      'grant execute on function public.heartbeat_notification_presence(text, text) to authenticated',
    )
    expect(sql).toContain(
      'grant execute on function public.release_notification_presence(text, text) to authenticated',
    )
    expect(sql).toContain(
      'revoke all on public.notification_presence from public, anon, authenticated',
    )
  })

  it('fails open for Push and abandons deliveries already read in-app', () => {
    expect(sql).toContain('private.notification_presence_is_active(')
    expect(sql).toContain("delivery.status in ('pending', 'failed')")
    expect(sql).toContain("last_error = 'notification_read'")
    expect(sql).toContain(
      'and not exists ( select 1 from public.push_subscriptions as subscription',
    )
    expect(sql).toContain('presence.expires_at > now()')
    expect(sql).toContain('exception when others then')
    expect(sql).toContain('-- Presence is an optimization. A read/query failure must preserve Push.')
    expect(sql).toContain('return false')
  })
})
