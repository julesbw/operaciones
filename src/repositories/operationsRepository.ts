import { db, type OperationsDatabase } from '../db/database'
import type { ExportBatch, ExportCandidate } from '../domain/exportContract'
import type {
  AttendanceRecord,
  CashClosingDraft,
  CentralCashMovement,
  CentralCashPendingClosing,
  CentralCashSummary,
  Collaborator,
  CollaboratorCompensationHistory,
  Expense,
  LocalAppContext,
  MerchandiseTransfer,
  PaidPurchase,
  Payment,
  PaymentAttendanceItem,
  Purchase,
  PurchasePayment,
  Store,
  Supplier,
  SyncEntity,
  SyncQueueItem,
  SyncStatus,
} from '../domain/models'

export class OperationsRepository {
  constructor(private readonly database: OperationsDatabase = db) {}

  listStores(): Promise<Store[]> {
    return this.database.stores.orderBy('name').toArray()
  }

  getLocalAppContext(): Promise<LocalAppContext | undefined> {
    return this.database.appContexts.get('current')
  }

  saveLocalAppContext(context: LocalAppContext): Promise<string> {
    return this.database.appContexts.put(context)
  }

  async updateLocalAppContext(
    changes: Partial<Omit<LocalAppContext, 'id' | 'userId'>>,
  ): Promise<void> {
    const updated = await this.database.appContexts.update('current', changes)
    if (updated === 0) throw new Error('No existe un contexto local inicializado')
  }

  async clearCachedIdentityData(): Promise<void> {
    await this.database.transaction(
      'rw',
      [
        this.database.stores,
        this.database.collaborators,
        this.database.attendanceRecords,
        this.database.expenses,
        this.database.merchandiseTransfers,
        this.database.suppliers,
        this.database.purchases,
        this.database.purchasePayments,
        this.database.syncQueue,
        this.database.closingDrafts,
        this.database.appContexts,
        this.database.payments,
        this.database.paymentAttendanceItems,
        this.database.compensationHistory,
        this.database.exportCandidates,
        this.database.exportBatches,
        this.database.centralCashMovements,
        this.database.centralCashPendingClosings,
        this.database.centralCashSummary,
      ],
      async () => {
        await Promise.all([
          this.database.stores.clear(),
          this.database.collaborators.clear(),
          this.database.attendanceRecords.clear(),
          this.database.expenses.clear(),
          this.database.merchandiseTransfers.clear(),
          this.database.suppliers.clear(),
          this.database.purchases.clear(),
          this.database.purchasePayments.clear(),
          this.database.syncQueue.clear(),
          this.database.closingDrafts.clear(),
          this.database.appContexts.clear(),
          this.database.payments.clear(),
          this.database.paymentAttendanceItems.clear(),
          this.database.compensationHistory.clear(),
          this.database.exportCandidates.clear(),
          this.database.exportBatches.clear(),
          this.database.centralCashMovements.clear(),
          this.database.centralCashPendingClosings.clear(),
          this.database.centralCashSummary.clear(),
        ])
      },
    )
  }

