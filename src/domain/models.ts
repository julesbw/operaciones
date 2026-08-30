export const APP_ROLES = ['cashier', 'admin'] as const
export type AppRole = (typeof APP_ROLES)[number]

// Esta identidad es deliberadamente independiente de la sesión técnica Supabase.
export const APP_ACCOUNT_ROLES = ['cashier', 'store_manager'] as const
export type AppAccountRole = (typeof APP_ACCOUNT_ROLES)[number]

export const ENTITY_STATUSES = ['active', 'suspended', 'inactive'] as const
export type EntityStatus = (typeof ENTITY_STATUSES)[number]

export const STORE_STATUSES = ['active', 'inactive'] as const
export type StoreStatus = (typeof STORE_STATUSES)[number]

export const CLOSING_RECONCILIATION_MODES = ['normal', 'sicar'] as const
export type ClosingReconciliationMode =
  (typeof CLOSING_RECONCILIATION_MODES)[number]

export const PAYMENT_METHODS = [
  'efectivo',
  'tarjeta',
  'transferencia',
  'otro',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_FUNDING_SOURCES = [
  'store_cash',
  'central_cash',
] as const
export type PaymentFundingSource =
  (typeof PAYMENT_FUNDING_SOURCES)[number]

export const SYNC_STATUSES = ['pending', 'syncing', 'synced', 'error'] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

export const NOTIFICATION_EVENT_TYPES = [
  'PURCHASE_CREATED',
  'TRANSFER_CREATED',
  'CASH_CLOSING_CLOSED',
] as const
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export const NOTIFICATION_SOURCE_APPS = [
  'operaciones',
  'arrendamientos',
] as const
export type NotificationSourceApp = (typeof NOTIFICATION_SOURCE_APPS)[number]
export const OPERATIONS_NOTIFICATION_SOURCE_APP = 'operaciones' as const

export const NOTIFICATION_ENTITY_TYPES = [
  'purchase',
  'merchandise_transfer',
  'cash_closing',
] as const
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number]

export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'rest_day',
] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export type Store = {
  id: string
  name: string
  status: StoreStatus
  closingReconciliationMode?: ClosingReconciliationMode
  createdAt: string
  updatedAt: string
}

