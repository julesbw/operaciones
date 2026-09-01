import type { InAppNotification } from '../domain/models'

export const NOTIFICATION_GROUPS = [
  { key: 'today', label: 'Hoy' },
  { key: 'yesterday', label: 'Ayer' },
  { key: 'this-week', label: 'Esta semana' },
  { key: 'older', label: 'Anteriores' },
] as const

export type NotificationGroupKey = (typeof NOTIFICATION_GROUPS)[number]['key']

export type NotificationGroup<T extends Pick<InAppNotification, 'createdAt'>> = {
  key: NotificationGroupKey
  label: string
  notifications: T[]
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  const daysSinceMonday = (day.getDay() + 6) % 7
  day.setDate(day.getDate() - daysSinceMonday)
  return day
}

function groupKey(createdAt: string, now: Date): NotificationGroupKey {
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return 'older'

  const createdDay = startOfDay(created)
  const today = startOfDay(now)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (createdDay.getTime() === today.getTime()) return 'today'
  if (createdDay.getTime() === yesterday.getTime()) return 'yesterday'
  if (createdDay >= startOfWeek(today) && createdDay < yesterday) {
    return 'this-week'
  }
  return 'older'
}

export function sortNotifications<T extends Pick<InAppNotification, 'createdAt'>>(
  notifications: readonly T[],
): T[] {
  return notifications.reduce<T[]>((ordered, notification) => {
    const notificationTime = Date.parse(notification.createdAt)
    const index = ordered.findIndex((current) => {
      const currentTime = Date.parse(current.createdAt)
      if (!Number.isFinite(notificationTime) || !Number.isFinite(currentTime)) {
        return false
      }
      return notificationTime > currentTime
    })
    if (index === -1) {
      ordered.push(notification)
      return ordered
    }
    ordered.splice(index, 0, notification)
    return ordered
  }, [])
}

export function groupNotifications<T extends Pick<InAppNotification, 'createdAt'>>(
  notifications: readonly T[],
  now = new Date(),
): NotificationGroup<T>[] {
  const grouped = new Map<NotificationGroupKey, T[]>()
  for (const notification of notifications) {
    const key = groupKey(notification.createdAt, now)
    const current = grouped.get(key) ?? []
    current.push(notification)
    grouped.set(key, current)
  }

  return NOTIFICATION_GROUPS
    .filter(({ key }) => grouped.has(key))
    .map(({ key, label }) => ({
      key,
      label,
      notifications: grouped.get(key) ?? [],
    }))
}
