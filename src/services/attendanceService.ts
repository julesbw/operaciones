import type {
  AttendanceInput,
  AttendanceRecord,
  SyncQueueItem,
} from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'
import { getOperationalDate } from '../utils/date'

export class AttendanceService {
  constructor(private readonly repository = operationsRepository) {}

  list(storeId: string | undefined, attendanceDate: string) {
    return this.repository.listAttendance(storeId, attendanceDate)
  }

  async save(
    inputs: AttendanceInput[],
    userId: string,
    today = getOperationalDate(),
  ): Promise<AttendanceRecord[]> {
    if (inputs.length === 0) return []

    const now = new Date().toISOString()
    const attendanceDate = inputs[0]!.attendanceDate
    if (attendanceDate > today) {
      throw new Error('FUTURE_ATTENDANCE_NOT_ALLOWED')
    }
    if (inputs.some((input) => input.attendanceDate !== attendanceDate)) {
      throw new Error('Todas las asistencias deben corresponder a la misma fecha')
    }
    const existingRecords = await this.repository.listAttendance(
      undefined,
      attendanceDate,
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

    await this.repository.saveAttendanceWithQueue(records, queueItems)
    return records
  }
}

export const attendanceService = new AttendanceService()
