import type { OperationsRepository } from '../repositories/operationsRepository'
import type {
  AttendanceRecord,
  Expense,
  MerchandiseTransfer,
  Purchase,
  Store,
  SyncEntity,
  SyncOperation,
  SyncQueueItem,
  SyncStatus,
} from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'
import { currencyFormatter } from '../utils/money'

export type SyncInspectorStatus = Extract<SyncStatus, 'pending' | 'syncing' | 'error'>

export type SyncInspectorItem = {
  id: string
  entityType: SyncEntity
  entityId: string
  operation: SyncOperation
  description: string
  detail?: string
  storeId?: string
  storeName?: string
  ownerId?: string
  operatorAccountId: string | null
  businessDate?: string
  createdAt: string
  status: SyncInspectorStatus
  retryCount: number
  lastAttemptAt?: string
  lastError?: string
  errorCode?: SyncErrorCode
}

export type SyncInspectorSummary = {
  total: number
  pending: number
  syncing: number
  error: number
}

export type SyncInspectorSnapshot = {
  items: SyncInspectorItem[]
  summary: SyncInspectorSummary
}

export type SyncErrorCode =
  | 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED'
  | 'OPERATOR_STORE_FORBIDDEN'
  | 'OPERATOR_PERMISSION_REQUIRED'
  | 'OPERATOR_SESSION_EXPIRED'
  | 'SERVER_UNREACHABLE'
  | 'LOCAL_RECORD_MISSING'
  | 'REMOTE_DELETE_UNAVAILABLE'
  | 'SYNC_FAILED'

export type SyncInspectorRepository = Pick<
  OperationsRepository,
  | 'getAttendance'
  | 'getCollaborator'
  | 'getExpense'
  | 'getMerchandiseTransfer'
  | 'getPurchase'
  | 'getPurchasePaymentByPurchaseId'
  | 'listPendingQueue'
  | 'listStores'
>

type RelatedSyncData = {
  description: string
  detail?: string
  storeId?: string
  storeName?: string
  ownerId?: string
  businessDate?: string
  createdAt?: string
  syncStatus?: SyncStatus
}

const ATTENDANCE_LABELS: Record<AttendanceRecord['status'], string> = {
  present: 'Presente',
  absent: 'Ausente',
  rest_day: 'Descanso',
}

function includesAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate))
}

function normalizedError(value: string): string {
  return value.trim().toLocaleLowerCase('es-MX')
}

export function getSyncErrorCode(value?: string): SyncErrorCode | undefined {
  if (!value?.trim()) return undefined
  const text = normalizedError(value)

  if (
    includesAny(text, [
      'legacy_operator_attribution_required',
      'sin identidad operativa',
      'registro legacy',
    ])
  ) {
    return 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED'
  }
  if (
    includesAny(text, [
      'operator_store_forbidden',
      'expense_store_forbidden',
      'purchase_store_forbidden',
      'otra tienda',
      'tienda que ya no tienes asignada',
    ])
  ) {
    return 'OPERATOR_STORE_FORBIDDEN'
  }
  if (
    includesAny(text, [
      'operator_account_inactive',
      'operator_capability_forbidden',
      'no tiene permiso',
      'no permite realizar esta operación',
      'rol actual no permite',
      'cuenta del operador está desactivada',
    ])
  ) {
    return 'OPERATOR_PERMISSION_REQUIRED'
  }
  if (
    includesAny(text, [
      'operator_session_required',
      'operator_session_invalid',
      'operator_session_expired',
      'sesión del operador expiró',
      'sesión operativa expirada',
      'sesión expiró',
      'refresh token',
      'invalid session',
      'jwt',
      '401',
    ])
  ) {
    return 'OPERATOR_SESSION_EXPIRED'
  }
  if (
    includesAny(text, [
      'failed to fetch',
      'fetch failed',
      'networkerror',
      'network error',
      'sin conexión',
      'no respondió',
      'no fue posible contactar',
      'timeout',
      '502',
      '503',
      '504',
    ])
  ) {
    return 'SERVER_UNREACHABLE'
  }
  if (
    includesAny(text, [
      'local ya no existe',
      'local no existe',
      'local record missing',
      'registro local no existe',
    ])
  ) {
    return 'LOCAL_RECORD_MISSING'
  }
  if (
    includesAny(text, [
      'eliminación remota no está habilitada',
      'remote delete',
    ])
  ) {
    return 'REMOTE_DELETE_UNAVAILABLE'
  }
  return 'SYNC_FAILED'
}