  async getLocalProtectionSummary(): Promise<{
    protectedCount: number
    ownerIds: string[]
    unresolvedCount: number
  }> {
    const [queue, drafts] = await Promise.all([
      this.database.syncQueue.toArray(),
      this.database.closingDrafts.toArray(),
    ])
    const queuedOwners = await Promise.all(
      queue.map(async (item) => {
        if (item.entityType === 'expense') {
          return (await this.database.expenses.get(item.entityId))?.createdBy
        }
        if (item.entityType === 'attendance') {
          return (await this.database.attendanceRecords.get(item.entityId))
            ?.recordedBy
        }
        if (item.entityType === 'purchase') {
          return (await this.database.purchases.get(item.entityId))?.createdBy
        }
        return (
          await this.database.merchandiseTransfers.get(item.entityId)
        )?.createdBy
      }),
    )
    const owners = [
      ...queuedOwners,
      ...drafts.map((draft) => draft.createdBy || undefined),
    ]

    return {
      protectedCount: queue.length + drafts.length,
      ownerIds: [...new Set(owners.filter((owner): owner is string => Boolean(owner)))],
      unresolvedCount: owners.filter((owner) => !owner).length,
    }
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

  async listSuppliers(activeOnly = false): Promise<Supplier[]> {
    const suppliers = await this.database.suppliers.orderBy('name').toArray()
    return activeOnly
      ? suppliers.filter((supplier) => supplier.isActive)
      : suppliers
  }

  getSupplier(id: string): Promise<Supplier | undefined> {
    return this.database.suppliers.get(id)
  }

  saveSupplier(supplier: Supplier): Promise<string> {
    return this.database.suppliers.put(supplier)
  }

  saveSuppliers(suppliers: Supplier[]): Promise<void> {
    return this.database.suppliers.bulkPut(suppliers).then(() => undefined)
  }

  async replaceSuppliers(suppliers: Supplier[]): Promise<void> {
    await this.database.transaction('rw', this.database.suppliers, async () => {
      await this.database.suppliers.clear()
      await this.database.suppliers.bulkPut(suppliers)
    })
  }

  listCollaborators(
    storeId?: string,
    includeInactive = false,
  ): Promise<Collaborator[]> {
    if (storeId) {
      if (includeInactive) {
        return this.database.collaborators
          .where('storeId')
          .equals(storeId)
          .sortBy('name')
      }
      return this.database.collaborators
        .where('[storeId+status]')
        .equals([storeId, 'active'])
        .sortBy('name')
    }

    if (includeInactive) {
      return this.database.collaborators.toArray().then((collaborators) =>
        // oxlint-disable-next-line unicorn/no-array-sort
        collaborators.sort((left, right) => left.name.localeCompare(right.name)),
      )
    }
    return this.database.collaborators
      .filter((collaborator) => collaborator.status === 'active')
      .sortBy('name')
  }

  getCollaborator(id: string): Promise<Collaborator | undefined> {
    return this.database.collaborators.get(id)
  }

  saveCollaborators(collaborators: Collaborator[]): Promise<void> {
    return this.database.collaborators
      .bulkPut(collaborators)
      .then(() => undefined)
  }

  saveCompensationHistory(
    history: CollaboratorCompensationHistory[],
  ): Promise<void> {
    return this.database.compensationHistory
      .bulkPut(history)
      .then(() => undefined)
  }

  listCompensationHistory(
    collaboratorId?: string,
  ): Promise<CollaboratorCompensationHistory[]> {
    if (collaboratorId) {
      return this.database.compensationHistory
        .where('collaboratorId')
        .equals(collaboratorId)
        .sortBy('effectiveFrom')
    }
    return this.database.compensationHistory.orderBy('effectiveFrom').toArray()
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

  async listAttendanceForPayments(
    collaboratorId?: string,
  ): Promise<AttendanceRecord[]> {
    const records = collaboratorId
      ? await this.database.attendanceRecords
          .where('collaboratorId')
          .equals(collaboratorId)
          .toArray()
      : await this.database.attendanceRecords.toArray()

    return records
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort((left, right) =>
        right.attendanceDate.localeCompare(left.attendanceDate),
      )
  }

  savePayments(payments: Payment[]): Promise<void> {
    return this.database.payments.bulkPut(payments).then(() => undefined)
  }

  savePaymentAttendanceItems(items: PaymentAttendanceItem[]): Promise<void> {
    return this.database.paymentAttendanceItems
      .bulkPut(items)
      .then(() => undefined)
  }

  async saveConfirmedPayment(
    payment: Payment,
    items: PaymentAttendanceItem[],
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.payments,
      this.database.paymentAttendanceItems,
      async () => {
        await this.database.payments.put(payment)
        await this.database.paymentAttendanceItems.bulkPut(items)
      },
    )
  }

  async listPayments(): Promise<Payment[]> {
    // Dexie Collection#reverse changes index traversal, not an Array instance.
    // oxlint-disable-next-line unicorn/no-array-reverse
    return this.database.payments.orderBy('paidAt').reverse().toArray()
  }

  async listStoreCashPayments(
    sourceStoreId: string,
    businessDate: string,
  ): Promise<Payment[]> {
    const payments = await this.database.payments
      .where('[sourceStoreId+businessDate]')
      .equals([sourceStoreId, businessDate])
      .toArray()
    return payments.filter(
      (payment) => payment.fundingSource === 'store_cash',
    )
  }

  getPayment(id: string): Promise<Payment | undefined> {
    return this.database.payments.get(id)
  }

  listPaymentAttendanceItems(
    paymentId?: string,
  ): Promise<PaymentAttendanceItem[]> {
    if (paymentId) {
      return this.database.paymentAttendanceItems
        .where('paymentId')
        .equals(paymentId)
        .sortBy('workDateSnapshot')
    }
    return this.database.paymentAttendanceItems.toArray()
  }

  async replaceRemotePaymentData(
    payments: Payment[],
    items: PaymentAttendanceItem[],
    history: CollaboratorCompensationHistory[],
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.payments,
      this.database.paymentAttendanceItems,
      this.database.compensationHistory,
      async () => {
        await Promise.all([
          this.database.payments.clear(),
          this.database.paymentAttendanceItems.clear(),
          this.database.compensationHistory.clear(),
        ])
        await Promise.all([
          this.database.payments.bulkPut(payments),
          this.database.paymentAttendanceItems.bulkPut(items),
          this.database.compensationHistory.bulkPut(history),
        ])
      },
    )
  }

