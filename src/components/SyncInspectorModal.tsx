import { AppModal } from './AppModal'
import { SyncIcon } from './icons'
import type { OperatorSession, UserProfile } from '../domain/models'
import {
  toUserFacingSyncError,
  type SyncInspectorItem,
  type SyncInspectorSnapshot,
} from '../services/syncInspectorService'
import { formatLongDate } from '../utils/date'
import type { RefObject } from 'react'
import {
  sanitizeSyncDiagnostic,
  sanitizeSyncErrorCode,
} from '../utils/syncError'

type SyncInspectorModalProps = {
  error?: string
  loading: boolean
  networkAvailable: boolean
  onClose: () => void
  onRefresh: () => void
  onSync: () => void
  open: boolean
  operatorSession?: OperatorSession
  returnFocusRef?: RefObject<HTMLElement | null>
  snapshot: SyncInspectorSnapshot
  syncing: boolean
  user: UserProfile
}

const STATUS_META = {
  pending: {
    label: 'Pendiente',
    className: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  },
  syncing: {
    label: 'Sincronizando',
    className: 'bg-teal-50 text-teal-800 ring-1 ring-teal-200',
  },
  error: {
    label: 'Error',
    className: 'bg-red-50 text-red-800 ring-1 ring-red-200',
  },
} as const

const OPERATION_LABELS = {
  insert: 'Alta',
  update: 'Actualización',
  delete: 'Eliminación',
} as const

