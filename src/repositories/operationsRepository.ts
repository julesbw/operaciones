import { db, type OperationsDatabase } from '../db/database'
import type {
  AttendanceRecord,
  CashClosingDraft,
  Collaborator,
  Expense,
  MerchandiseTransfer,
  Store,
  SyncEntity,
  SyncQueueItem,
  SyncStatus,
} from '../domain/models'

export class OperationsRepository {
  constructor(private readonly database: OperationsDatabase = db) {}

  listStores(): Promise<Store[]> {
    return this.database.stores.orderBy('name').toArray()
  }

  saveStores(stores: Store[]): Promise<void> {
    return this.database.stores.bulkPut(stores).then(() => undefined)
  }

  async updateStore(id: string, changes: Partial<Store>): Promise<void> {
    const updated = await this.database.stores.update(id, changes)
    if (updated === 0) throw new Error('La tienda ya no existe')
  }

  saveStore(store: Store): Promise<string> {
    return this.database.stores.put(store)
  }

  listCollaborators(storeId?: string): Promise<Collaborator[]> {
    if (storeId) {
      return this.database.collaborators
        .where('[storeId+status]')
        .equals([storeId, 'active'])
        .sortBy('name')
    }

    return this.database.collaborators
      .filter((collaborator) => collaborator.status === 'active')
      .sortBy('name')
  }

  saveCollaborators(collaborators: Collaborator[]): Promise<void> {
    return this.database.collaborators
      .bulkPut(collaborators)
      .then(() => undefined)
  }

