export const OPERATIONS_SOURCE_APP = 'operaciones' as const
export const ARRENDAMIENTOS_SOURCE_APP = 'arrendamientos' as const

export const PUSH_EVENT_ENTITIES = {
  PURCHASE_CREATED: {
    sourceApp: OPERATIONS_SOURCE_APP,
    entityType: 'purchase',
  },
  TRANSFER_CREATED: {
    sourceApp: OPERATIONS_SOURCE_APP,
    entityType: 'merchandise_transfer',
  },
  CASH_CLOSING_CLOSED: {
    sourceApp: OPERATIONS_SOURCE_APP,
    entityType: 'cash_closing',
  },
  PAYMENT_REGISTERED: {
    sourceApp: ARRENDAMIENTOS_SOURCE_APP,
    entityType: 'payment',
  },
} as const

export type PushEventType = keyof typeof PUSH_EVENT_ENTITIES
export type PushEntityType =
  (typeof PUSH_EVENT_ENTITIES)[PushEventType]['entityType']
export type PushSourceApp =
  (typeof PUSH_EVENT_ENTITIES)[PushEventType]['sourceApp']

export type PersistedPushNotification = {
  notificationId: string
  sourceApp: string
  eventType: string
  entityType: string
  entityId: string
  title: string
  message?: string | null
  storeName?: string | null
  originStoreName?: string | null
  destinationStoreName?: string | null
  amount?: number | null
  cashToWithdraw?: number | null
}

export type WebPushPayload = {
  notificationId: string
  sourceApp: PushSourceApp
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

function compactMessage(value: string | null | undefined): string {
  return value?.trim().slice(0, 500) ?? ''
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
  const expected = PUSH_EVENT_ENTITIES[notification.eventType as PushEventType]
  if (
    !expected ||
    notification.sourceApp !== expected.sourceApp ||
    notification.entityType !== expected.entityType ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notification.notificationId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notification.entityId)
  ) {
    throw new Error('push_notification_invalid')
  }

  const title = notification.title.trim()
  if (!title) throw new Error('push_title_missing')
  if (title.length > 160) throw new Error('push_title_invalid')

  let body: string
  if (notification.eventType === 'PAYMENT_REGISTERED') {
    body = compactMessage(notification.message)
    if (!body) throw new Error('push_message_missing')
  } else if (notification.eventType === 'PURCHASE_CREATED') {
    body = `${compactLabel(notification.storeName, 'Caja Central')} · ${money(notification.amount)}`
  } else if (notification.eventType === 'TRANSFER_CREATED') {
    body = `${compactLabel(notification.originStoreName, 'Tienda de origen')} → ${compactLabel(notification.destinationStoreName, 'Tienda de destino')} · ${money(notification.amount)}`
  } else {
    body = `${compactLabel(notification.storeName, 'Tienda')} · Efectivo a retirar ${money(notification.cashToWithdraw)}`
  }

  return {
    notificationId: notification.notificationId,
    sourceApp: expected.sourceApp,
    eventType: notification.eventType as PushEventType,
    entityType: expected.entityType,
    entityId: notification.entityId,
    title,
    body: body.slice(0, 500),
  }
}