function formatDateTime(value?: string): string {
  if (!value) return 'No disponible'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No disponible'
  return date.toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatBusinessDate(value?: string): string {
  if (!value) return 'No disponible'
  try {
    return formatLongDate(value)
  } catch {
    return value
  }
}

function ownerLabel(
  item: SyncInspectorItem,
  user: UserProfile,
  operatorSession?: OperatorSession,
): string {
  if (item.operatorAccountId) {
    if (operatorSession?.account.id === item.operatorAccountId) {
      return operatorSession.account.displayName
    }
    return `Cuenta operativa · ${item.operatorAccountId}`
  }
  if (user.role === 'admin' && item.ownerId === user.id) {
    return `${user.fullName} · Administración`
  }
  return 'Sin identidad operativa (legacy)'
}

function waitingCount(snapshot: SyncInspectorSnapshot): number {
  return snapshot.summary.pending + snapshot.summary.syncing
}

function summaryLabel(snapshot: SyncInspectorSnapshot): string {
  const { error, total } = snapshot.summary
  if (total === 0) return 'Al día'
  const waiting = waitingCount(snapshot)
  const waitingLabel = `${waiting} pendiente${waiting === 1 ? '' : 's'}`
  return error > 0 ? `${waitingLabel} · ${error} con error` : waitingLabel
}

export function SyncInspectorModal({
  error,
  loading,
  networkAvailable,
  onClose,
  onRefresh,
  onSync,
  open,
  operatorSession,
  returnFocusRef,
  snapshot,
  syncing,
  user,
}: SyncInspectorModalProps) {
  return (
    <AppModal
      closeLabel="Cerrar detalle de sincronización"
      eyebrow="Operaciones locales"
      open={open}
      returnFocusRef={returnFocusRef}
      title="Detalle de sincronización"
      onClose={onClose}
    >
      <div className="mt-5 rounded-2xl border border-teal-100 bg-teal-50 p-4">
        <p className="text-base font-black text-teal-900">{summaryLabel(snapshot)}</p>
        <p className="mt-1 text-xs leading-5 text-teal-800">
          Estas operaciones permanecen en este dispositivo hasta completar su sincronización.
        </p>
        {snapshot.summary.syncing > 0 && (
          <p className="mt-2 text-xs font-bold text-teal-800">
            {snapshot.summary.syncing} en proceso ahora
          </p>
        )}
      </div>

      {error && (
        <p className="alert-error mt-4" role="alert">
          {toUserFacingSyncError(error) ?? 'No fue posible cargar el detalle de sincronización.'}
        </p>
      )}

      {loading && (
        <p className="mt-5 text-sm font-semibold text-slate-500" role="status">
          Cargando operaciones pendientes…
        </p>
      )}

      {!loading && snapshot.items.length === 0 && (
        <div className="empty-state mt-4 px-2 py-8">
          <p className="font-bold text-slate-700">No hay operaciones pendientes</p>
          <p className="mt-1 text-sm text-slate-500">Los cambios locales ya están al día.</p>
        </div>
      )}

      {!loading && snapshot.items.length > 0 && (
        <ol className="mt-5 space-y-3">
          {snapshot.items.map((item) => {
            const status = STATUS_META[item.status]
            const safeError = toUserFacingSyncError(item.lastError)
            const safeErrorCode = sanitizeSyncErrorCode(item.errorCode)
            const safeDiagnosticError = sanitizeSyncDiagnostic(item.diagnosticError)
            return (
              <li
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                key={item.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black text-slate-950">{item.description}</p>
                    {item.detail && (
                      <p className="mt-1 text-sm leading-5 text-slate-600">{item.detail}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${status.className}`}>
                    {status.label}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div className="min-w-0">
                    <dt className="font-semibold text-slate-500">Operación</dt>
                    <dd className="mt-1 font-bold text-slate-800">{OPERATION_LABELS[item.operation]}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-semibold text-slate-500">Tienda</dt>
                    <dd className="mt-1 font-bold text-slate-800">{item.storeName ?? 'Tienda no identificada'}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-semibold text-slate-500">Operador propietario</dt>
                    <dd className="mt-1 break-words font-bold text-slate-800">
                      {ownerLabel(item, user, operatorSession)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-semibold text-slate-500">Fecha de operación</dt>
                    <dd className="mt-1 font-bold text-slate-800">{formatBusinessDate(item.businessDate)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-semibold text-slate-500">Registrado</dt>
                    <dd className="mt-1 font-bold text-slate-800">{formatDateTime(item.createdAt)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-semibold text-slate-500">Intentos</dt>
                    <dd className="mt-1 font-bold text-slate-800">{item.retryCount}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-semibold text-slate-500">Último intento</dt>
                    <dd className="mt-1 font-bold text-slate-800">{formatDateTime(item.lastAttemptAt)}</dd>
                  </div>
                </dl>

                {safeError && (
                  <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold leading-5 text-red-800">
                    Último error: {safeError}
                  </p>
                )}

                {user.role === 'admin' && (
                  <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <summary className="cursor-pointer font-bold">Diagnóstico</summary>
                    <dl className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-slate-500">entityType</dt>
                        <dd className="mt-1 break-words font-bold">{item.entityType}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">entityId</dt>
                        <dd className="mt-1 break-words font-bold">{item.entityId}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">retryCount</dt>
                        <dd className="mt-1 font-bold">{item.retryCount}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">lastAttemptAt</dt>
                        <dd className="mt-1 break-words font-bold">{item.lastAttemptAt ?? 'No disponible'}</dd>
                      </div>
                      {safeErrorCode && (
                        <div className="col-span-2">
                          <dt className="text-slate-500">errorCode</dt>
                          <dd className="mt-1 break-words font-bold">{safeErrorCode}</dd>
                        </div>
                      )}
                      {safeDiagnosticError && (
                        <div className="col-span-2">
                          <dt className="text-slate-500">diagnosticError</dt>
                          <dd className="mt-1 break-words font-bold">{safeDiagnosticError}</dd>
                        </div>
                      )}
                    </dl>
                  </details>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          className="button-secondary"
          disabled={loading}
          type="button"
          onClick={onRefresh}
        >
          Actualizar
        </button>
        <button
          className="button-primary"
          disabled={syncing || !networkAvailable}
          type="button"
          onClick={onSync}
        >
          <SyncIcon className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Sincronizando…' : networkAvailable ? 'Sincronizar ahora' : 'Sin conexión'}
        </button>
      </div>
    </AppModal>
  )
}