  async clearAdministrativePaymentData(): Promise<void> {
    await this.database.transaction(
      'rw',
      [
        this.database.payments,
        this.database.paymentAttendanceItems,
        this.database.compensationHistory,
        this.database.exportCandidates,
        this.database.exportBatches,
        this.database.centralCashMovements,
        this.database.centralCashPendingClosings,
        this.database.centralCashSummary,
        this.database.suppliers,
        this.database.purchases,
        this.database.purchasePayments,
        this.database.syncQueue,
      ],
      async () => {
        const queuedPurchases = await this.database.syncQueue
          .where('entityType')
          .equals('purchase')
          .toArray()
        const pendingPurchaseIds = new Set(
          queuedPurchases.map((item) => item.entityId),
        )
        const removablePurchases = (
          await this.database.purchases.toArray()
        ).filter((purchase) => !pendingPurchaseIds.has(purchase.id))
        const removablePurchaseIds = removablePurchases.map(
          (purchase) => purchase.id,
        )
        const removablePurchaseIdSet = new Set(removablePurchaseIds)
        const removablePaymentIds = (
          await this.database.purchasePayments.toArray()
        )
          .filter((payment) => removablePurchaseIdSet.has(payment.purchaseId))
          .map((payment) => payment.id)
        await Promise.all([
          this.database.payments.clear(),
          this.database.paymentAttendanceItems.clear(),
          this.database.compensationHistory.clear(),
          this.database.exportCandidates.clear(),
          this.database.exportBatches.clear(),
          this.database.centralCashMovements.clear(),
          this.database.centralCashPendingClosings.clear(),
          this.database.centralCashSummary.clear(),
          this.database.suppliers.clear(),
          this.database.purchases.bulkDelete(removablePurchaseIds),
          this.database.purchasePayments.bulkDelete(removablePaymentIds),
        ])
      },
    )
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

  async countPendingSelectedClosingMovements(
    expenseIds: readonly string[],
    transferIds: readonly string[],
    purchasePaymentIds: readonly string[] = [],
  ): Promise<{ expenses: number; transfers: number; purchases: number }> {
    const [expenses, transfers, purchasePayments] = await Promise.all([
      this.database.expenses.bulkGet([...expenseIds]),
      this.database.merchandiseTransfers.bulkGet([...transferIds]),
      this.database.purchasePayments.bulkGet([...purchasePaymentIds]),
    ])
    const purchases = await this.database.purchases.bulkGet(
      purchasePayments
        .filter((payment): payment is PurchasePayment => Boolean(payment))
        .map((payment) => payment.purchaseId),
    )

    return {
      expenses: expenses.filter(
        (expense) => expense && expense.syncStatus !== 'synced',
      ).length,
      transfers: transfers.filter(
        (transfer) => transfer && transfer.syncStatus !== 'synced',
      ).length,
      purchases: purchases.filter(
        (purchase) => purchase && purchase.syncStatus !== 'synced',
      ).length,
    }
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
    } else if (entityType === 'merchandiseTransfer') {
      await this.database.merchandiseTransfers.update(entityId, {
        syncStatus: status,
        ...(version === undefined ? {} : { version }),
      })
    } else {
      await this.database.purchases.update(entityId, { syncStatus: status })
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
      this.database.purchases,
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
      this.database.purchases,
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

  getClosingDraftById(id: string): Promise<CashClosingDraft | undefined> {
    return this.database.closingDrafts.get(id)
  }

  async listClosingDrafts(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<CashClosingDraft[]> {
    const drafts = storeId
      ? await this.database.closingDrafts.where('storeId').equals(storeId).toArray()
      : await this.database.closingDrafts.toArray()

    return drafts
      .filter((draft) => {
        if (dateFrom && draft.businessDate < dateFrom) return false
        if (dateTo && draft.businessDate > dateTo) return false
        return true
      })
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort(
        (left, right) =>
          right.businessDate.localeCompare(left.businessDate) ||
          right.updatedAt.localeCompare(left.updatedAt),
      )
  }

  saveClosingDraft(draft: CashClosingDraft): Promise<string> {
    return this.database.closingDrafts.put(draft)
  }

  deleteClosingDraft(id: string): Promise<void> {
    return this.database.closingDrafts.delete(id)
  }

  saveCentralCashSummary(summary: CentralCashSummary): Promise<string> {
    return this.database.centralCashSummary.put(summary)
  }

  getCentralCashSummary(): Promise<CentralCashSummary | undefined> {
    return this.database.centralCashSummary.get('current')
  }

  saveCentralCashMovement(movement: CentralCashMovement): Promise<string> {
    return this.database.centralCashMovements.put(movement)
  }

  async replaceCentralCashMovementsForScope(
    movements: CentralCashMovement[],
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.centralCashMovements,
      async () => {
        const existing = await this.database.centralCashMovements.toArray()
        const replacedIds = existing
          .filter((movement) => {
            if (storeId && movement.storeIdSnapshot !== storeId) return false
            if (dateFrom && movement.businessDate < dateFrom) return false
            if (dateTo && movement.businessDate > dateTo) return false
            return true
          })
          .map((movement) => movement.id)

        await this.database.centralCashMovements.bulkDelete(replacedIds)
        await this.database.centralCashMovements.bulkPut(movements)
      },
    )
  }

  getPurchase(id: string): Promise<Purchase | undefined> {
    return this.database.purchases.get(id)
  }

  getPurchasePaymentByPurchaseId(
    purchaseId: string,
  ): Promise<PurchasePayment | undefined> {
    return this.database.purchasePayments
      .where('purchaseId')
      .equals(purchaseId)
      .first()
  }

  async listPaidPurchases(options: {
    supplierId?: string
    fundingSource?: PurchasePayment['fundingSource']
    storeId?: string
    dateFrom?: string
    dateTo?: string
  } = {}): Promise<PaidPurchase[]> {
    const purchases = await this.database.purchases.toArray()
    const payments = await this.database.purchasePayments.toArray()
    const paymentByPurchase = new Map(
      payments.map((payment) => [payment.purchaseId, payment]),
    )

    return purchases
      .flatMap((purchase) => {
        const payment = paymentByPurchase.get(purchase.id)
        return payment ? [{ purchase, payment }] : []
      })
      .filter(({ purchase, payment }) => {
        if (options.supplierId && purchase.supplierId !== options.supplierId) {
          return false
        }
        if (
          options.fundingSource &&
          payment.fundingSource !== options.fundingSource
        ) {
          return false
        }
        if (options.storeId && payment.sourceStoreId !== options.storeId) {
          return false
        }
        if (options.dateFrom && purchase.businessDate < options.dateFrom) {
          return false
        }
        if (options.dateTo && purchase.businessDate > options.dateTo) {
          return false
        }
        return true
      })
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort(
        (left, right) =>
          right.purchase.businessDate.localeCompare(
            left.purchase.businessDate,
          ) || right.purchase.createdAt.localeCompare(left.purchase.createdAt),
      )
  }

  listStoreCashPurchases(
    storeId: string,
    businessDate: string,
  ): Promise<PaidPurchase[]> {
    return this.listPaidPurchases({
      fundingSource: 'store_cash',
      storeId,
      dateFrom: businessDate,
      dateTo: businessDate,
    })
  }

  async savePaidPurchaseWithQueue(
    purchase: Purchase,
    payment: PurchasePayment,
    queueItem: SyncQueueItem,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.purchases,
      this.database.purchasePayments,
      this.database.syncQueue,
      async () => {
        await this.database.purchases.put(purchase)
        await this.database.purchasePayments.put(payment)
        await this.database.syncQueue.put(queueItem)
      },
    )
  }

  async saveConfirmedPaidPurchase(
    purchase: Purchase,
    payment: PurchasePayment,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.purchases,
      this.database.purchasePayments,
      async () => {
        await this.database.purchases.put(purchase)
        await this.database.purchasePayments.put(payment)
      },
    )
  }

