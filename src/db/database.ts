import Dexie, { type Table } from 'dexie'
import type {
  AttendanceRecord,
  CashClosingDraft,
  Collaborator,
  Expense,
  Store,
  SyncQueueItem,
} from '../domain/models'

export const OPERATIONS_DATABASE_NAME = 'operaciones-db'

export class OperationsDatabase extends Dexie {
  stores!: Table<Store, string>
  collaborators!: Table<Collaborator, string>
  attendanceRecords!: Table<AttendanceRecord, string>
  expenses!: Table<Expense, string>
  syncQueue!: Table<SyncQueueItem, string>
  closingDrafts!: Table<CashClosingDraft, string>

  constructor(databaseName = OPERATIONS_DATABASE_NAME) {
    super(databaseName)

    const schemaV1 = {
      stores: '&id, status, updatedAt',
      collaborators: '&id, storeId, [storeId+status], updatedAt',
      attendanceRecords:
        '&id, collaboratorId, storeId, attendanceDate, &[collaboratorId+attendanceDate], [storeId+attendanceDate], syncStatus',
      expenses:
        '&id, storeId, businessDate, [storeId+businessDate], syncStatus, createdAt',
      syncQueue:
        '&id, &[entityType+entityId], entityType, createdAt, nextAttemptAt',
      closingDrafts: '&id, &[storeId+businessDate], updatedAt',
    }
    const schemaV3 = {
      ...schemaV1,
      stores: '&id, name, status, updatedAt',
    }

    this.version(1).stores(schemaV1)
    this.version(2)
      .stores(schemaV1)
      .upgrade(async (transaction) => {
        await transaction
          .table<Expense, string>('expenses')
          .toCollection()
          .modify((expense) => {
            expense.version ??= 0
          })
        await transaction
          .table<AttendanceRecord, string>('attendanceRecords')
          .toCollection()
          .modify((attendance) => {
            attendance.version ??= 0
          })
      })
    this.version(3).stores(schemaV3)
  }
}

export const db = new OperationsDatabase()
