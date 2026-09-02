import Dexie, { type Table } from 'dexie'
import { EMPTY_BILLS } from '../domain/constants'
import type { ExportBatch, ExportCandidate } from '../domain/exportContract'
import type {
  AttendanceRecord,
  CashClosingDraft,
  ClosingAdjustment,
  CentralCashMovement,
  CentralCashPendingClosing,
  CentralCashSummary,
  Collaborator,
  CollaboratorCompensationHistory,
  Expense,
  LocalAppContext,
  MerchandiseTransfer,
  Payment,
  PaymentAttendanceItem,
  Purchase,
  PurchasePayment,
  Store,
  Supplier,
  SyncQueueItem,
} from '../domain/models'
import type {
  CachedCashClosing,
  CachedCashClosingDetail,
} from '../types/cashClosingCache'

type LegacyClosingDraft = CashClosingDraft & {
  closingReconciliationMode?: CashClosingDraft['closingReconciliationMode']
  balanceBills?: CashClosingDraft['balanceBills']
  withdrawBills?: CashClosingDraft['withdrawBills']
  openingBalance?: number
  otherMovements?: number
  outgoingTransfersTotal?: number
  storeCashPaymentsTotal?: number
  operationalOutflowsTotal?: number
  cashOutflowsTotal?: number
  selectedExpenseIds?: string[]
  selectedTransferIds?: string[]
  knownExpenseIds?: string[]
  knownTransferIds?: string[]
  selectedPaymentIds?: string[]
  knownPaymentIds?: string[]
  purchasesTotal?: number
  cashPurchasesTotal?: number
  selectedPurchasePaymentIds?: string[]
  knownPurchasePaymentIds?: string[]
  movementSelectionInitialized?: boolean
}

export const OPERATIONS_DATABASE_NAME = 'operaciones-db'

