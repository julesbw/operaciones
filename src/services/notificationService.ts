import {
  OPERATIONS_NOTIFICATION_SOURCE_APP,
  type InAppNotification,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import type { NotificationRow } from '../types/database'

function mapNotification(row: NotificationRow): InAppNotification {
  return {
    id: row.id,
    sourceApp: row.source_app,
    eventType: row.event_type,
    title: row.title,
    message: row.message,
    storeId: row.store_id,
    storeName: row.store_name,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorOperatorAccountId: row.actor_operator_account_id,
    actorAuthUserId: row.actor_auth_user_id,
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

class NotificationService {
  async load(limit = 50): Promise<{
    notifications: InAppNotification[]
    unreadCount: number
  }> {
    if (!supabase) return { notifications: [], unreadCount: 0 }

    const [listResult, countResult] = await Promise.all([
      supabase.rpc('list_notifications', {
        p_source_app: OPERATIONS_NOTIFICATION_SOURCE_APP,
        p_limit: limit,
      }),
      supabase.rpc('count_unread_notifications', {
        p_source_app: OPERATIONS_NOTIFICATION_SOURCE_APP,
      }),
    ])
    if (listResult.error) throw listResult.error
    if (countResult.error) throw countResult.error

    return {
      notifications: (listResult.data ?? []).map(mapNotification),
      unreadCount: countResult.data ?? 0,
    }
  }

  async markRead(notificationId: string): Promise<boolean> {
    if (!supabase) return false
    const { data, error } = await supabase.rpc('mark_notification_read', {
      p_source_app: OPERATIONS_NOTIFICATION_SOURCE_APP,
      p_notification_id: notificationId,
    })
    if (error) throw error
    return data
  }

  async markAllRead(): Promise<number> {
    if (!supabase) return 0
    const { data, error } = await supabase.rpc('mark_all_notifications_read', {
      p_source_app: OPERATIONS_NOTIFICATION_SOURCE_APP,
    })
    if (error) throw error
    return data
  }
}

export const notificationService = new NotificationService()
