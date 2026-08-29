import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { OperationsDatabase } from '../db/database'
import type {
  AttendanceRecord,
  CentralCashMovement,
  CentralCashPendingClosing,
  CentralCashSummary,
  Expense,
  MerchandiseTransfer,
  PaidPurchase,
  SyncQueueItem,
} from '../domain/models'
import type { CashClosingRow } from '../types/database'
import type {
  CachedCashClosing,
  CachedCashClosingDetail,
} from '../types/cashClosingCache'
import { OperationsRepository } from './operationsRepository'

function attendance(id: string): AttendanceRecord {
  return {
    id,
    collaboratorId: 'collaborator-id',
    storeId: 'store-id',
    attendanceDate: '2026-08-06',
    status: 'present',
    recordedBy: 'user-id',
    createdAt: '2026-08-06T12:00:00.000Z',
    updatedAt: '2026-08-06T12:00:00.000Z',
    version: 0,
    syncStatus: 'pending',
  }
}

function queueItem(entityId: string): SyncQueueItem {
  return {
    id: `attendance:${entityId}`,
    entityType: 'attendance',
    entityId,
    operation: 'insert',
    createdAt: '2026-08-06T12:00:00.000Z',
    attempts: 0,
  }
}

function expense(
  id: string,
  storeId: string,
  businessDate: string,
  createdAt: string,
): Expense {
  return {
    id,
    storeId,
    businessDate,
    amount: 100,
    concept: `Gasto ${id}`,
    paymentMethod: 'efectivo',
    fundingSource: 'store_cash',
    sourceStoreId: storeId,
    createdBy: 'user-id',
    createdAt,
    updatedAt: createdAt,
    version: 0,
    syncStatus: 'pending',
  }
}

function expenseQueueItem(entityId: string): SyncQueueItem {
  return {
    id: `expense:${entityId}`,
    entityType: 'expense',
    entityId,
    operation: 'insert',
    createdAt: '2026-08-06T12:00:00.000Z',
    attempts: 0,
  }
}

function transfer(
  id: string,
  originStoreId: string,
  destinationStoreId: string,
  businessDate: string,
  ticketNumber: string,
): MerchandiseTransfer {
  const createdAt = `${businessDate}T12:00:00.000Z`
  return {
    id,
    originStoreId,
    destinationStoreId,
    businessDate,
    ticketNumber,
    amount: 100,
    createdBy: 'user-id',
    createdAt,
    updatedAt: createdAt,
    version: 0,
    syncStatus: 'pending',
  }
}

function transferQueueItem(entityId: string): SyncQueueItem {
  return {
    id: `merchandiseTransfer:${entityId}`,
    entityType: 'merchandiseTransfer',
    entityId,
    operation: 'insert',
    createdAt: '2026-08-12T12:00:00.000Z',
    attempts: 0,
  }
}

function paidPurchase(id: string, syncStatus: 'pending' | 'synced'): PaidPurchase {
  const createdAt = '2026-08-17T12:00:00.000Z'
  return {
    purchase: {
      id,
      supplierId: 'supplier-id',
      supplierNameSnapshot: 'Bimbo',
      businessDate: '2026-08-17',
      amount: 1_280,
      createdBy: 'user-id',
      createdAt,
      updatedAt: createdAt,
      syncStatus,
    },
    payment: {
      id: `payment-${id}`,
      purchaseId: id,
      amount: 1_280,
      fundingSource: 'store_cash',
      sourceStoreId: 'store-id',
      paymentMethod: 'efectivo',
      bills: { b1000: 1, b500: 0, b200: 1, b100: 0, b50: 1, b20: 1 },
      coinsAmount: 10,
      paidAt: createdAt,
      createdBy: 'user-id',
      createdAt,
    },
  }
}

function purchaseQueueItem(entityId: string): SyncQueueItem {
  return {
    id: `purchase:${entityId}`,
    entityType: 'purchase',
    entityId,
    operation: 'insert',
    createdAt: '2026-08-17T12:00:00.000Z',
    attempts: 0,
  }
}

