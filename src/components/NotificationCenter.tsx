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
  return 'Corte'
}

function unreadLabel(count: number): string {
  return `${count} notificación${count === 1 ? '' : 'es'} sin leer`
}

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

  const load = useCallback(async () => {
    if (!enabled || !networkAvailable) return
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError('')
    try {
      const result = await notificationService.load()
      if (requestId !== requestIdRef.current) return
      setNotifications(result.notifications)
      setUnreadCount(result.unreadCount)
    } catch (cause: unknown) {
      if (requestId !== requestIdRef.current) return
      console.error('No fue posible consultar las notificaciones', cause)
      setError('No fue posible consultar las notificaciones.')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [enabled, networkAvailable])

  useEffect(() => {
    if (enabled && networkAvailable) void load()
  }, [enabled, networkAvailable, refreshKey, load])

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
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, readAt } : item,
      ),
    )
    setUnreadCount((current) => Math.max(0, current - 1))
    try {
      const updated = await notificationService.markRead(notification.id)
      if (!updated) throw new Error('La notificación no está asignada al usuario.')
    } catch (cause: unknown) {
      console.error('No fue posible marcar la notificación como leída', cause)
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
    setNotifications((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
    )
    setUnreadCount(0)
    try {
      await notificationService.markAllRead()
    } catch (cause: unknown) {
      console.error('No fue posible marcar todas las notificaciones como leídas', cause)
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
        aria-label={unreadCount > 0 ? unreadLabel(unreadCount) : 'Notificaciones'}
        className="icon-button relative"
        ref={bellRef}
        type="button"
        onClick={() => {
          setOpen(true)
          if (networkAvailable) void load()
        }}
      >
        <BellIcon className="size-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black leading-5 text-white ring-2 ring-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
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
              {unreadCount > 0 && (
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
            <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
              {notifications.map((notification) => (
                <li
                  className={notification.readAt ? 'bg-white' : 'bg-teal-50/60'}
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
                          <span className="flex items-center gap-2 font-extrabold text-slate-950">
                            <span className="truncate">{notification.title}</span>
                            {!notification.readAt && (
                              <span
                                aria-label="No leída"
                                className="size-2 shrink-0 rounded-full bg-teal-700"
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
          )}
        </div>
      </AppModal>
    </>
  )
}
