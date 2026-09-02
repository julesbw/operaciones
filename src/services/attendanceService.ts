import {
  getEffectiveAttendanceType,
  type AttendanceInput,
  type AttendanceRecord,
  type SyncQueueItem,
} from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'
import { OperatorAuthorizationError } from './operatorAuthorization'
import { getOperationalDate } from '../utils/date'
import { isPaidAttendanceImmutableError } from '../utils/syncError'

export class AttendanceService {
  constructor(private readonly repository = operationsRepository) {}

  list(storeId: string | undefined, attendanceDate: string) {
    return this.repository.listAttendance(storeId, attendanceDate)
  }

  async listPaidAttendanceIds(): Promise<Set<string>> {
    const [items, queueItems] = await Promise.all([
      this.repository.listPaymentAttendanceItems(),
      this.repository.listPendingQueue(),
    ])
    return new Set([
      ...items.map((item) => item.attendanceId),
      ...queueItems
        .filter(
          (item) =>
            item.entityType === 'attendance' &&
            isPaidAttendanceImmutableError(item),
        )
        .map((item) => item.entityId),
    ])
  }

  async save(
    inputs: AttendanceInput[],
    userId: string,
    today = getOperationalDate(),
    operatorAccountId?: string | null,
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
    const changedInputs = inputs.filter((input) => {
      const existing = existingByCollaborator.get(input.collaboratorId)
      if (!existing) return true
      return (
        existing.status !== input.status ||
        getEffectiveAttendanceType(existing.status, existing.attendanceType) !==
          getEffectiveAttendanceType(input.status, input.attendanceType)
      )
    })
    if (changedInputs.length === 0) return []

    const paidAttendanceIds = await this.listPaidAttendanceIds()
    const editableInputs = changedInputs.filter((input) => {
      const existing = existingByCollaborator.get(input.collaboratorId)
      return !existing?.id || !paidAttendanceIds.has(existing.id)
    })
    if (editableInputs.length === 0) return []

    const collaborators = await Promise.all(
      editableInputs.map((input) =>
        this.repository.getCollaborator(input.collaboratorId),
      ),
    )
    if (
      collaborators.some(
        (collaborator) => collaborator && collaborator.status !== 'active',
      )
    ) {
      throw new Error('COLLABORATOR_INACTIVE')
    }
    if (operatorAccountId) {
      for (const input of editableInputs) {
        const existing = existingByCollaborator.get(input.collaboratorId)
        if (existing && !existing.operatorAccountId) {
          throw new OperatorAuthorizationError(
            'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED',
          )
        }
        if (
          existing?.operatorAccountId &&
          existing.operatorAccountId !== operatorAccountId
        ) {
          throw new OperatorAuthorizationError(
            'OPERATOR_CAPABILITY_FORBIDDEN',
          )
        }
      }
    }

    const records = editableInputs.map<AttendanceRecord>((input) => {
      const existing = existingByCollaborator.get(input.collaboratorId)
      return {
        id: existing?.id ?? crypto.randomUUID(),
        collaboratorId: input.collaboratorId,
        storeId: input.storeId,
        attendanceDate: input.attendanceDate,
        status: input.status,
        attendanceType: getEffectiveAttendanceType(
          input.status,
          input.attendanceType,
        ),
        recordedBy: userId,
        operatorAccountId: operatorAccountId ?? existing?.operatorAccountId ?? null,
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
      operatorAccountId: operatorAccountId ?? null,
    }))

    await this.repository.saveAttendanceWithQueue(records, queueItems)
    return records
  }
}

export const attendanceService = new AttendanceService()
