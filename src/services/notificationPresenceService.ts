import { OPERATIONS_NOTIFICATION_SOURCE_APP } from '../domain/models'
import { supabase } from '../lib/supabase'

export const NOTIFICATION_PRESENCE_STORAGE_KEY =
  'operaciones.notification-presence-id'
export const NOTIFICATION_PRESENCE_TTL_SECONDS = 90
export const NOTIFICATION_PRESENCE_HEARTBEAT_MS = 30_000

const PRESENCE_ID_PATTERN = /^[A-Za-z0-9-]{16,128}$/

type PresenceStorage = Pick<Storage, 'getItem' | 'setItem'>

function browserSessionStorage(): PresenceStorage | undefined {
  if (typeof window === 'undefined') return undefined

  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

function newPresenceId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID()
  }
  return `presence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function isNotificationPresenceId(
  value: string | null | undefined,
): value is string {
  return typeof value === 'string' && PRESENCE_ID_PATTERN.test(value)
}

export function getNotificationPresenceId(
  storage: PresenceStorage | undefined = browserSessionStorage(),
): string {
  if (storage) {
    try {
      const stored = storage.getItem(NOTIFICATION_PRESENCE_STORAGE_KEY)
      if (isNotificationPresenceId(stored)) return stored
    } catch {
      // A temporary storage failure should not prevent presence heartbeats.
    }
  }

  const generated = newPresenceId()
  if (storage) {
    try {
      storage.setItem(NOTIFICATION_PRESENCE_STORAGE_KEY, generated)
    } catch {
      // The in-memory id remains valid for this page session.
    }
  }
  return generated
}

export class NotificationPresenceService {
  private readonly storage: PresenceStorage | undefined
  private presenceIdValue: string | undefined

  constructor(storage: PresenceStorage | undefined = browserSessionStorage()) {
    this.storage = storage
  }

  private presenceId(): string {
    if (!this.presenceIdValue) {
      this.presenceIdValue = getNotificationPresenceId(this.storage)
    }
    return this.presenceIdValue
  }

  async heartbeat(): Promise<boolean> {
    if (!supabase) return false

    const { error } = await supabase.rpc('heartbeat_notification_presence', {
      p_presence_id: this.presenceId(),
      p_source_app: OPERATIONS_NOTIFICATION_SOURCE_APP,
    })
    if (error) throw error
    return true
  }

  async release(): Promise<boolean> {
    if (!supabase) return false

    const { data, error } = await supabase.rpc('release_notification_presence', {
      p_presence_id: this.presenceId(),
      p_source_app: OPERATIONS_NOTIFICATION_SOURCE_APP,
    })
    if (error) throw error
    return data ?? false
  }
}

export const notificationPresenceService = new NotificationPresenceService()
