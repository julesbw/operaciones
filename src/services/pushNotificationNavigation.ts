import type { NotificationEntityType } from '../domain/models'
import { OPERATIONS_NOTIFICATION_SOURCE_APP } from '../domain/models'

export type NotificationNavigation = {
  notificationId: string
  entityType: NotificationEntityType
  entityId: string
  source?: 'push' | 'in-app'
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ENTITY_TYPES: ReadonlySet<string> = new Set([
  'purchase',
  'merchandise_transfer',
  'cash_closing',
])

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isEntityType(value: unknown): value is NotificationEntityType {
  return typeof value === 'string' && ENTITY_TYPES.has(value)
}

export function isValidNotificationNavigation(
  value: unknown,
): value is NotificationNavigation {
  if (typeof value !== 'object' || value === null) return false
  if (!('notificationId' in value) || !('entityType' in value) || !('entityId' in value)) {
    return false
  }
  return (
    isUuid(value.notificationId) &&
    isEntityType(value.entityType) &&
    isUuid(value.entityId)
  )
}

export function navigationFromWorkerMessage(
  value: unknown,
): NotificationNavigation | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return undefined
  }
  if (value.type !== 'OPEN_NOTIFICATION' || !('target' in value)) {
    return undefined
  }
  const target = value.target
  if (typeof target !== 'object' || target === null) return undefined
  if (
    !('sourceApp' in target) ||
    target.sourceApp !== OPERATIONS_NOTIFICATION_SOURCE_APP
  ) {
    return undefined
  }
  if (!isValidNotificationNavigation(target)) return undefined
  return {
    notificationId: target.notificationId,
    entityType: target.entityType,
    entityId: target.entityId,
    source: 'push',
  }
}

export function navigationFromLocation(
  location: Pick<Location, 'search'> | URL,
): NotificationNavigation | undefined {
  const params = new URLSearchParams(location.search)
  const candidate = {
    notificationId: params.get('notificationId'),
    entityType: params.get('entityType'),
    entityId: params.get('entityId'),
  }
  return isValidNotificationNavigation(candidate)
    ? { ...candidate, source: 'push' }
    : undefined
}

export function clearNotificationQuery(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('notificationId')
  url.searchParams.delete('entityType')
  url.searchParams.delete('entityId')
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
