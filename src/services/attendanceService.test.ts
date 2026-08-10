import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { OperationsDatabase } from '../db/database'
import type { AttendanceRecord } from '../domain/models'
import { OperationsRepository } from '../repositories/operationsRepository'
import { AttendanceService } from './attendanceService'

describe('AttendanceService multi-store saves', () => {
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
})
