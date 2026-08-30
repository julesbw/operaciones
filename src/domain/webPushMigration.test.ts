import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/202608290003_web_push.sql', import.meta.url),
  'utf8',
)
const sql = migration.replace(/\s+/g, ' ')

describe('web push migration', () => {
  it('creates isolated subscriptions and idempotent delivery rows', () => {
    expect(sql).toContain('create table public.push_subscriptions')
    expect(sql).toContain('unique (source_app, endpoint)')
    expect(sql).toContain('create table public.notification_deliveries')
    expect(sql).toContain(
      'unique (notification_id, subscription_id, channel)',
    )
    expect(sql).toContain("status in ('pending', 'processing', 'delivered', 'failed', 'abandoned')")
    expect(sql).toContain('on conflict (notification_id, subscription_id, channel) do nothing')
  })

  it('projects only Operations notifications and keeps client tables private', () => {
    expect(sql).toContain("notification.source_app = 'operaciones'")
    expect(sql).toContain('alter table public.push_subscriptions enable row level security')
    expect(sql).toContain('alter table public.notification_deliveries enable row level security')
    expect(sql).toContain(
      'revoke all on public.push_subscriptions from public, anon, authenticated',
    )
    expect(sql).toContain(
      'revoke all on public.notification_deliveries from public, anon, authenticated',
    )
    expect(sql).toContain('v_user_id is null or not private.is_admin()')
  })

  it('does not trust an auth user id supplied by the browser', () => {
    expect(sql).toContain('v_user_id uuid := auth.uid()')
    expect(sql).not.toContain('p_auth_user_id')
    expect(sql).toContain("source_app = 'operaciones'")
  })

  it('protects claim and delivery transitions for the internal service role', () => {
    expect(sql).toContain("if auth.role() <> 'service_role' then")
    expect(sql).toContain("status = 'processing'")
    expect(sql).toContain("attempt_count < 5")
    expect(sql).toContain("status = 'delivered'")
    expect(sql).toContain("status = case")
    expect(sql).toContain(
      'grant execute on function public.claim_notification_delivery(uuid) to service_role',
    )
  })
})
