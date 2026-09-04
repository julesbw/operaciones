import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202609040001_shared_notifications.sql',
    import.meta.url,
  ),
  'utf8',
)
const sql = migration.replace(/\s+/g, ' ')

describe('migración compartida de notificaciones', () => {
  it('expone las cuatro operaciones Push con source_app y conserva wrappers de Operaciones', () => {
    for (const signature of [
      'public.register_push_subscription( p_source_app text, p_endpoint text, p_p256dh text, p_auth text',
      'public.pause_push_subscription( p_source_app text, p_endpoint text',
      'public.resume_push_subscription( p_source_app text, p_endpoint text, p_p256dh text, p_auth text',
      'public.revoke_push_subscription( p_source_app text, p_endpoint text',
    ]) {
      expect(sql).toContain(`create or replace function ${signature}`)
    }
    expect(sql).toContain(
      "select public.register_push_subscription( 'operaciones', p_endpoint, p_p256dh, p_auth )",
    )
    expect(sql).toContain(
      "select public.pause_push_subscription('operaciones', p_endpoint)",
    )
    expect(sql).toContain(
      "select public.resume_push_subscription( 'operaciones', p_endpoint, p_p256dh, p_auth )",
    )
    expect(sql).toContain(
      "select public.revoke_push_subscription('operaciones', p_endpoint)",
    )
  })

  it('permite ambos contratos pero no mezcla la fuente de la notificación', () => {
    expect(sql).toContain(
      "event_type = 'PAYMENT_REGISTERED' and entity_type = 'payment'",
    )
    expect(sql).toContain('subscription.source_app = notification.source_app')
    expect(sql).toContain('subscription.source_app = delivery.source_app')
    expect(sql).toContain('notification.source_app = delivery.source_app')
    expect(sql).not.toContain("where notification.source_app = 'operaciones'")
    expect(sql).not.toContain("and delivery.source_app = 'operaciones'")
  })

  it('mantiene lectura, pausa, presencia, reintentos y scheduler aislados', () => {
    expect(sql).toContain('subscription.paused_at is null')
    expect(sql).toContain('subscription.revoked_at is null')
    expect(sql).toContain("last_error = 'notification_read'")
    expect(sql).toContain('attempt_count < 5')
    expect(sql).toContain("select cron.unschedule('web-push-retry')")
    expect(sql).toContain("status in ('pending', 'failed')")
    expect(sql).toContain('limit 50')
  })
})