const closingBills = {
  b1000: 1,
  b500: 0,
  b200: 0,
  b100: 0,
  b50: 0,
  b20: 0,
  monedas: 0,
}

function cachedClosing(
  id: string,
  storeId: string,
  businessDate: string,
  closedAt = `${businessDate}T18:00:00.000Z`,
): CachedCashClosing {
  const row: CashClosingRow = {
    id,
    store_id: storeId,
    business_date: businessDate,
    closing_number: 1,
    store_name_snapshot: `Tienda ${storeId}`,
    gross_sales: 1_000,
    closing_reconciliation_mode: 'normal',
    expense_total: 0,
    cash_expense_total: 0,
    expenses_total_snapshot: 0,
    cash_expenses_total_snapshot: 0,
    outgoing_transfers_total_snapshot: 0,
    store_cash_payments_total_snapshot: 0,
    purchases_total_snapshot: 0,
    cash_purchases_total_snapshot: 0,
    operational_outflows_total_snapshot: 0,
    cash_outflows_total_snapshot: 0,
    other_movements: 0,
    opening_balance: 0,
    counted_cash: 1_000,
    cash_balance: 0,
    cash_to_withdraw: 1_000,
    expected_cash: 1_000,
    difference: 0,
    bills: closingBills,
    balance_bills: closingBills,
    withdraw_bills: closingBills,
    notes: null,
    status: 'closed',
    closed_at: closedAt,
    closed_by: 'user-id',
    closed_by_operator_account_id: null,
    created_by: 'user-id',
    created_at: closedAt,
    updated_at: closedAt,
  }
  return { ...row, cachedAt: closedAt }
}

function cachedDetail(closing: CachedCashClosing): CachedCashClosingDetail {
  return {
    closingId: closing.id,
    closing,
    expenses: [],
    transfers: [],
    payments: [],
    purchases: [],
    adjustments: [],
    cachedAt: closing.cachedAt,
  }
}

describe('OperationsRepository attendance constraints', () => {
  it('keeps one attendance and one queue item when the same record is saved again', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)

    try {
      const record = attendance('attendance-id')
      await repository.saveAttendanceWithQueue([record], [queueItem(record.id)])
      await repository.saveAttendanceWithQueue(
        [{ ...record, status: 'absent' }],
        [{ ...queueItem(record.id), operation: 'update' }],
      )

      await expect(
        repository.listAttendance(record.storeId, record.attendanceDate),
      ).resolves.toMatchObject([{ id: record.id, status: 'absent' }])
      await expect(repository.countPendingQueue()).resolves.toBe(1)
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('rejects a second id for the same collaborator and date', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)

    try {
      const first = attendance('attendance-one')
      const duplicate = attendance('attendance-two')
      await repository.saveAttendanceWithQueue([first], [queueItem(first.id)])

      await expect(
        repository.saveAttendanceWithQueue(
          [duplicate],
          [queueItem(duplicate.id)],
        ),
      ).rejects.toBeDefined()
      await expect(repository.countPendingQueue()).resolves.toBe(1)
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('does not overwrite a queued attendance with a conflicting remote id', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)

    try {
      const local = attendance('attendance-local')
      const remote = {
        ...attendance('attendance-remote'),
        status: 'absent' as const,
        syncStatus: 'synced' as const,
      }
      await repository.saveAttendanceWithQueue([local], [queueItem(local.id)])
      await repository.saveRemoteAttendance([remote])

      await expect(
        repository.listAttendance(local.storeId, local.attendanceDate),
      ).resolves.toMatchObject([{ id: local.id, status: 'present' }])
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('keeps a newer local edit queued when an older sync finishes', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)

    try {
      const record = attendance('attendance-id')
      const firstQueue = queueItem(record.id)
      const newerQueue = {
        ...firstQueue,
        operation: 'update' as const,
        createdAt: '2026-08-06T12:01:00.000Z',
      }
      await repository.saveAttendanceWithQueue([record], [firstQueue])
      await repository.saveAttendanceWithQueue(
        [{ ...record, status: 'absent' }],
        [newerQueue],
      )

      await repository.completeQueueItem(firstQueue, 1)

      await expect(repository.countPendingQueue()).resolves.toBe(1)
      await expect(
        repository.listAttendance(record.storeId, record.attendanceDate),
      ).resolves.toMatchObject([
        { status: 'absent', syncStatus: 'pending', version: 1 },
      ])
    } finally {
      database.close()
      await database.delete()
    }
  })
})

describe('OperationsRepository store queries', () => {
  it('lists stores ordered by their indexed name', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const timestamp = '2026-08-06T12:00:00.000Z'

    try {
      await repository.saveStores([
        {
          id: 'store-north',
          name: 'Tienda Norte',
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: 'store-center',
          name: 'Tienda Centro',
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ])

      await expect(repository.listStores()).resolves.toMatchObject([
        { id: 'store-center' },
        { id: 'store-north' },
      ])
    } finally {
      database.close()
      await database.delete()
    }
  })
})

describe('OperationsRepository expense filters', () => {
  it('filters an inclusive date range across stores and orders newest first', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const records = [
      expense('old', 'north', '2026-08-01', '2026-08-01T18:00:00.000Z'),
      expense('center', 'center', '2026-08-10', '2026-08-10T16:00:00.000Z'),
      expense('north', 'north', '2026-08-11', '2026-08-11T15:00:00.000Z'),
    ]

    try {
      await Promise.all(
        records.map((record) =>
          repository.saveExpenseWithQueue(record, expenseQueueItem(record.id)),
        ),
      )

      await expect(
        repository.listExpenses(undefined, '2026-08-10', '2026-08-11'),
      ).resolves.toMatchObject([{ id: 'north' }, { id: 'center' }])
      await expect(
        repository.listExpenses('north', '2026-08-01', '2026-08-11'),
      ).resolves.toMatchObject([{ id: 'north' }, { id: 'old' }])
      await expect(
        repository.listExpenses('center', '2026-08-10'),
      ).resolves.toMatchObject([{ id: 'center' }])
    } finally {
      database.close()
      await database.delete()
    }
  })
})