export type Supplier = {
  id: string
  name: string
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type UserProfile = {
  id: string
  fullName: string
  role: AppRole
  storeId?: string
  storeName?: string
  demo?: boolean
}

export type LocalAccessState =
  | 'enabled'
  | 'reauthentication-required'
  | 'signed-out'

export type LocalAppContext = {
  id: 'current'
  userId: string
  displayName: string
  role: AppRole
  storeId?: string
  storeName?: string
  demo?: boolean
  accessState: LocalAccessState
  initializedAt: string
  lastAuthenticatedAt: string
  lastSuccessfulSyncAt?: string
  updatedAt: string
}

export type Expense = {
  id: string
  storeId: string
  businessDate: string
  amount: number
  concept: string
  paymentMethod: PaymentMethod
  fundingSource: PaymentFundingSource
  sourceStoreId?: string
  notes?: string
  createdBy: string
  operatorAccountId?: string | null
  createdAt: string
  updatedAt: string
  version: number
  syncStatus: SyncStatus
}

export type MerchandiseTransfer = {
  id: string
  originStoreId: string
  destinationStoreId: string
  ticketNumber: string
  amount: number
  businessDate: string
  notes?: string
  createdBy: string
  operatorAccountId?: string | null
  createdAt: string
  updatedAt: string
  version: number
  syncStatus: SyncStatus
}

export type Collaborator = {
  id: string
  name: string
  storeId: string
  restDay: number
  payCycleEndWeekday?: number
  status: EntityStatus
  weeklyPay?: number
  createdAt: string
  updatedAt: string
}

export type CollaboratorCompensationHistory = {
  id: string
  collaboratorId: string
  weeklyPay: number
  effectiveFrom: string
  recordedAt: string
  recordedBy: string
}

export type AttendanceRecord = {
  id: string
  collaboratorId: string
  storeId: string
  attendanceDate: string
  status: AttendanceStatus
  recordedBy: string
  operatorAccountId?: string | null
  createdAt: string
  updatedAt: string
  version: number
  syncStatus: SyncStatus
}

export type Payment = {
  id: string
  collaboratorId: string
  collaboratorNameSnapshot: string
  collaboratorStoreIdSnapshot: string
  payCycleEndWeekdaySnapshot: number
  businessDate: string
  paidAt: string
  paidBy: string
  suggestedAmount: number
  paidAmount: number
  fundingSource: PaymentFundingSource
  sourceStoreId?: string
  notes?: string
  createdAt: string
}

export type PaymentAttendanceItem = {
  paymentId: string
  attendanceId: string
  workDateSnapshot: string
  periodStart: string
  periodEnd: string
  weeklyPaySnapshot: number
  dailyPaySnapshot: number
  suggestedAllocation: number
  createdAt: string
}

export type AppAccount = {
  id: string
  username: string
  displayName: string
  role: AppAccountRole
  storeId: string
  storeName?: string
  collaboratorId?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type OperatorSession = {
  token: string
  account: Pick<
    AppAccount,
    | 'id'
    | 'username'
    | 'displayName'
    | 'role'
    | 'storeId'
    | 'storeName'
    | 'collaboratorId'
  >
  expiresAt: string
}

export type Purchase = {
  id: string
  supplierId: string
  supplierNameSnapshot: string
  businessDate: string
  folio?: string
  amount: number
  notes?: string
  createdBy: string
  operatorAccountId?: string | null
  createdAt: string
  updatedAt: string
  syncStatus: SyncStatus
}

export type PurchasePayment = {
  id: string
  purchaseId: string
  amount: number
  fundingSource: PaymentFundingSource
  sourceStoreId?: string
  paymentMethod: PaymentMethod
  bills?: CentralCashBills
  coinsAmount: number
  paidAt: string
  createdBy: string
  createdAt: string
}

export type PaidPurchase = {
  purchase: Purchase
  payment: PurchasePayment
}

export type InAppNotification = {
  id: string
  sourceApp: NotificationSourceApp
  eventType: NotificationEventType
  title: string
  message: string
  storeId: string | null
  storeName: string | null
  entityType: NotificationEntityType
  entityId: string
  actorOperatorAccountId: string | null
  actorAuthUserId: string | null
  createdAt: string
  readAt: string | null
}

export type Bills = {
  b1000: number
  b500: number
  b200: number
  b100: number
  b50: number
  b20: number
  monedas: number
}

export type ClosingAdjustmentType = 'inflow' | 'outflow'

export type ClosingAdjustment = {
  id: string
  cashClosingId: string
  type: ClosingAdjustmentType
  amount: number
  concept: string
  notes?: string
  bills: CentralCashBills
  coinsAmount: number
  createdBy: string
  createdAt: string
}

export type CentralCashBills = Omit<Bills, 'monedas'>

export const CENTRAL_CASH_MOVEMENT_TYPES = ['inflow', 'outflow'] as const
export type CentralCashMovementType =
  (typeof CENTRAL_CASH_MOVEMENT_TYPES)[number]

export const CENTRAL_CASH_SOURCE_TYPES = [
  'cash_closing',
  'manual_adjustment',
  'purchase',
  'purchase_coin_compensation',
  'expense',
  'expense_coin_compensation',
  'collaborator_payment',
  'bank_deposit',
  'other',
] as const
export type CentralCashSourceType =
  (typeof CENTRAL_CASH_SOURCE_TYPES)[number]

export type CentralCashMovement = {
  id: string
  movementType: CentralCashMovementType
  sourceType: CentralCashSourceType
  sourceId: string
  amount: number
  businessDate: string
  concept: string
  notes?: string
  bills: CentralCashBills
  coinsAmount: number
  storeIdSnapshot?: string
  storeNameSnapshot?: string
  sequenceNumberSnapshot?: number
  createdBy: string
  createdByNameSnapshot: string
  createdAt: string
  cachedAt: string
}

export type CentralCashPendingClosing = {
  id: string
  storeId: string
  storeName: string
  businessDate: string
  sequenceNumber: number
  cashToWithdraw: number
  withdrawBills: Bills
  closedAt: string
  cachedAt: string
}

export type CentralCashSummary = {
  id: 'current'
  balance: number
  todayInflows: number
  todayOutflows: number
  todayNet: number
  bills: CentralCashBills
  coinsAmount: number
  pendingClosingsCount: number
  pendingClosingsAmount: number
  cachedAt: string
}

export type CentralCashAdjustmentInput = {
  id: string
  movementType: CentralCashMovementType
  amount: number
  businessDate: string
  concept: string
  notes?: string
  bills: CentralCashBills
  coinsAmount: number
}

export type CashClosingStep = 1 | 2 | 3 | 4

export type CashClosingDraft = {
  id: string
  storeId: string
  businessDate: string
  grossSales: number
  closingReconciliationMode?: ClosingReconciliationMode
  bills: Bills
  balanceBills: Bills
  withdrawBills: Bills
  cashBalance: number
  expensesTotal: number
  cashExpensesTotal: number
  outgoingTransfersTotal: number
  storeCashPaymentsTotal: number
  purchasesTotal: number
  cashPurchasesTotal: number
  operationalOutflowsTotal: number
  cashOutflowsTotal: number
  selectedExpenseIds: string[]
  selectedTransferIds: string[]
  selectedPaymentIds: string[]
  selectedPurchasePaymentIds: string[]
  knownExpenseIds: string[]
  knownTransferIds: string[]
  knownPaymentIds: string[]
  knownPurchasePaymentIds: string[]
  movementSelectionInitialized: boolean
  countedCash: number
  cashToWithdraw: number
  expectedCash: number
  difference: number
  notes?: string
  currentStep: CashClosingStep
  status: 'draft'
  createdBy: string
  operatorAccountId?: string | null
  createdAt: string
  updatedAt: string
}

export type SyncEntity =
  | 'expense'
  | 'attendance'
  | 'merchandiseTransfer'
  | 'purchase'
export type SyncOperation = 'insert' | 'update' | 'delete'

export type SyncQueueItem = {
  id: string
  entityType: SyncEntity
  entityId: string
  operation: SyncOperation
  createdAt: string
  attempts: number
  operatorAccountId?: string | null
  lastError?: string
  errorCode?: string
  diagnosticError?: string
  lastAttemptAt?: string
  nextAttemptAt?: string
}

export type ExpenseInput = Pick<
  Expense,
  | 'storeId'
  | 'businessDate'
  | 'amount'
  | 'concept'
  | 'paymentMethod'
  | 'fundingSource'
  | 'sourceStoreId'
  | 'notes'
> & {
  requestId?: string
  bills?: CentralCashBills
  coinsAmount?: number
}

export type MerchandiseTransferInput = Pick<
  MerchandiseTransfer,
  | 'originStoreId'
  | 'destinationStoreId'
  | 'ticketNumber'
  | 'amount'
  | 'businessDate'
  | 'notes'
>

export type AttendanceInput = Pick<
  AttendanceRecord,
  'collaboratorId' | 'storeId' | 'attendanceDate' | 'status'
>

export type CreatePurchaseInput = {
  purchaseId: string
  paymentId: string
  supplierId: string
  businessDate: string
  folio?: string
  amount: number
  notes?: string
  fundingSource: PaymentFundingSource
  sourceStoreId?: string
  paymentMethod: PaymentMethod
  bills?: CentralCashBills
  coinsAmount?: number
}
