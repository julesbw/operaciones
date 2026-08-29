import { describe, expect, it, vi } from 'vitest'
import type {
  AttendanceRecord,
  Expense,
  MerchandiseTransfer,
  Purchase,
  PurchasePayment,
  Store,
  SyncQueueItem,
} from '../domain/models'
import {
  SyncInspectorService,
  type SyncInspectorRepository,
  getSyncErrorCode,
  toUserFacingSyncError,
} from './syncInspectorService'
import {
  getSafeSyncErrorCode,
  sanitizeSyncDiagnostic,
} from '../utils/syncError'

const stores: Store[] = [
  {
    id: 'store-north',
    name: 'Tienda Norte',
    status: 'active',
    createdAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:00:00.000Z',
  },
  {
    id: 'store-center',
    name: 'Tienda Centro',
    status: 'active',
    createdAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:00:00.000Z',
  },
]

const expense: Expense = {
  id: 'expense-id',
  storeId: 'store-north',
  businessDate: '2026-08-28',
  amount: 350,
  concept: 'Gasolina',
  paymentMethod: 'efectivo',
  fundingSource: 'store_cash',
  sourceStoreId: 'store-north',
  createdBy: 'technical-user',
  operatorAccountId: 'operator-a',
  createdAt: '2026-08-28T15:00:00.000Z',
  updatedAt: '2026-08-28T15:00:00.000Z',
  version: 0,
  syncStatus: 'pending',
}

const attendance: AttendanceRecord = {
  id: 'attendance-id',
  collaboratorId: 'collaborator-id',
  storeId: 'store-center',
  attendanceDate: '2026-08-28',
  status: 'present',
  recordedBy: 'technical-user',
  operatorAccountId: null,
  createdAt: '2026-08-28T16:00:00.000Z',
  updatedAt: '2026-08-28T16:00:00.000Z',
  version: 0,
  syncStatus: 'error',
}

const transfer: MerchandiseTransfer = {
  id: 'transfer-id',
  originStoreId: 'store-north',
  destinationStoreId: 'store-center',
  ticketNumber: 'T-42',
  amount: 125,
  businessDate: '2026-08-28',
  createdBy: 'technical-user',
  operatorAccountId: 'operator-b',
  createdAt: '2026-08-28T17:00:00.000Z',
  updatedAt: '2026-08-28T17:00:00.000Z',
  version: 0,
  syncStatus: 'syncing',
}

const purchase: Purchase = {
  id: 'purchase-id',
  supplierId: 'supplier-id',
  supplierNameSnapshot: 'Proveedor X',
  businessDate: '2026-08-28',
  amount: 800,
  createdBy: 'technical-user',
  operatorAccountId: 'operator-a',
  createdAt: '2026-08-28T18:00:00.000Z',
  updatedAt: '2026-08-28T18:00:00.000Z',
  syncStatus: 'pending',
}

const purchasePayment: PurchasePayment = {
  id: 'payment-id',
  purchaseId: 'purchase-id',
  amount: 800,
  fundingSource: 'store_cash',
  sourceStoreId: 'store-center',
  paymentMethod: 'efectivo',
  coinsAmount: 0,
  paidAt: '2026-08-28T18:00:00.000Z',
  createdBy: 'technical-user',
  createdAt: '2026-08-28T18:00:00.000Z',
}

const queueItems: SyncQueueItem[] = [
  {
    id: 'expense:expense-id',
    entityType: 'expense',
    entityId: 'expense-id',
    operation: 'insert',
    createdAt: expense.createdAt,
    attempts: 0,
    operatorAccountId: 'operator-a',
  },
  {
    id: 'attendance:attendance-id',
    entityType: 'attendance',
    entityId: 'attendance-id',
    operation: 'update',
    createdAt: attendance.createdAt,
    attempts: 3,
    operatorAccountId: null,
    lastError: 'Failed to fetch PIN=123456 token=do-not-render',
    errorCode: 'P0001',
    diagnosticError: 'Attendance already belongs to a confirmed payment',
    lastAttemptAt: '2026-08-28T16:30:00.000Z',
  },
  {
    id: 'merchandiseTransfer:transfer-id',
    entityType: 'merchandiseTransfer',
    entityId: 'transfer-id',
    operation: 'insert',
    createdAt: transfer.createdAt,
    attempts: 2,
    operatorAccountId: 'operator-b',
  },
  {
    id: 'purchase:purchase-id',
    entityType: 'purchase',
    entityId: 'purchase-id',
    operation: 'insert',
    createdAt: purchase.createdAt,
    attempts: 1,
    operatorAccountId: 'operator-a',
  },
]