  async saveRemotePaidPurchases(items: PaidPurchase[]): Promise<void> {
    const queued = await this.database.syncQueue
      .where('entityType')
      .equals('purchase')
      .toArray()
    const pendingIds = new Set(queued.map((item) => item.entityId))
    const remote = items.filter(
      ({ purchase }) => !pendingIds.has(purchase.id),
    )
    await this.database.transaction(
      'rw',
      this.database.purchases,
      this.database.purchasePayments,
      async () => {
        await this.database.purchases.bulkPut(
          remote.map(({ purchase }) => purchase),
        )
        await this.database.purchasePayments.bulkPut(
          remote.map(({ payment }) => payment),
        )
      },
    )
  }

  async listCentralCashMovements(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<CentralCashMovement[]> {
    const movements = storeId
      ? await this.database.centralCashMovements
          .where('storeIdSnapshot')
          .equals(storeId)
          .toArray()
      : await this.database.centralCashMovements.toArray()

    return movements
      .filter((movement) => {
        if (dateFrom && movement.businessDate < dateFrom) return false
        if (dateTo && movement.businessDate > dateTo) return false
        return true
      })
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort(
        (left, right) =>
          right.businessDate.localeCompare(left.businessDate) ||
          right.createdAt.localeCompare(left.createdAt),
      )
  }

  async replaceCentralCashPendingClosingsForScope(
    closings: CentralCashPendingClosing[],
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.centralCashPendingClosings,
      async () => {
        const existing = await this.database.centralCashPendingClosings.toArray()
        const replacedIds = existing
          .filter((closing) => {
            if (storeId && closing.storeId !== storeId) return false
            if (dateFrom && closing.businessDate < dateFrom) return false
            if (dateTo && closing.businessDate > dateTo) return false
            return true
          })
          .map((closing) => closing.id)

        await this.database.centralCashPendingClosings.bulkDelete(replacedIds)
        await this.database.centralCashPendingClosings.bulkPut(closings)
      },
    )
  }

