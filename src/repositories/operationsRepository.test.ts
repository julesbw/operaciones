import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { OperationsDatabase } from '../db/database'
import type { AttendanceRecord, SyncQueueItem } from '../domain/models'
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