export class OperationsDatabase extends Dexie {
  stores!: Table<Store, string>
  collaborators!: Table<Collaborator, string>
  attendanceRecords!: Table<AttendanceRecord, string>
  expenses!: Table<Expense, string>
  merchandiseTransfers!: Table<MerchandiseTransfer, string>
  syncQueue!: Table<SyncQueueItem, string>
  closingDrafts!: Table<CashClosingDraft, string>
  appContexts!: Table<LocalAppContext, string>
  payments!: Table<Payment, string>
  paymentAttendanceItems!: Table<PaymentAttendanceItem, [string, string]>
  suppliers!: Table<Supplier, string>
  purchases!: Table<Purchase, string>
  purchasePayments!: Table<PurchasePayment, string>
  compensationHistory!: Table<CollaboratorCompensationHistory, string>
  exportCandidates!: Table<ExportCandidate, string>
  exportBatches!: Table<ExportBatch, string>
  centralCashMovements!: Table<CentralCashMovement, string>
  centralCashPendingClosings!: Table<CentralCashPendingClosing, string>
  centralCashSummary!: Table<CentralCashSummary, string>
  closingAdjustments!: Table<ClosingAdjustment, string>
  cashClosings!: Table<CachedCashClosing, string>
  cashClosingDetails!: Table<CachedCashClosingDetail, string>

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
    const schemaV6 = {
      ...schemaV3,
      merchandiseTransfers:
        '&id, originStoreId, destinationStoreId, businessDate, [originStoreId+businessDate], [destinationStoreId+businessDate], ticketNumber, syncStatus, createdAt',
    }
    const schemaV9 = {
      ...schemaV6,
      appContexts: '&id, userId, accessState, updatedAt',
    }
    const schemaV10 = {
      ...schemaV9,
      payments:
        '&id, collaboratorId, businessDate, [collaboratorId+businessDate], fundingSource, sourceStoreId, [sourceStoreId+businessDate], paidAt',
      paymentAttendanceItems:
        '&[paymentId+attendanceId], &attendanceId, paymentId, periodStart, periodEnd, workDateSnapshot',
      compensationHistory:
        '&id, collaboratorId, effectiveFrom, [collaboratorId+effectiveFrom], recordedAt',
    }
    const schemaV11 = {
      ...schemaV10,
      exportCandidates:
        '&id, storeId, businessDate, [storeId+businessDate], closedAt, cachedAt',
      exportBatches: '&id, status, createdAt',
    }
    const schemaV12 = {
      ...schemaV11,
      centralCashMovements:
        '&id, movementType, sourceType, sourceId, businessDate, storeIdSnapshot, [storeIdSnapshot+businessDate], createdAt',
      centralCashPendingClosings:
        '&id, storeId, businessDate, [storeId+businessDate], closedAt, cachedAt',
      centralCashSummary: '&id, cachedAt',
    }
    const schemaV13 = {
      ...schemaV12,
      suppliers: '&id, name, isActive, updatedAt',
      purchases:
        '&id, supplierId, businessDate, [supplierId+businessDate], syncStatus, createdAt',
      purchasePayments:
        '&id, purchaseId, fundingSource, sourceStoreId, paidAt',
    }
    const schemaV14 = {
      ...schemaV13,
      closingAdjustments: '&id, cashClosingId, createdAt',
    }
    const schemaV15 = {
      ...schemaV14,
    }
    const schemaV16 = {
      ...schemaV15,
    }
    const schemaV17 = {
      ...schemaV16,
    }
    const schemaV18 = {
      ...schemaV17,
      cashClosings:
        '&id, store_id, business_date, [store_id+business_date], closed_at, cachedAt',
      cashClosingDetails: '&closingId, cachedAt',
    }
    const schemaV19 = {
      ...schemaV18,
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
    this.version(4)
      .stores(schemaV3)
      .upgrade(async (transaction) => {
        await transaction
          .table<LegacyClosingDraft, string>('closingDrafts')
          .toCollection()
          .modify((draft) => {
            draft.cashBalance ??= draft.openingBalance ?? 0
            draft.expensesTotal ??= 0
            draft.cashExpensesTotal ??= 0
            draft.countedCash ??= 0
            draft.cashToWithdraw ??= 0
            draft.expectedCash ??= draft.grossSales
            draft.difference ??= draft.countedCash - draft.expectedCash
            draft.currentStep ??= 1
            draft.status ??= 'draft'
            draft.createdBy ??= ''
            draft.createdAt ??= draft.updatedAt
            delete draft.openingBalance
            delete draft.otherMovements
          })
      })
    this.version(5)
      .stores(schemaV3)
      .upgrade(async (transaction) => {
        await transaction
          .table<LegacyClosingDraft, string>('closingDrafts')
          .toCollection()
          .modify((draft) => {
            draft.balanceBills ??= {
              ...EMPTY_BILLS,
              monedas: draft.cashBalance ?? 0,
            }
            draft.withdrawBills ??= {
              ...EMPTY_BILLS,
              monedas: draft.cashToWithdraw ?? 0,
            }
          })
      })
    this.version(6).stores(schemaV6)
    this.version(7)
      .stores(schemaV6)
      .upgrade(async (transaction) => {
        await transaction
          .table<LegacyClosingDraft, string>('closingDrafts')
          .toCollection()
          .modify((draft) => {
            draft.outgoingTransfersTotal ??= 0
            draft.storeCashPaymentsTotal ??= 0
            draft.operationalOutflowsTotal ??= draft.expensesTotal
            draft.cashOutflowsTotal ??= draft.cashExpensesTotal
          })
      })
    this.version(8)
      .stores(schemaV6)
      .upgrade(async (transaction) => {
        await transaction
          .table<LegacyClosingDraft, string>('closingDrafts')
          .toCollection()
          .modify((draft) => {
            draft.selectedExpenseIds ??= []
            draft.selectedTransferIds ??= []
            draft.knownExpenseIds ??= []
            draft.knownTransferIds ??= []
            draft.movementSelectionInitialized ??= false
          })
      })
    this.version(9).stores(schemaV9)
    this.version(10)
      .stores(schemaV10)
      .upgrade(async (transaction) => {
        await transaction
          .table<LegacyClosingDraft, string>('closingDrafts')
          .toCollection()
          .modify((draft) => {
            draft.selectedPaymentIds ??= []
            draft.knownPaymentIds ??= []
          })
      })
    this.version(11).stores(schemaV11)
    this.version(12).stores(schemaV12)
    this.version(13)
      .stores(schemaV13)
      .upgrade(async (transaction) => {
        await transaction
          .table<LegacyClosingDraft, string>('closingDrafts')
          .toCollection()
          .modify((draft) => {
            draft.purchasesTotal ??= 0
            draft.cashPurchasesTotal ??= 0
            draft.selectedPurchasePaymentIds ??= []
            draft.knownPurchasePaymentIds ??= []
          })
      })
    this.version(14).stores(schemaV14)
    this.version(15)
      .stores(schemaV15)
      .upgrade(async (transaction) => {
        await transaction
          .table<Expense, string>('expenses')
          .toCollection()
          .modify((expense) => {
            expense.fundingSource ??= 'store_cash'
            expense.sourceStoreId ??= expense.storeId
          })
      })
    this.version(16)
      .stores(schemaV16)
      .upgrade(async (transaction) => {
        await transaction
          .table<LegacyClosingDraft, string>('closingDrafts')
          .toCollection()
          .modify((draft) => {
            draft.closingReconciliationMode ??= 'normal'
          })
      })
    this.version(17).stores(schemaV17)
    this.version(18).stores(schemaV18)
    this.version(19)
      .stores(schemaV19)
      .upgrade(async (transaction) => {
        await transaction
          .table<AttendanceRecord, string>('attendanceRecords')
          .toCollection()
          .modify((attendance) => {
            attendance.attendanceType ??=
              attendance.status === 'present' ? 'full' : null
          })
        await transaction
          .table<PaymentAttendanceItem, [string, string]>(
            'paymentAttendanceItems',
          )
          .toCollection()
          .modify((item) => {
            item.attendanceTypeSnapshot ??= 'full'
          })
      })
  }
}

export const db = new OperationsDatabase()