describe('OperationsRepository merchandise transfer filters', () => {
  it('keeps one transfer and one queue item when the same write is retried', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const record = transfer('transfer-id', 'north', 'center', '2026-08-12', '0018452')
    const queued = transferQueueItem(record.id)

    try {
      await repository.saveMerchandiseTransferWithQueue(record, queued)
      await repository.saveMerchandiseTransferWithQueue(record, queued)

      await expect(repository.countPendingQueue()).resolves.toBe(1)
      await expect(
        repository.listMerchandiseTransfers('north', '2026-08-12'),
      ).resolves.toHaveLength(1)
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('filters by origin and inclusive business-date range, newest first', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const records = [
      transfer('old', 'north', 'center', '2026-08-01', '001'),
      transfer('center', 'center', 'north', '2026-08-10', '002'),
      transfer('north', 'north', 'center', '2026-08-11', '003'),
    ]

    try {
      await Promise.all(
        records.map((record) =>
          repository.saveMerchandiseTransferWithQueue(
            record,
            transferQueueItem(record.id),
          ),
        ),
      )

      await expect(
        repository.listMerchandiseTransfers(
          undefined,
          '2026-08-10',
          '2026-08-11',
        ),
      ).resolves.toMatchObject([{ id: 'north' }, { id: 'center' }])
      await expect(
        repository.listMerchandiseTransfers(
          'north',
          '2026-08-01',
          '2026-08-11',
        ),
      ).resolves.toMatchObject([{ id: 'north' }, { id: 'old' }])
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('does not overwrite a queued local transfer during a remote pull', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const local = transfer('transfer-id', 'north', 'center', '2026-08-12', '0018452')

    try {
      await repository.saveMerchandiseTransferWithQueue(
        local,
        transferQueueItem(local.id),
      )
      await repository.saveRemoteMerchandiseTransfers([
        {
          ...local,
          amount: 9_999,
          syncStatus: 'synced',
        },
      ])

      await expect(
        repository.getMerchandiseTransfer(local.id),
      ).resolves.toMatchObject({ amount: 100, syncStatus: 'pending' })
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('counts only selected unsynced movements for a closing', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const businessDate = '2026-08-12'
    const pendingExpense = expense('expense-pending', 'north', businessDate, `${businessDate}T10:00:00.000Z`)
    const pendingTransfer = transfer('transfer-pending', 'north', 'center', businessDate, '100')
    const incomingTransfer = transfer('transfer-incoming', 'center', 'north', businessDate, '101')

    try {
      await repository.saveExpenseWithQueue(
        pendingExpense,
        expenseQueueItem(pendingExpense.id),
      )
      await repository.saveMerchandiseTransferWithQueue(
        pendingTransfer,
        transferQueueItem(pendingTransfer.id),
      )
      await repository.saveMerchandiseTransferWithQueue(
        incomingTransfer,
        transferQueueItem(incomingTransfer.id),
      )
      await repository.saveRemoteExpenses([
        {
          ...expense('expense-synced', 'north', businessDate, `${businessDate}T09:00:00.000Z`),
          syncStatus: 'synced',
        },
      ])

      await expect(
        repository.countPendingSelectedClosingMovements(
          [pendingExpense.id],
          [pendingTransfer.id],
        ),
      ).resolves.toEqual({ expenses: 1, transfers: 1, purchases: 0 })
      await expect(
        repository.countPendingSelectedClosingMovements([], []),
      ).resolves.toEqual({ expenses: 0, transfers: 0, purchases: 0 })
    } finally {
      database.close()
      await database.delete()
    }
  })
})

describe('OperationsRepository collaborator filters', () => {
  it('lists active collaborators from every cached store', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const timestamp = '2026-08-09T12:00:00.000Z'

    try {
      await repository.saveCollaborators([
        {
          id: 'north-carlos',
          name: 'Carlos Pérez',
          storeId: 'north',
          restDay: 1,
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: 'center-ana',
          name: 'Ana López',
          storeId: 'center',
          restDay: 2,
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: 'inactive-person',
          name: 'Persona Inactiva',
          storeId: 'center',
          restDay: 3,
          status: 'inactive',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ])

      await expect(repository.listCollaborators()).resolves.toMatchObject([
        { id: 'center-ana' },
        { id: 'north-carlos' },
      ])
    } finally {
      database.close()
      await database.delete()
    }
  })
})

describe('OperationsRepository collaborator queries', () => {
  it('keeps inactive collaborators available only when requested', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const base = {
      name: 'Colaborador',
      storeId: 'store-id',
      restDay: 0,
      payCycleEndWeekday: 6,
      weeklyPay: 1_000,
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
    }

    try {
      await repository.saveCollaborators([
        { ...base, id: 'active-collaborator', status: 'active' },
        { ...base, id: 'inactive-collaborator', status: 'inactive' },
      ])

      await expect(repository.listCollaborators()).resolves.toMatchObject([
        { id: 'active-collaborator', status: 'active' },
      ])
      await expect(
        repository.listCollaborators(undefined, true),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'active-collaborator' }),
          expect.objectContaining({ id: 'inactive-collaborator' }),
        ]),
      )
    } finally {
      database.close()
      await database.delete()
    }
  })
})