function repository(): SyncInspectorRepository {
  return {
    getAttendance: vi.fn().mockResolvedValue(attendance),
    getCollaborator: vi.fn().mockResolvedValue({
      id: 'collaborator-id',
      name: 'María',
      storeId: 'store-center',
      restDay: 0,
      status: 'active',
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
    }),
    getExpense: vi.fn().mockResolvedValue(expense),
    getMerchandiseTransfer: vi.fn().mockResolvedValue(transfer),
    getPurchase: vi.fn().mockResolvedValue(purchase),
    getPurchasePaymentByPurchaseId: vi.fn().mockResolvedValue(purchasePayment),
    listPendingQueue: vi.fn().mockResolvedValue(queueItems),
    listStores: vi.fn().mockResolvedValue(stores),
  }
}

describe('SyncInspectorService', () => {
  it('joins pending queue items with local entities and preserves their owners', async () => {
    const snapshot = await new SyncInspectorService(repository()).getSnapshot()

    expect(snapshot.summary).toEqual({
      total: 4,
      pending: 2,
      syncing: 1,
      error: 1,
    })
    expect(snapshot.items[0]).toMatchObject({
      description: 'Gasto · $350',
      detail: 'Gasolina',
      storeName: 'Tienda Norte',
      operatorAccountId: 'operator-a',
      retryCount: 0,
      status: 'pending',
    })
    expect(snapshot.items[1]).toMatchObject({
      description: 'Asistencia · María',
      storeName: 'Tienda Centro',
      retryCount: 3,
      lastAttemptAt: '2026-08-28T16:30:00.000Z',
      lastError: 'Sin conexión con el servidor',
      errorCode: 'P0001',
      diagnosticError: 'Attendance already belongs to a confirmed payment',
      status: 'error',
    })
    expect(snapshot.items[2]).toMatchObject({
      description: 'Transferencia · Tienda Norte → Tienda Centro',
      storeName: 'Tienda Norte → Tienda Centro',
      operatorAccountId: 'operator-b',
      status: 'syncing',
    })
    expect(snapshot.items[3]).toMatchObject({
      description: 'Compra · Proveedor X',
      detail: '$800',
      storeName: 'Tienda Centro',
      operatorAccountId: 'operator-a',
    })
  })

  it('maps technical errors to safe, understandable messages', () => {
    expect(getSyncErrorCode('LEGACY_OPERATOR_ATTRIBUTION_REQUIRED')).toBe(
      'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED',
    )
    expect(toUserFacingSyncError('LEGACY_OPERATOR_ATTRIBUTION_REQUIRED')).toBe(
      'Registro legacy sin identidad operativa',
    )
    expect(toUserFacingSyncError('OPERATOR_STORE_FORBIDDEN')).toBe(
      'La operación pertenece a otra tienda',
    )
    expect(toUserFacingSyncError('OPERATOR_CAPABILITY_FORBIDDEN')).toBe(
      'El operador ya no tiene permiso',
    )
    expect(
      toUserFacingSyncError('Unexpected error PIN=123456 token_hash=secret'),
    ).toBe('No se pudo sincronizar esta operación')
  })

  it('keeps technical codes while removing secrets from diagnostics', () => {
    expect(
      getSafeSyncErrorCode({
        code: 'P0001',
        message: 'Attendance already belongs to a confirmed payment',
      }),
    ).toBe('P0001')

    const diagnostic = sanitizeSyncDiagnostic(
      'PIN=123456 · OperatorSession token=operator-secret · JWT eyJhbGci.eyJzdWIi.sig · Authorization header: Bearer auth-secret · token_hash=hash-secret · Inspector',
    )

    expect(diagnostic).toBeDefined()
    expect(diagnostic).not.toMatch(
      /PIN|OperatorSession|JWT|Authorization|token_hash|Inspector|123456|operator-secret|auth-secret|hash-secret/i,
    )
  })
})
