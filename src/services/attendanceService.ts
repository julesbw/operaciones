import type {
  AttendanceInput,
  AttendanceRecord,
  SyncQueueItem,
} from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'

class AttendanceService {
  list(storeId: string, attendanceDate: string) {
    return operationsRepository.listAttendance(storeId, attendanceDate)
  }

  async save(
    inputs: AttendanceInput[],
    userId: string,
  ): Promise<AttendanceRecord[]> {
    const now = new Date().toISOString()
    const existingRecords = await operationsRepository.listAttendance(
      inputs[0]?.storeId ?? '',
      inputs[0]?.attendanceDate ?? '',
    )
    const existingByCollaborator = new Map(
      existingRecords.map((record) => [record.collaboratorId, record]),
    )

    const records = inputs.map<AttendanceRecord>((input) => {
      const existing = existingByCollaborator.get(input.collaboratorId)
      return {
        ...input,
        id: existing?.id ?? crypto.randomUUID(),
        recordedBy: userId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        version: existing?.version ?? 0,
        syncStatus: 'pending',
      }
    })
    const queueItems = records.map<SyncQueueItem>((record) => ({
      id: `attendance:${record.id}`,
      entityType: 'attendance',
      entityId: record.id,
      operation: existingByCollaborator.has(record.collaboratorId)
        ? 'update'
        : 'insert',
      createdAt: now,
      attempts: 0,
    }))

    await operationsRepository.saveAttendanceWithQueue(records, queueItems)
    return records
  }
}

export const attendanceService = new AttendanceService()