  async replaceReferenceData(
    stores: Store[],
    collaborators: Collaborator[],
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.stores,
      this.database.collaborators,
      async () => {
        await Promise.all([
          this.database.stores.clear(),
          this.database.collaborators.clear(),
        ])
        await Promise.all([
          this.database.stores.bulkPut(stores),
          this.database.collaborators.bulkPut(collaborators),
        ])
      },
    )
  }

  async listExpenses(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<Expense[]> {
    const items = storeId
      ? await this.database.expenses.where('storeId').equals(storeId).toArray()
      : await this.database.expenses.toArray()

    return items
      .filter((expense) => {
        if (dateFrom && expense.businessDate < dateFrom) return false
        if (dateTo && expense.businessDate > dateTo) return false
        return true
      })
      // ES2022 is the current target, so Array#toSorted is not available yet.
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort(
        (left, right) =>
          right.businessDate.localeCompare(left.businessDate) ||
          right.createdAt.localeCompare(left.createdAt),
      )
  }

  getExpense(id: string): Promise<Expense | undefined> {
    return this.database.expenses.get(id)
  }

  async saveRemoteExpenses(expenses: Expense[]): Promise<void> {
    const queued = await this.database.syncQueue
      .where('entityType')
      .equals('expense')
      .toArray()
    const pendingIds = new Set(queued.map((item) => item.entityId))
    await this.database.expenses.bulkPut(
      expenses.filter((expense) => !pendingIds.has(expense.id)),
    )
  }

  async saveExpenseWithQueue(
    expense: Expense,
    queueItem: SyncQueueItem,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.expenses,
      this.database.syncQueue,
      async () => {
        await this.database.expenses.put(expense)
        await this.database.syncQueue.put(queueItem)
      },
    )
  }

  async listMerchandiseTransfers(
    originStoreId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<MerchandiseTransfer[]> {
    const items = originStoreId
      ? await this.database.merchandiseTransfers
          .where('originStoreId')
          .equals(originStoreId)
          .toArray()
      : await this.database.merchandiseTransfers.toArray()

    return items
      .filter((transfer) => {
        if (dateFrom && transfer.businessDate < dateFrom) return false
        if (dateTo && transfer.businessDate > dateTo) return false
        return true
      })
      // ES2022 is the current target, so Array#toSorted is not available yet.
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort(
        (left, right) =>
          right.businessDate.localeCompare(left.businessDate) ||
          right.createdAt.localeCompare(left.createdAt),
      )
  }

  getMerchandiseTransfer(
    id: string,
  ): Promise<MerchandiseTransfer | undefined> {
    return this.database.merchandiseTransfers.get(id)
  }

  async saveRemoteMerchandiseTransfers(
    transfers: MerchandiseTransfer[],
  ): Promise<void> {
    const queued = await this.database.syncQueue
      .where('entityType')
      .equals('merchandiseTransfer')
      .toArray()
    const pendingIds = new Set(queued.map((item) => item.entityId))
    await this.database.merchandiseTransfers.bulkPut(
      transfers.filter((transfer) => !pendingIds.has(transfer.id)),
    )
  }

  async saveMerchandiseTransferWithQueue(
    transfer: MerchandiseTransfer,
    queueItem: SyncQueueItem,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.merchandiseTransfers,
      this.database.syncQueue,
      async () => {
        await this.database.merchandiseTransfers.put(transfer)
        await this.database.syncQueue.put(queueItem)
      },
    )
  }

  async saveAttendanceWithQueue(
    records: AttendanceRecord[],
    queueItems: SyncQueueItem[],
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.attendanceRecords,
      this.database.syncQueue,
      async () => {
        await this.database.attendanceRecords.bulkPut(records)
        await this.database.syncQueue.bulkPut(queueItems)
      },
    )
  }

  listAttendance(
    storeId: string | undefined,
    attendanceDate: string,
  ): Promise<AttendanceRecord[]> {
    if (!storeId) {
      return this.database.attendanceRecords
        .where('attendanceDate')
        .equals(attendanceDate)
        .toArray()
    }

    return this.database.attendanceRecords
      .where('[storeId+attendanceDate]')
      .equals([storeId, attendanceDate])
      .toArray()
  }

  getAttendance(id: string): Promise<AttendanceRecord | undefined> {
    return this.database.attendanceRecords.get(id)
  }

  async saveRemoteAttendance(records: AttendanceRecord[]): Promise<void> {
    const queued = await this.database.syncQueue
      .where('entityType')
      .equals('attendance')
      .toArray()
    const pendingIds = new Set(queued.map((item) => item.entityId))
    const pendingRecords = await this.database.attendanceRecords.bulkGet([
      ...pendingIds,
    ])
    const pendingKeys = new Set(
      pendingRecords
        .filter((record): record is AttendanceRecord => Boolean(record))
        .map(
          (record) =>
            `${record.collaboratorId}:${record.attendanceDate}`,
        ),
    )
    await this.database.attendanceRecords.bulkPut(
      records.filter(
        (record) =>
          !pendingIds.has(record.id) &&
          !pendingKeys.has(
            `${record.collaboratorId}:${record.attendanceDate}`,
          ),
      ),
    )
  }

  listPendingQueue(): Promise<SyncQueueItem[]> {
    return this.database.syncQueue.orderBy('createdAt').toArray()
  }

  countPendingQueue(): Promise<number> {
    return this.database.syncQueue.count()
  }

  async markEntitySyncStatus(
    entityType: SyncEntity,
    entityId: string,
    status: SyncStatus,
    version?: number,
  ): Promise<void> {
    if (entityType === 'expense') {
      await this.database.expenses.update(entityId, {
        syncStatus: status,
        ...(version === undefined ? {} : { version }),
      })
    } else if (entityType === 'attendance') {
      await this.database.attendanceRecords.update(entityId, {
        syncStatus: status,
        ...(version === undefined ? {} : { version }),
      })
    } else {
      await this.database.merchandiseTransfers.update(entityId, {
        syncStatus: status,
        ...(version === undefined ? {} : { version }),
      })
    }
  }

  async completeQueueItem(
    item: SyncQueueItem,
    remoteVersion: number,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.expenses,
      this.database.attendanceRecords,
      this.database.merchandiseTransfers,
      this.database.syncQueue,
      async () => {
        const current = await this.database.syncQueue.get(item.id)
        const isSameWrite = current?.createdAt === item.createdAt
        await this.markEntitySyncStatus(
          item.entityType,
          item.entityId,
          isSameWrite ? 'synced' : 'pending',
          remoteVersion,
        )
        if (isSameWrite) await this.database.syncQueue.delete(item.id)
      },
    )
  }

  async failQueueItem(item: SyncQueueItem, message: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.expenses,
      this.database.attendanceRecords,
      this.database.merchandiseTransfers,
      this.database.syncQueue,
      async () => {
        const current = await this.database.syncQueue.get(item.id)
        if (current?.createdAt !== item.createdAt) return

        const attempts = item.attempts + 1
        const delaySeconds = Math.min(300, 2 ** attempts)
        const nextAttemptAt = new Date(
          Date.now() + delaySeconds * 1_000,
        ).toISOString()
        await this.database.syncQueue.update(item.id, {
          attempts,
          lastError: message,
          nextAttemptAt,
        })
        await this.markEntitySyncStatus(
          item.entityType,
          item.entityId,
          'error',
        )
      },
    )
  }

  getClosingDraft(
    storeId: string,
    businessDate: string,
  ): Promise<CashClosingDraft | undefined> {
    return this.database.closingDrafts
      .where('[storeId+businessDate]')
      .equals([storeId, businessDate])
      .first()
  }

  saveClosingDraft(draft: CashClosingDraft): Promise<string> {
    return this.database.closingDrafts.put(draft)
  }

  deleteClosingDraft(id: string): Promise<void> {
    return this.database.closingDrafts.delete(id)
  }
}

export const operationsRepository = new OperationsRepository()
