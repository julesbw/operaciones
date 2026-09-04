import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  InAppNotification,
  NotificationEntityType,
} from '../domain/models'
import { notificationService } from '../services/notificationService'
import type { NotificationNavigation } from '../services/pushNotificationNavigation'
import {
  groupNotifications,
  sortNotifications,
} from '../utils/notificationGrouping'
import { AppModal } from './AppModal'
import { BellIcon, CheckIcon, SyncIcon } from './icons'

export type { NotificationNavigation } from '../services/pushNotificationNavigation'

type NotificationCenterProps = {
  activePage?: string
  enabled: boolean
  networkAvailable: boolean
  refreshKey?: number
  onOpenEntity: (navigation: NotificationNavigation) => void
}

function notificationDate(value: string): string {
  return new Date(value).toLocaleString('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function entityLabel(entityType: NotificationEntityType): string {
  if (entityType === 'purchase') return 'Compra'
  if (entityType === 'merchandise_transfer') return 'Transferencia'
  if (entityType === 'payment') return 'Pago'
  return 'Corte'
}

function unreadLabel(count: number): string {
  return `${count} notificación${count === 1 ? '' : 'es'} sin leer`
}

export function shouldShowUnreadBadge(count: number): boolean {
  return count > 0
}

export function unreadBadgeLabel(count: number): string | number {
  return count > 9 ? '9+' : count
}

function withReadAt(
  notification: InAppNotification,
  readAt: string,
): InAppNotification {
  return { ...notification, readAt: notification.readAt ?? readAt }
}

type LoadOptions = {
  showLoading?: boolean
}

const NOTIFICATION_POLL_INTERVAL_MS = 15_000

export function NotificationCenter({
  activePage,
  enabled,
  networkAvailable,
  refreshKey = 0,
  onOpenEntity,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionId, setActionId] = useState<string>()
  const [markingAll, setMarkingAll] = useState(false)
  const bellRef = useRef<HTMLButtonElement>(null)
  const requestIdRef = useRef(0)
  const loadingRequestIdRef = useRef<number | undefined>(undefined)
  const optimisticReadAtRef = useRef(new Map<string, string>())
  const optimisticMarkAllRef = useRef<string | undefined>(undefined)
  const hasUnread = shouldShowUnreadBadge(unreadCount)

  const load = useCallback(async ({ showLoading = false }: LoadOptions = {}) => {
    if (!enabled || !networkAvailable) return
    const requestId = ++requestIdRef.current
    if (showLoading) {
      loadingRequestIdRef.current = requestId
      setLoading(true)
    } else if (loadingRequestIdRef.current !== undefined) {
      loadingRequestIdRef.current = undefined
      setLoading(false)
    }
    setError('')
    try {
      const result = await notificationService.load()
      if (requestId !== requestIdRef.current) return
      const optimisticReads = optimisticReadAtRef.current
      const markAllOptimistic = optimisticMarkAllRef.current !== undefined
      const loadedNotifications = sortNotifications(result.notifications).map((item) => {
        const optimisticReadAt = optimisticReads.get(item.id)
        if (markAllOptimistic || (optimisticReadAt && !item.readAt)) {
          return withReadAt(item, optimisticReadAt ?? new Date().toISOString())
        }
        return item
      })
      const optimisticUnreadCount = markAllOptimistic
        ? 0
        : Math.max(0, result.unreadCount - optimisticReads.size)
      setNotifications(loadedNotifications)
      setUnreadCount(optimisticUnreadCount)
    } catch (cause: unknown) {
      if (requestId !== requestIdRef.current) return
      console.error('No fue posible consultar las notificaciones', cause)
      setError('No fue posible consultar las notificaciones.')
    } finally {
      if (loadingRequestIdRef.current === requestId) {
        loadingRequestIdRef.current = undefined
        setLoading(false)
      }
    }
  }, [enabled, networkAvailable])

  useEffect(() => {
    if (enabled && networkAvailable) void load()
  }, [enabled, networkAvailable, refreshKey, load])

  useEffect(() => {
    if (
      !enabled ||
      !networkAvailable ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const interval = window.setInterval(
      refreshIfVisible,
      NOTIFICATION_POLL_INTERVAL_MS,
    )
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
    }
  }, [enabled, networkAvailable, load])

  useEffect(() => {
    setOpen(false)
  }, [activePage])

  async function markAsRead(notification: InAppNotification): Promise<void> {
    if (notification.readAt || actionId) return
    if (!networkAvailable) {
      setError('Conéctate para marcar notificaciones como leídas.')
      return
    }

    const readAt = new Date().toISOString()
    setActionId(notification.id)
    optimisticReadAtRef.current.set(notification.id, readAt)
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, readAt } : item,
      ),
    )
    setUnreadCount((current) => Math.max(0, current - 1))
    try {
      const updated = await notificationService.markRead(notification.id)
      if (!updated) throw new Error('La notificación no está asignada al usuario.')
      optimisticReadAtRef.current.delete(notification.id)
    } catch (cause: unknown) {
      console.error('No fue posible marcar la notificación como leída', cause)
      optimisticReadAtRef.current.delete(notification.id)
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, readAt: null } : item,
        ),
      )
      setUnreadCount((current) => current + 1)
      setError('No fue posible marcar la notificación como leída.')
    } finally {
      setActionId(undefined)
    }
  }

  async function markAllAsRead(): Promise<void> {
    if (markingAll || unreadCount === 0) return
    if (!networkAvailable) {
      setError('Conéctate para marcar notificaciones como leídas.')
      return
    }

    const previous = notifications
    const previousUnreadCount = unreadCount
    const readAt = new Date().toISOString()
    setMarkingAll(true)
    optimisticMarkAllRef.current = readAt
    setNotifications((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
    )
    setUnreadCount(0)
    try {
      await notificationService.markAllRead()
      optimisticMarkAllRef.current = undefined
    } catch (cause: unknown) {
      console.error('No fue posible marcar todas las notificaciones como leídas', cause)
      optimisticMarkAllRef.current = undefined
      setNotifications(previous)
      setUnreadCount(previousUnreadCount)
      setError('No fue posible marcar las notificaciones como leídas.')
    } finally {
      setMarkingAll(false)
    }
  }

  async function openNotification(notification: InAppNotification): Promise<void> {
    await markAsRead(notification)
    setOpen(false)
    onOpenEntity({
      notificationId: notification.id,
      entityType: notification.entityType,
      entityId: notification.entityId,
      source: 'in-app',
    })
  }

  if (!enabled) return null

  return (
    <>
      <button
        aria-label={hasUnread ? unreadLabel(unreadCount) : 'Notificaciones'}
        className="icon-button relative"
        ref={bellRef}
        type="button"
        onClick={() => {
          setOpen(true)
          if (networkAvailable) void load()
        }}
      >
        <BellIcon className="size-5" />
        {hasUnread && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black leading-5 text-on-primary ring-2 ring-white"
          >
            {unreadBadgeLabel(unreadCount)}
          </span>
        )}
      </button>

      <AppModal
        cardClassName="notification-modal-card"
        closeLabel="Cerrar notificaciones"
        headerContent={
          <>
            {!networkAvailable && (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900">
                Sin conexión. Sólo se muestran las notificaciones cargadas en esta sesión.
              </p>
            )}
            {error && <p className="alert-error mt-3" role="alert">{error}</p>}

            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                Actividad reciente
              </p>
              {hasUnread && (
                <button
                  className="text-action text-xs"
                  disabled={markingAll || !networkAvailable}
                  type="button"
                  onClick={() => void markAllAsRead()}
                >
                  {markingAll ? 'Marcando…' : 'Marcar todas como leídas'}
                </button>
              )}
            </div>
          </>
        }
        open={open}
        overlayClassName="notification-modal-overlay"
        returnFocusRef={bellRef}
        scrollableContent
        title="Notificaciones"
        onClose={() => setOpen(false)}
      >
        <div className="min-h-0">
          {loading && (
            <div className="empty-state flex items-center justify-center gap-2">
              <SyncIcon className="size-4 animate-spin" /> Consultando…
            </div>
          )}
          {!loading && notifications.length === 0 && (
            <div className="empty-state px-2 py-10">
              <BellIcon className="mx-auto mb-3 size-8" />
              <p>
                {networkAvailable
                  ? 'No tienes notificaciones nuevas.'
                  : 'Conéctate para consultar tus notificaciones.'}
              </p>
            </div>
          )}
          {!loading && notifications.length > 0 && (
            <div className="notification-list mt-3 overflow-hidden rounded-2xl border border-slate-200">
              {groupNotifications(notifications).map((group) => (
                <section className="notification-group" key={group.key}>
                  <h3 className="notification-group-heading">{group.label}</h3>
                  <ul className="divide-y divide-slate-100">
                    {group.notifications.map((notification) => (
                      <li
                        className={notification.readAt
                          ? 'notification-item notification-item-read'
                          : 'notification-item notification-item-unread'}
                        key={notification.id}
                      >
                        <div className="p-4">
                          <button
                            className="w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                            type="button"
                            onClick={() => void openNotification(notification)}
                          >
                            <span className="flex items-start gap-2">
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span
                                    className={notification.readAt
                                      ? 'notification-title-read truncate'
                                      : 'notification-title-unread truncate'}
                                  >
                                    {notification.title}
                                  </span>
                                  {!notification.readAt && (
                                    <span
                                      aria-label="No leída"
                                      className="notification-unread-indicator"
                                    />
                                  )}
                                </span>
                                <span className="mt-2 block whitespace-pre-line text-sm leading-6 text-slate-700">
                                  {notification.message}
                                </span>
                                <span className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-bold text-slate-400">
                                  <span>{entityLabel(notification.entityType)}</span>
                                  <time dateTime={notification.createdAt}>
                                    {notificationDate(notification.createdAt)}
                                  </time>
                                </span>
                              </span>
                              <span className="shrink-0 text-slate-400">›</span>
                            </span>
                          </button>
                          {!notification.readAt && (
                            <button
                              className="mt-3 inline-flex items-center gap-1 text-xs font-extrabold text-teal-700 hover:text-teal-900"
                              disabled={actionId === notification.id || !networkAvailable}
                              type="button"
                              onClick={() => void markAsRead(notification)}
                            >
                              {actionId === notification.id ? (
                                <SyncIcon className="size-3 animate-spin" />
                              ) : (
                                <CheckIcon className="size-3" />
                              )}
                              Marcar como leída
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </AppModal>
    </>
  )
}