describe('OperationsRepository central cash cache', () => {
  it('replaces a filtered pending scope without deleting another store', async () => {
    const database = new OperationsDatabase(
      `operations-test-${crypto.randomUUID()}`,
    )
    const repository = new OperationsRepository(database)
    const cachedAt = '2026-08-16T12:00:00.000Z'
    const pending = (
      id: string,
      storeId: string,
      businessDate: string,
    ): CentralCashPendingClosing => ({
      id,
      storeId,
      storeName: `Tienda ${storeId}`,
      businessDate,
      sequenceNumber: 1,
      cashToWithdraw: 8_000,
      withdrawBills: {
        b1000: 8,
        b500: 0,
        b200: 0,
        b100: 0,
        b50: 0,
        b20: 0,
        monedas: 0,
      },
      closedAt: cachedAt,
      cachedAt,
    })

    try {
      await repository.replaceCentralCashPendingClosingsForScope([
        pending('north-old', 'north', '2026-08-15'),
        pending('center', 'center', '2026-08-15'),
      ])
      await repository.replaceCentralCashPendingClosingsForScope(
        [pending('north-new', 'north', '2026-08-15')],
        'north',
        '2026-08-01',
        '2026-08-31',
      )

      const result = await repository.listCentralCashPendingClosings()
      expect(result).toHaveLength(2)
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'north-new' }),
          expect.objectContaining({ id: 'center' }),
        ]),
      )
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('stores the derived summary and immutable movement snapshots locally', async () => {
    const database = new OperationsDatabase(
      `operations-test-${crypto.randomUUID()}`,
    )
    const repository = new OperationsRepository(database)
    const cachedAt = '2026-08-16T12:00:00.000Z'
    const summary: CentralCashSummary = {
      id: 'current',
      balance: 8_000,
      todayInflows: 8_000,
      todayOutflows: 0,
      todayNet: 8_000,
      bills: {
        b1000: 8,
        b500: 0,
        b200: 0,
        b100: 0,
        b50: 0,
        b20: 0,
      },
      coinsAmount: 0,
      pendingClosingsCount: 0,
      pendingClosingsAmount: 0,
      cachedAt,
    }
    const movement: CentralCashMovement = {
      id: 'movement-id',
      movementType: 'inflow',
      sourceType: 'cash_closing',
      sourceId: 'closing-id',
      amount: 8_000,
      businessDate: '2026-08-14',
      concept: 'Corte #2 · Tienda Centro',
      bills: summary.bills,
      coinsAmount: 0,
      storeIdSnapshot: 'center',
      storeNameSnapshot: 'Tienda Centro',
      sequenceNumberSnapshot: 2,
      createdBy: 'admin-id',
      createdByNameSnapshot: 'Administración',
      createdAt: cachedAt,
      cachedAt,
    }

    try {
      await repository.saveCentralCashSummary(summary)
      await repository.saveCentralCashMovement(movement)

      await expect(repository.getCentralCashSummary()).resolves.toEqual(summary)
      await expect(
        repository.listCentralCashMovements('center'),
      ).resolves.toEqual([movement])
    } finally {
      database.close()
      await database.delete()
    }
  })
})

