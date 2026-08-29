import type { ClosingAdjustment } from '../domain/models'
import type {
  CashClosingAdjustmentRow,
  CashClosingExpenseItemRow,
  CashClosingPaymentItemRow,
  CashClosingPurchaseItemRow,
  CashClosingRow,
  CashClosingTransferItemRow,
} from './database'

export type CashClosingDetailRow = {
  closing: CashClosingRow
  expenses: CashClosingExpenseItemRow[]
  transfers: CashClosingTransferItemRow[]
  payments: CashClosingPaymentItemRow[]
  purchases: CashClosingPurchaseItemRow[]
  adjustments: CashClosingAdjustmentRow[]
}

export type CashClosingDetail = {
  closing: CashClosingRow
  expenses: CashClosingExpenseItemRow[]
  transfers: CashClosingTransferItemRow[]
  payments: CashClosingPaymentItemRow[]
  purchases: CashClosingPurchaseItemRow[]
  adjustments: ClosingAdjustment[]
}

export type CachedCashClosing = CashClosingRow & {
  cachedAt: string
}

export type CachedCashClosingDetail = CashClosingDetail & {
  closingId: string
  cachedAt: string
}
