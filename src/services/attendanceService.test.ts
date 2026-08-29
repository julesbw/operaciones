import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { OperationsDatabase } from '../db/database'
import type {
  AttendanceRecord,
  Collaborator,
  PaymentAttendanceItem,
} from '../domain/models'
import { OperationsRepository } from '../repositories/operationsRepository'
import { AttendanceService } from './attendanceService'

describe('AttendanceService multi-store saves', () => {
  it('does not rewrite or enqueue records whose status did not change', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const service = new AttendanceService(repository)
    const timestamp = '2026-08-09T12:00:00.000Z'
    const existing: AttendanceRecord = {
      id: 'unchanged-attendance',
      collaboratorId: 'collaborator-id',
      storeId: 'store-id',
      attendanceDate: '2026-08-09',
      status: 'present',
      recordedBy: 'admin-id',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 2,
      syncStatus: 'synced',
    }

    try {
      await database.attendanceRecords.put(existing)

      await expect(
        service.save(
          [
            {
              collaboratorId: existing.collaboratorId,
              storeId: existing.storeId,
              attendanceDate: existing.attendanceDate,
              status: existing.status,
            },
          ],
          existing.recordedBy,
          existing.attendanceDate,
        ),
      ).resolves.toEqual([])
      await expect(database.syncQueue.count()).resolves.toBe(0)
      await expect(database.attendanceRecords.get(existing.id)).resolves.toEqual(
        existing,
      )
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('writes and queues only the rows whose status changed', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const service = new AttendanceService(repository)
    const timestamp = '2026-08-09T12:00:00.000Z'
    const unchanged: AttendanceRecord = {
      id: 'unchanged-attendance',
      collaboratorId: 'collaborator-unchanged',
      storeId: 'store-id',
      attendanceDate: '2026-08-09',
      status: 'present',
      recordedBy: 'admin-id',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      syncStatus: 'synced',
    }
    const changed: AttendanceRecord = {
      ...unchanged,
      id: 'changed-attendance',
      collaboratorId: 'collaborator-changed',
      status: 'present',
    }

    try {
      await database.attendanceRecords.bulkPut([unchanged, changed])

      await expect(
        service.save(
          [
            {
              collaboratorId: unchanged.collaboratorId,
              storeId: unchanged.storeId,
              attendanceDate: unchanged.attendanceDate,
              status: 'present',
            },
            {
              collaboratorId: changed.collaboratorId,
              storeId: changed.storeId,
              attendanceDate: changed.attendanceDate,
              status: 'absent',
            },
          ],
          'admin-id',
          changed.attendanceDate,
        ),
      ).resolves.toMatchObject([
        { id: changed.id, collaboratorId: changed.collaboratorId, status: 'absent' },
      ])

      await expect(repository.listPendingQueue()).resolves.toMatchObject([
        {
          entityId: changed.id,
          operation: 'update',
        },
      ])
      await expect(repository.listPendingQueue()).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ entityId: unchanged.id })]),
      )
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('does not create a local update for a paid attendance', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const service = new AttendanceService(repository)
    const existing: AttendanceRecord = {
      id: 'paid-attendance',
      collaboratorId: 'paid-collaborator',
      storeId: 'store-id',
      attendanceDate: '2026-08-09',
      status: 'absent',
      recordedBy: 'admin-id',
      createdAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:00:00.000Z',
      version: 2,
      syncStatus: 'synced',
    }
    const paymentItem: PaymentAttendanceItem = {
      paymentId: 'payment-id',
      attendanceId: existing.id,
      workDateSnapshot: existing.attendanceDate,
      periodStart: '2026-08-03',
      periodEnd: '2026-08-09',
      weeklyPaySnapshot: 1_000,
      dailyPaySnapshot: 166,
      suggestedAllocation: 166,
      createdAt: '2026-08-10T12:00:00.000Z',
    }

    try {
      await database.attendanceRecords.put(existing)
      await database.paymentAttendanceItems.put(paymentItem)

      await expect(
        service.save(
          [
            {
              collaboratorId: existing.collaboratorId,
              storeId: existing.storeId,
              attendanceDate: existing.attendanceDate,
              status: 'present',
            },
          ],
          existing.recordedBy,
          existing.attendanceDate,
        ),
      ).resolves.toEqual([])
      await expect(database.syncQueue.count()).resolves.toBe(0)
      await expect(database.attendanceRecords.get(existing.id)).resolves.toEqual(
        existing,
      )
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('reuses existing records from every store in the global view', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const service = new AttendanceService(repository)
    const timestamp = '2026-08-09T12:00:00.000Z'
    const existing: AttendanceRecord = {
      id: 'existing-north-attendance',
      collaboratorId: 'north-carlos',
      storeId: 'north',
      attendanceDate: '2026-08-09',
      status: 'present',
      recordedBy: 'admin-id',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      syncStatus: 'synced',
    }

    try {
      await database.attendanceRecords.put(existing)

      await service.save(
        [
          {
            collaboratorId: 'center-ana',
            storeId: 'center',
            attendanceDate: '2026-08-09',
            status: 'present',
          },
          {
            collaboratorId: 'north-carlos',
            storeId: 'north',
            attendanceDate: '2026-08-09',
            status: 'absent',
          },
        ],
        'admin-id',
      )

      await expect(
        repository.listAttendance('north', '2026-08-09'),
      ).resolves.toMatchObject([
        { id: existing.id, collaboratorId: 'north-carlos', status: 'absent' },
      ])
      await expect(
        repository.listAttendance('center', '2026-08-09'),
      ).resolves.toMatchObject([
        { collaboratorId: 'center-ana', status: 'present' },
      ])
      await expect(repository.listPendingQueue()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityId: existing.id,
            operation: 'update',
          }),
        ]),
      )
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('rejects future attendance before writing to Dexie', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const service = new AttendanceService(repository)

    try {
      await expect(
        service.save(
          [
            {
              collaboratorId: 'collaborator-id',
              storeId: 'store-id',
              attendanceDate: '2026-08-14',
              status: 'present',
            },
          ],
          'admin-id',
          '2026-08-13',
        ),
      ).rejects.toThrow('FUTURE_ATTENDANCE_NOT_ALLOWED')
      await expect(database.attendanceRecords.count()).resolves.toBe(0)
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('rejects new attendance for an inactive collaborator', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const service = new AttendanceService(repository)
    const collaborator: Collaborator = {
      id: 'inactive-collaborator',
      name: 'Colaborador inactivo',
      storeId: 'store-id',
      restDay: 0,
      payCycleEndWeekday: 6,
      status: 'inactive',
      weeklyPay: 1_000,
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-10T12:00:00.000Z',
    }

    try {
      await repository.saveCollaborators([collaborator])

      await expect(
        service.save(
          [
            {
              collaboratorId: collaborator.id,
              storeId: collaborator.storeId,
              attendanceDate: '2026-08-10',
              status: 'present',
            },
          ],
          'admin-id',
          '2026-08-10',
        ),
      ).rejects.toThrow('COLLABORATOR_INACTIVE')
      await expect(database.attendanceRecords.count()).resolves.toBe(0)
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('does not attribute a legacy attendance record to the active operator', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)
    const service = new AttendanceService(repository)
    const existing: AttendanceRecord = {
      id: 'legacy-attendance',
      collaboratorId: 'collaborator-id',
      storeId: 'store-id',
      attendanceDate: '2026-08-10',
      status: 'present',
      recordedBy: 'technical-user',
      operatorAccountId: null,
      createdAt: '2026-08-10T12:00:00.000Z',
      updatedAt: '2026-08-10T12:00:00.000Z',
      version: 1,
      syncStatus: 'synced',
    }

    try {
      await database.attendanceRecords.put(existing)

      await expect(
        service.save(
          [{
            collaboratorId: existing.collaboratorId,
            storeId: existing.storeId,
            attendanceDate: existing.attendanceDate,
            status: 'absent',
          }],
          existing.recordedBy,
          existing.attendanceDate,
          'active-operator',
        ),
      ).rejects.toThrow('sin identidad operativa')
      await expect(database.syncQueue.count()).resolves.toBe(0)
      await expect(database.attendanceRecords.get(existing.id)).resolves.toEqual(
        existing,
      )
    } finally {
      database.close()
      await database.delete()
    }
  })
})
