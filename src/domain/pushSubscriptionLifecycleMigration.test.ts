import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608310002_push_subscription_lifecycle.sql',
    import.meta.url,
  ),
  'utf8',
)
const sql = migration.replace(/\s+/g, ' ')

describe('push subscription lifecycle migration', () => {
  it('adds an additive paused state without replacing revoked state', () => {
    expect(sql).toContain(
      'add column if not exists paused_at timestamptz',
    )
    expect(sql).toContain(
      'ACTIVE = revoked_at is null and paused_at is null',
    )
    expect(sql).toContain(
      'PAUSED = revoked_at is null and paused_at is not null',
    )
    expect(sql).toContain('REVOKED = revoked_at is not null')
  })

  it('derives ownership from auth and separates pause, resume and revoke', () => {
    expect(sql).toContain('v_user_id uuid := auth.uid()')
    expect(sql).not.toContain('p_auth_user_id')
    expect(sql).toContain('create or replace function public.pause_push_subscription(')
    expect(sql).toContain('create or replace function public.resume_push_subscription(')
    expect(sql).toContain('paused_at = now()')
    expect(sql).toContain('paused_at = null')
    expect(sql).toContain('revoked_at is null')
    expect(sql).toContain('grant execute on function public.pause_push_subscription(text) to authenticated')
    expect(sql).toContain('grant execute on function public.resume_push_subscription(text, text, text) to authenticated')
  })

  it('does not auto-insert or auto-revive revoked subscriptions silently', () => {
    expect(sql).toContain(
      'Reactivación silenciosa de login. No inserta ni transfiere filas',
    )
    expect(sql).toContain(
      'and auth_user_id = v_user_id and endpoint = v_endpoint and revoked_at is null',
    )
    expect(sql).toContain(
      'where public.push_subscriptions.auth_user_id = v_user_id returning id into v_subscription_id',
    )
  })

  it('keeps paused and revoked subscriptions out of deliveries', () => {
    expect(sql).toContain('subscription.paused_at is null')
    expect(sql).toContain('subscription.revoked_at is null')
    expect(sql).toContain('not private.notification_presence_is_active(')
    expect(sql).toContain(
      'create or replace function public.claim_notification_delivery(',
    )
    expect(sql).toContain(
      'and not exists ( select 1 from public.push_subscriptions as subscription',
    )
    expect(sql).toContain('private.notification_presence_is_active(')
  })
})
