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
import { getEffectiveAttendanceType } from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'
import { currencyFormatter } from '../utils/money'
import {
  getSyncErrorCode,
  isPaidAttendanceImmutableError,
  PAID_ATTENDANCE_FRIENDLY_TITLE,
  sanitizeSyncDiagnostic,
  sanitizeSyncErrorCode,
  toUserFacingSyncError,
} from '../utils/syncError'

export { getSyncErrorCode, toUserFacingSyncError } from '../utils/syncError'
export type { SyncErrorCode } from '../utils/syncError'

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
  errorCode?: string
  diagnosticError?: string
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
    detail:
      record.status === 'present' &&
      getEffectiveAttendanceType(record.status, record.attendanceType) === 'half'
        ? 'Medio turno'
        : ATTENDANCE_LABELS[record.status],
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
  if (
    entityStatus === 'error' ||
    queueItem.lastError ||
    queueItem.errorCode ||
    queueItem.diagnosticError
  ) {
    return 'error'
  }
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
        const hasError =
          Boolean(
            queueItem.lastError ||
              queueItem.errorCode ||
              queueItem.diagnosticError,
          ) || related.syncStatus === 'error'
        const paidAttendanceError = isPaidAttendanceImmutableError(queueItem)
        const errorCode = hasError
          ? sanitizeSyncErrorCode(queueItem.errorCode) ??
            getSyncErrorCode(queueItem.lastError) ??
            'SYNC_FAILED'
          : undefined
        const lastError = hasError
          ? paidAttendanceError
            ? PAID_ATTENDANCE_FRIENDLY_TITLE
            : toUserFacingSyncError(queueItem.lastError) ??
            'No se pudo sincronizar esta operación'
          : undefined
        const diagnosticError = hasError
          ? sanitizeSyncDiagnostic(queueItem.diagnosticError)
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
          diagnosticError,
        }
      }),
    )

    return { items, summary: summarizeSyncItems(items) }
  }
}

export const syncInspectorService = new SyncInspectorService()