describe('OperationsRepository sync failures', () => {
  it('restores the remote attendance and removes only its queue item', async () => {
    const database = new OperationsDatabase(
      `operations-test-${crypto.randomUUID()}`,
    )
    const repository = new OperationsRepository(database)
    const local = {
      ...attendance('attendance-reconciliation'),
      status: 'absent' as const,
      syncStatus: 'error' as const,
    }
    const other = {
      ...local,
      id: 'attendance-other',
      collaboratorId: 'collaborator-other',
    }
    const queued = queueItem(local.id)
    const otherQueued = queueItem(other.id)
    const remote = {
      ...local,
      status: 'present' as const,
      updatedAt: '2026-08-28T18:00:00.000Z',
      version: 4,
      syncStatus: 'synced' as const,
    }

    try {
      await repository.saveAttendanceWithQueue(
        [local, other],
        [queued, otherQueued],
      )
      await repository.reconcileAttendanceQueueItem(queued, remote)

      await expect(database.syncQueue.get(queued.id)).resolves.toBeUndefined()
      await expect(database.syncQueue.get(otherQueued.id)).resolves.toEqual(
        otherQueued,
      )
      await expect(database.attendanceRecords.get(local.id)).resolves.toEqual(
        remote,
      )
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('persists sanitized Supabase diagnostics with the queue failure', async () => {
    const database = new OperationsDatabase(
      `operations-test-${crypto.randomUUID()}`,
    )
    const repository = new OperationsRepository(database)
    const record = attendance('attendance-diagnostic')
    const queued = queueItem(record.id)
    const lastAttemptAt = '2026-08-28T18:00:00.000Z'

    try {
      await repository.saveAttendanceWithQueue([record], [queued])
      await repository.failQueueItem(
        queued,
        'No se pudo sincronizar esta operación',
        {
          errorCode: 'P0001',
          diagnosticError:
            'Attendance already belongs to a confirmed payment · PIN=123456',
          lastAttemptAt,
        },
      )

      await expect(database.syncQueue.get(queued.id)).resolves.toMatchObject({
        errorCode: 'P0001',
        diagnosticError: expect.stringContaining(
          'Attendance already belongs to a confirmed payment',
        ),
        lastAttemptAt,
      })
      const saved = await database.syncQueue.get(queued.id)
      expect(saved?.diagnosticError).not.toContain('123456')
    } finally {
      database.close()
      await database.delete()
    }
  })
})

describe('OperationsRepository purchase cache protection', () => {
  it('keeps queued store purchases when administrative cache is cleared', async () => {
    const database = new OperationsDatabase(
      `operations-test-${crypto.randomUUID()}`,
    )
    const repository = new OperationsRepository(database)
    const pending = paidPurchase('purchase-pending', 'pending')
    const synced = paidPurchase('purchase-synced', 'synced')

    try {
      await repository.saveSupplier({
        id: 'supplier-id',
        name: 'Bimbo',
        isActive: true,
        createdBy: 'user-id',
        createdAt: '2026-08-17T12:00:00.000Z',
        updatedAt: '2026-08-17T12:00:00.000Z',
      })
      await repository.savePaidPurchaseWithQueue(
        pending.purchase,
        pending.payment,
        purchaseQueueItem(pending.purchase.id),
      )
      await repository.saveConfirmedPaidPurchase(
        synced.purchase,
        synced.payment,
      )

      await repository.clearAdministrativePaymentData()

      await expect(repository.listPaidPurchases()).resolves.toMatchObject([
        { purchase: { id: pending.purchase.id } },
      ])
      await expect(repository.listSuppliers()).resolves.toEqual([])
      await expect(repository.countPendingQueue()).resolves.toBe(1)
    } finally {
      database.close()
      await database.delete()
    }
  })
})

describe('OperationsRepository cash closing cache', () => {
  it('filters cached closings by store and inclusive date range', async () => {
    const database = new OperationsDatabase(
      `operations-test-${crypto.randomUUID()}`,
    )
    const repository = new OperationsRepository(database)

    try {
      await repository.replaceCachedCashClosingsForScope([
        cachedClosing('north-new', 'north', '2026-08-12'),
        cachedClosing('north-old', 'north', '2026-08-01'),
        cachedClosing('center', 'center', '2026-08-12'),
      ])

      await expect(
        repository.listCachedCashClosings('north', '2026-08-10', '2026-08-12'),
      ).resolves.toMatchObject([{ id: 'north-new' }])
      await expect(
        repository.listCachedCashClosings(undefined, '2026-08-12'),
      ).resolves.toMatchObject([{ id: 'center' }, { id: 'north-new' }])
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('replaces only the requested cache scope and protects detail by store', async () => {
    const database = new OperationsDatabase(
      `operations-test-${crypto.randomUUID()}`,
    )
    const repository = new OperationsRepository(database)
    const north = cachedClosing('north', 'north', '2026-08-12')
    const center = cachedClosing('center', 'center', '2026-08-12')

    try {
      await repository.replaceCachedCashClosingsForScope([north, center])
      await repository.saveCachedCashClosingDetail(cachedDetail(north))

      await repository.replaceCachedCashClosingsForScope(
        [cachedClosing('north-refresh', 'north', '2026-08-12')],
        'north',
        '2026-08-12',
      )

      await expect(repository.listCachedCashClosings()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'north-refresh' }),
          expect.objectContaining({ id: 'center' }),
        ]),
      )
      await expect(
        repository.getCachedCashClosingDetail(north.id, 'north'),
      ).resolves.toBeDefined()
      await expect(
        repository.getCachedCashClosingDetail(north.id, 'center'),
      ).resolves.toBeUndefined()
    } finally {
      database.close()
      await database.delete()
    }
  })
})
