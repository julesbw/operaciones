import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { OperationsDatabase } from '../db/database'
import type {
  AttendanceRecord,
  Expense,
  MerchandiseTransfer,
  SyncQueueItem,
} from '../domain/models'
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

  it('counts only unsynced expenses and outgoing transfers for a closing', async () => {
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
        repository.countPendingClosingMovements('north', businessDate),
      ).resolves.toEqual({ expenses: 1, transfers: 1 })
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