export function toUserFacingSyncError(value?: string): string | undefined {
  const code = getSyncErrorCode(value)
  if (!code) return undefined

  if (value?.trim() === 'Supabase no respondió') return value

  switch (code) {
    case 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED':
      return 'Registro legacy sin identidad operativa'
    case 'OPERATOR_STORE_FORBIDDEN':
      return 'La operación pertenece a otra tienda'
    case 'OPERATOR_PERMISSION_REQUIRED':
      return 'El operador ya no tiene permiso'
    case 'OPERATOR_SESSION_EXPIRED':
      return 'Sesión operativa expirada'
    case 'SERVER_UNREACHABLE':
      return 'Sin conexión con el servidor'
    case 'LOCAL_RECORD_MISSING':
      return 'El registro local ya no está disponible'
    case 'REMOTE_DELETE_UNAVAILABLE':
      return 'La eliminación remota no está habilitada'
    case 'SYNC_FAILED':
      return 'No se pudo sincronizar esta operación'
  }
}

function storeName(
  storesById: ReadonlyMap<string, Store>,
  storeId: string | undefined,
): string {
  return storeId ? storesById.get(storeId)?.name ?? 'Tienda no identificada' : 'Tienda no identificada'
}

function expenseData(
  expense: Expense | undefined,
  storesById: ReadonlyMap<string, Store>,
): RelatedSyncData {
  if (!expense) {
    return {
      description: 'Gasto local no encontrado',
    }
  }
  return {
    description: `Gasto · ${currencyFormatter.format(expense.amount)}`,
    detail: expense.concept,
    storeId: expense.storeId,
    storeName: storeName(storesById, expense.storeId),
    ownerId: expense.createdBy,
    businessDate: expense.businessDate,
    createdAt: expense.createdAt,
    syncStatus: expense.syncStatus,
  }
}

async function attendanceData(
  record: AttendanceRecord | undefined,
  repository: SyncInspectorRepository,
  storesById: ReadonlyMap<string, Store>,
): Promise<RelatedSyncData> {
  if (!record) {
    return {
      description: 'Asistencia local no encontrada',
    }
  }
  const collaborator = await repository.getCollaborator(record.collaboratorId)
  return {
    description: `Asistencia · ${collaborator?.name ?? 'Colaborador no identificado'}`,
    detail: ATTENDANCE_LABELS[record.status],
    storeId: record.storeId,
    storeName: storeName(storesById, record.storeId),
    ownerId: record.recordedBy,
    businessDate: record.attendanceDate,
    createdAt: record.createdAt,
    syncStatus: record.syncStatus,
  }
}

function transferData(
  transfer: MerchandiseTransfer | undefined,
  storesById: ReadonlyMap<string, Store>,
): RelatedSyncData {
  if (!transfer) {
    return {
      description: 'Transferencia local no encontrada',
    }
  }
  const origin = storeName(storesById, transfer.originStoreId)
  const destination = storeName(storesById, transfer.destinationStoreId)
  return {
    description: `Transferencia · ${origin} → ${destination}`,
    detail: `Ticket ${transfer.ticketNumber} · ${currencyFormatter.format(transfer.amount)}`,
    storeId: transfer.originStoreId,
    storeName: `${origin} → ${destination}`,
    ownerId: transfer.createdBy,
    businessDate: transfer.businessDate,
    createdAt: transfer.createdAt,
    syncStatus: transfer.syncStatus,
  }
}

