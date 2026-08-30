export const OPERATIONS_SOURCE_APP = 'operaciones' as const

export const PUSH_EVENT_ENTITIES = {
  PURCHASE_CREATED: 'purchase',
  TRANSFER_CREATED: 'merchandise_transfer',
  CASH_CLOSING_CLOSED: 'cash_closing',
} as const

export type PushEventType = keyof typeof PUSH_EVENT_ENTITIES
export type PushEntityType = (typeof PUSH_EVENT_ENTITIES)[PushEventType]

export type PersistedPushNotification = {
  notificationId: string
  sourceApp: string
  eventType: string
  entityType: string
  entityId: string
  title: string
  storeName?: string | null
  originStoreName?: string | null
  destinationStoreName?: string | null
  amount?: number | null
  cashToWithdraw?: number | null
}

export type WebPushPayload = {
  notificationId: string
  sourceApp: typeof OPERATIONS_SOURCE_APP
  eventType: PushEventType
  entityType: PushEntityType
  entityId: string
  title: string
  body: string
}

function compactLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  return (normalized || fallback).slice(0, 96)
}

function money(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('push_amount_missing')
  }
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function buildWebPushPayload(
  notification: PersistedPushNotification,
): WebPushPayload {
  const expectedEntityType =
    PUSH_EVENT_ENTITIES[notification.eventType as PushEventType]
  if (
    notification.sourceApp !== OPERATIONS_SOURCE_APP ||
    !expectedEntityType ||
    notification.entityType !== expectedEntityType ||
    !notification.notificationId ||
    !notification.entityId
  ) {
    throw new Error('push_notification_invalid')
  }

  const title = notification.title.trim().slice(0, 160)
  if (!title) throw new Error('push_title_missing')

  let body: string
  if (notification.eventType === 'PURCHASE_CREATED') {
    body = `${compactLabel(notification.storeName, 'Caja Central')} · ${money(notification.amount)}`
  } else if (notification.eventType === 'TRANSFER_CREATED') {
    body = `${compactLabel(notification.originStoreName, 'Tienda de origen')} → ${compactLabel(notification.destinationStoreName, 'Tienda de destino')} · ${money(notification.amount)}`
  } else {
    body = `${compactLabel(notification.storeName, 'Tienda')} · Efectivo a retirar ${money(notification.cashToWithdraw)}`
  }

  return {
    notificationId: notification.notificationId,
    sourceApp: OPERATIONS_SOURCE_APP,
    eventType: notification.eventType as PushEventType,
    entityType: expectedEntityType,
    entityId: notification.entityId,
    title,
    body: body.slice(0, 500),
  }
}
