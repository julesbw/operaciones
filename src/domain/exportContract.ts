import type { Bills } from './models'

export const OPERATIONS_EXPORT_VERSION = '2.0' as const
export const OPERATIONS_EXPORT_ORIGIN = 'operaciones_pwa' as const
export const OPERATIONS_EXPORT_TYPE = 'cash_closings' as const
export const EXPORT_BATCH_STATUSES = [
  'prepared',
  'confirmed',
  'cancelled',
] as const

export type ExportBatchStatus = (typeof EXPORT_BATCH_STATUSES)[number]
export type ExportMovementType = 'entrada' | 'salida'
export type ExportMovementSource =
  | 'cash_closing'
  | 'expense'
  | 'payment'
  | 'purchase'

export type ExportedMovement = {
  id: string
  source_type: ExportMovementSource
  source_id: string
  tipo: ExportMovementType
  fecha_movimiento: string
  monto: number
  concepto: string
  categoria?: string
  store_id: string
}

export type ExportedExpenseItem = {
  id: string
  amount: number
  concept: string
  payment_method: string
  affects_cash: boolean
}

export type ExportedPaymentItem = {
  id: string
  paid_amount: number
  collaborator_name: string
  funding_source: 'store_cash'
}

export type ExportedTransferItem = {
  id: string
  amount: number
  ticket_number: string
}

export type ExportedPurchaseItem = {
  id: string
  payment_id: string
  amount: number
  supplier_id: string
  supplier_name: string
  folio: string | null
  payment_method: string
  affects_cash: boolean
}

export type ExportedPhysicalCash = {
  amount: number
  bills_total: number
  bills: Omit<Bills, 'monedas'>
  coins_amount: number
}

export type ExportedClosing = {
  id: string
  store_id: string
  store_name: string
  business_date: string
  sequence_number: number
  gross_cash: number
  expenses_total: number
  cash_expenses_total: number
  store_cash_payments_total: number
  purchases_total?: number
  cash_purchases_total?: number
  net_cash: number
  cash_balance: number
  physical_cash_amount: number
  transfers_total: number
  expense_items: ExportedExpenseItem[]
  payment_items: ExportedPaymentItem[]
  transfer_items: ExportedTransferItem[]
  purchase_items?: ExportedPurchaseItem[]
  financial_movements: ExportedMovement[]
  physical_cash: ExportedPhysicalCash
  closed_at: string
}

export type OperationsExportFile = {
  version: typeof OPERATIONS_EXPORT_VERSION
  origen: typeof OPERATIONS_EXPORT_ORIGIN
  tipo_exportacion: typeof OPERATIONS_EXPORT_TYPE
  lote_exportacion_id: string
  fecha_exportacion: string
  zona_horaria: 'America/Mexico_City'
  total_cortes: number
  cortes: ExportedClosing[]
}

export type ExportCandidate = {
  id: string
  storeId: string
  storeName: string
  businessDate: string
  sequenceNumber: number
  grossCash: number
  expensesTotal: number
  cashExpensesTotal: number
  storeCashPaymentsTotal: number
  purchasesTotal: number
  cashPurchasesTotal: number
  netCash: number
  cashBalance: number
  physicalCashAmount: number
  transfersTotal: number
  closedAt: string
  cachedAt: string
}

export type ExportBatch = {
  id: string
  contractVersion: typeof OPERATIONS_EXPORT_VERSION
  status: ExportBatchStatus
  payloadSnapshot: OperationsExportFile
  createdBy: string
  createdAt: string
  confirmedBy?: string
  confirmedAt?: string
  cancelledBy?: string
  cancelledAt?: string
}