  async listCentralCashPendingClosings(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<CentralCashPendingClosing[]> {
    const closings = storeId
      ? await this.database.centralCashPendingClosings
          .where('storeId')
          .equals(storeId)
          .toArray()
      : await this.database.centralCashPendingClosings.toArray()

    return closings
      .filter((closing) => {
        if (dateFrom && closing.businessDate < dateFrom) return false
        if (dateTo && closing.businessDate > dateTo) return false
        return true
      })
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort(
        (left, right) =>
          right.businessDate.localeCompare(left.businessDate) ||
          right.sequenceNumber - left.sequenceNumber,
      )
  }

  deleteCentralCashPendingClosing(id: string): Promise<void> {
    return this.database.centralCashPendingClosings.delete(id)
  }

  async replaceExportCandidatesForScope(
    candidates: ExportCandidate[],
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.exportCandidates,
      async () => {
        const existing = await this.database.exportCandidates.toArray()
        const replacedIds = existing
          .filter((candidate) => {
            if (storeId && candidate.storeId !== storeId) return false
            if (dateFrom && candidate.businessDate < dateFrom) return false
            if (dateTo && candidate.businessDate > dateTo) return false
            return true
          })
          .map((candidate) => candidate.id)

        await this.database.exportCandidates.bulkDelete(replacedIds)
        await this.database.exportCandidates.bulkPut(candidates)
      },
    )
  }

  async listExportCandidates(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<ExportCandidate[]> {
    const candidates = storeId
      ? await this.database.exportCandidates.where('storeId').equals(storeId).toArray()
      : await this.database.exportCandidates.toArray()

    return candidates
      .filter((candidate) => {
        if (dateFrom && candidate.businessDate < dateFrom) return false
        if (dateTo && candidate.businessDate > dateTo) return false
        return true
      })
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort(
        (left, right) =>
          right.businessDate.localeCompare(left.businessDate) ||
          right.sequenceNumber - left.sequenceNumber,
      )
  }

  saveExportBatch(batch: ExportBatch): Promise<string> {
    return this.database.exportBatches.put(batch)
  }

  async replaceExportBatches(batches: ExportBatch[]): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.exportBatches,
      async () => {
        await this.database.exportBatches.clear()
        await this.database.exportBatches.bulkPut(batches)
      },
    )
  }

  async listExportBatches(): Promise<ExportBatch[]> {
    // oxlint-disable-next-line unicorn/no-array-reverse -- Dexie Collection.reverse(), not Array.reverse().
    return this.database.exportBatches.orderBy('createdAt').reverse().toArray()
  }

  getExportBatch(id: string): Promise<ExportBatch | undefined> {
    return this.database.exportBatches.get(id)
  }

  deleteExportCandidates(ids: readonly string[]): Promise<void> {
    return this.database.exportCandidates.bulkDelete([...ids])
  }
}

export const operationsRepository = new OperationsRepository()
