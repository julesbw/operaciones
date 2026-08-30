import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608290002_notification_source_app_isolation.sql',
    import.meta.url,
  ),
  'utf8',
)
const service = readFileSync(
  new URL('../services/notificationService.ts', import.meta.url),
  'utf8',
)
const sql = migration.replace(/\s+/g, ' ')

describe('notification source-app isolation migration', () => {
  it('backfills existing notifications before requiring a valid source app', () => {
    const addColumn = migration.indexOf('add column source_app text')
    const backfill = migration.indexOf("set source_app = 'operaciones'")
    const setNotNull = migration.indexOf('alter column source_app set not null')

    expect(addColumn).toBeGreaterThanOrEqual(0)
    expect(backfill).toBeGreaterThan(addColumn)
    expect(setNotNull).toBeGreaterThan(backfill)
    expect(sql).toContain(
      "source_app in ('operaciones', 'arrendamientos')",
    )
  })

  it('isolates idempotency by application', () => {
    expect(sql).toContain(
      'unique (source_app, event_type, entity_id)',
    )
    expect(sql).toContain(
      'on conflict (source_app, event_type, entity_id) do nothing',
    )
    expect(sql).toContain('notification.source_app = v_source_app')
    expect(sql).toContain('drop constraint notifications_event_entity_key')
  })

  it('removes the global operation event catalog from the shared table', () => {
    expect(sql).toContain('drop constraint notifications_event_type_check')
    expect(sql).toContain('drop constraint notifications_entity_type_check')
    expect(sql).toContain('drop constraint notifications_event_entity_check')
    expect(sql).toContain('notifications_event_type_format_check')
    expect(sql).toContain('notifications_entity_type_format_check')
  })

  it('keeps operation producers explicit and global admins as recipients', () => {
    expect(migration.match(/perform private\.create_notification\(\n    'operaciones'/g))
      .toHaveLength(3)
    expect(sql).toContain("where profile.role = 'admin'")
    expect(sql).toContain('auth_user.deleted_at is null')
  })

  it('replaces unscoped RPCs and filters every read mutation by source app', () => {
    const rpcSql = migration.slice(
      migration.indexOf('create function public.list_notifications'),
    )

    for (const oldSignature of [
      'public.list_notifications(integer)',
      'public.count_unread_notifications()',
      'public.mark_notification_read(uuid)',
      'public.mark_all_notifications_read()',
    ]) {
      expect(sql).toContain(`drop function ${oldSignature}`)
    }

    for (const newSignature of [
      'public.list_notifications(text, integer)',
      'public.count_unread_notifications(text)',
      'public.mark_notification_read(text, uuid)',
      'public.mark_all_notifications_read(text)',
    ]) {
      expect(sql).toContain(
        `grant execute on function ${newSignature} to authenticated`,
      )
    }

    expect(rpcSql.match(/notification\.source_app = v_source_app/g))
      .toHaveLength(4)
  })

  it('keeps deployed Operaciones clients isolated during rollout', () => {
    expect(sql).toContain(
      "from public.list_notifications('operaciones', p_limit)",
    )
    expect(sql).toContain(
      "select public.count_unread_notifications('operaciones')",
    )
    expect(sql).toContain(
      "select public.mark_notification_read('operaciones', p_notification_id)",
    )
    expect(sql).toContain(
      "select public.mark_all_notifications_read('operaciones')",
    )
  })

  it('validates source app in the backend and fixes Operaciones in the client', () => {
    expect(sql).toContain(
      'private.require_notification_source_app(p_source_app)',
    )
    expect(sql).toContain(
      'revoke all on function private.require_notification_source_app(text)',
    )
    expect(service).toContain('OPERATIONS_NOTIFICATION_SOURCE_APP')
    expect(service.match(/p_source_app: OPERATIONS_NOTIFICATION_SOURCE_APP/g))
      .toHaveLength(4)
  })
})
