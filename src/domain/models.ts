export const APP_ROLES = ['cashier', 'admin'] as const
export type AppRole = (typeof APP_ROLES)[number]

export const ENTITY_STATUSES = ['active', 'suspended', 'inactive'] as const
export type EntityStatus = (typeof ENTITY_STATUSES)[number]

export const STORE_STATUSES = ['active', 'inactive'] as const
export type StoreStatus = (typeof STORE_STATUSES)[number]

export const PAYMENT_METHODS = [
  'efectivo',
  'tarjeta',
  'transferencia',
  'otro',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const SYNC_STATUSES = ['pending', 'syncing', 'synced', 'error'] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

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

export type Expense = {
  id: string
  storeId: string
  businessDate: string
  amount: number
  concept: string
  paymentMethod: PaymentMethod
  notes?: string
  createdBy: string
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
  status: EntityStatus
  weeklyPay?: number
  createdAt: string
  updatedAt: string
}

export type AttendanceRecord = {
  id: string
  collaboratorId: string
  storeId: string
  attendanceDate: string
  status: AttendanceStatus
  recordedBy: string
  createdAt: string
  updatedAt: string
  version: number
  syncStatus: SyncStatus
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

export type CashClosingStep = 1 | 2 | 3 | 4

export type CashClosingDraft = {
  id: string
  storeId: string
  businessDate: string
  grossSales: number
  bills: Bills
  balanceBills: Bills
  withdrawBills: Bills
  cashBalance: number
  expensesTotal: number
  cashExpensesTotal: number
  countedCash: number
  cashToWithdraw: number
  expectedCash: number
  difference: number
  notes?: string
  currentStep: CashClosingStep
  status: 'draft'
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type SyncEntity = 'expense' | 'attendance'
export type SyncOperation = 'insert' | 'update' | 'delete'

export type SyncQueueItem = {
  id: string
  entityType: SyncEntity
  entityId: string
  operation: SyncOperation
  createdAt: string
  attempts: number
  lastError?: string
  nextAttemptAt?: string
}

export type ExpenseInput = Pick<
  Expense,
  'storeId' | 'businessDate' | 'amount' | 'concept' | 'paymentMethod' | 'notes'
>

export type AttendanceInput = Pick<
  AttendanceRecord,
  'collaboratorId' | 'storeId' | 'attendanceDate' | 'status'
>