async function purchaseData(
  purchase: Purchase | undefined,
  repository: SyncInspectorRepository,
  storesById: ReadonlyMap<string, Store>,
): Promise<RelatedSyncData> {
  if (!purchase) {
    return {
      description: 'Compra local no encontrada',
    }
  }
  const payment = await repository.getPurchasePaymentByPurchaseId(purchase.id)
  const purchaseStoreName = payment?.sourceStoreId
    ? storeName(storesById, payment.sourceStoreId)
    : 'Caja Central'
  const detail = [
    currencyFormatter.format(purchase.amount),
    purchase.folio ? `Folio ${purchase.folio}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    description: `Compra · ${purchase.supplierNameSnapshot}`,
    detail,
    storeId: payment?.sourceStoreId,
    storeName: purchaseStoreName,
    ownerId: purchase.createdBy,
    businessDate: purchase.businessDate,
    createdAt: purchase.createdAt,
    syncStatus: purchase.syncStatus,
  }
}

async function relatedData(
  item: SyncQueueItem,
  repository: SyncInspectorRepository,
  storesById: ReadonlyMap<string, Store>,
): Promise<RelatedSyncData> {
  if (item.entityType === 'expense') {
    return expenseData(await repository.getExpense(item.entityId), storesById)
  }
  if (item.entityType === 'attendance') {
    return attendanceData(
      await repository.getAttendance(item.entityId),
      repository,
      storesById,
    )
  }
  if (item.entityType === 'merchandiseTransfer') {
    return transferData(
      await repository.getMerchandiseTransfer(item.entityId),
      storesById,
    )
  }
  return purchaseData(
    await repository.getPurchase(item.entityId),
    repository,
    storesById,
  )
}

function statusFor(
  queueItem: SyncQueueItem,
  entityStatus: SyncStatus | undefined,
): SyncInspectorStatus {
  if (entityStatus === 'syncing') return 'syncing'
  if (entityStatus === 'error' || queueItem.lastError) return 'error'
  return 'pending'
}

export function summarizeSyncItems(
  items: readonly SyncInspectorItem[],
): SyncInspectorSummary {
  return items.reduce(
    (summary, item) => {
      summary[item.status] += 1
      summary.total += 1
      return summary
    },
    { total: 0, pending: 0, syncing: 0, error: 0 },
  )
}

export class SyncInspectorService {
  constructor(
    private readonly repository: SyncInspectorRepository = operationsRepository,
  ) {}

  async getSnapshot(): Promise<SyncInspectorSnapshot> {
    const [queueItems, stores] = await Promise.all([
      this.repository.listPendingQueue(),
      this.repository.listStores(),
    ])
    const storesById = new Map(stores.map((store) => [store.id, store]))
    const items = await Promise.all(
      queueItems.map(async (queueItem) => {
        const related = await relatedData(
          queueItem,
          this.repository,
          storesById,
        )
        const hasError = Boolean(queueItem.lastError) || related.syncStatus === 'error'
        const errorCode = hasError
          ? getSyncErrorCode(queueItem.lastError) ?? 'SYNC_FAILED'
          : undefined
        const lastError = hasError
          ? toUserFacingSyncError(queueItem.lastError) ??
            'No se pudo sincronizar esta operación'
          : undefined

        return {
          id: queueItem.id,
          entityType: queueItem.entityType,
          entityId: queueItem.entityId,
          operation: queueItem.operation,
          description: related.description,
          detail: related.detail,
          storeId: related.storeId,
          storeName: related.storeName,
          ownerId: related.ownerId,
          operatorAccountId: queueItem.operatorAccountId ?? null,
          businessDate: related.businessDate,
          createdAt: related.createdAt ?? queueItem.createdAt,
          status: statusFor(queueItem, related.syncStatus),
          retryCount: Number.isFinite(queueItem.attempts)
            ? queueItem.attempts
            : 0,
          lastAttemptAt: queueItem.lastAttemptAt,
          lastError,
          errorCode,
        }
      }),
    )

    return { items, summary: summarizeSyncItems(items) }
  }
}

export const syncInspectorService = new SyncInspectorService()
