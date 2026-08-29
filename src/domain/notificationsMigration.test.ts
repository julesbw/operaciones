import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608290001_notifications.sql',
    import.meta.url,
  ),
  'utf8',
)
const sql = migration.replace(/\s+/g, ' ')

describe('notifications migration', () => {
  it('models the three backend events with per-recipient read state', () => {
    expect(migration).toContain('create table public.notifications')
    expect(migration).toContain('create table public.notification_recipients')
    expect(migration).toContain(
      "constraint notifications_event_entity_key unique (event_type, entity_id)",
    )
    expect(sql).toContain(
      "recipient_type in ('auth_user', 'app_account')",
    )
    expect(migration).toContain('read_at timestamptz')
  })

  it('creates notifications only from accepted remote operation inserts', () => {
    expect(sql).toContain(
      'after insert on public.purchase_payments',
    )
    expect(sql).toContain(
      'after insert on public.merchandise_transfers',
    )
    expect(sql).toContain(
      'after insert on public.cash_closings',
    )
    expect(sql).toContain(
      'on conflict (event_type, entity_id) do nothing',
    )
  })

  it('uses server-side identities and active admins as recipients', () => {
    expect(migration).toContain('created_by_operator_account_id')
    expect(migration).toContain('closed_by_operator_account_id')
    expect(sql).toContain("where profile.role = 'admin'")
    expect(sql).toContain('auth_user.deleted_at is null')
    expect(sql).toContain("'auth_user'")
  })

  it('keeps notification data behind controlled security-definer RPCs', () => {
    expect(sql).toContain('alter table public.notifications enable row level security')
    expect(sql).toContain(
      'revoke all on public.notifications from public, anon, authenticated',
    )
    expect(sql).toContain(
      'revoke all on public.notification_recipients from public, anon, authenticated',
    )
    for (const functionName of [
      'public.list_notifications(integer)',
      'public.count_unread_notifications()',
      'public.mark_notification_read(uuid)',
      'public.mark_all_notifications_read()',
    ]) {
      expect(sql).toContain(`grant execute on function ${functionName} to authenticated`)
    }
    for (const functionName of [
      'private.notifications_after_purchase_payment()',
      'private.notifications_after_merchandise_transfer()',
      'private.notifications_after_cash_closing()',
    ]) {
      expect(sql).toContain(
        `revoke all on function ${functionName} from public, anon, authenticated`,
      )
    }
    expect(migration).toContain('set search_path = \'\'')
  })
})
