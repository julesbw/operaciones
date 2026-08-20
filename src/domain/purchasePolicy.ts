import type {
  CentralCashBills,
  PaymentFundingSource,
  PaymentMethod,
} from './models'
import { calculateCentralCashBillsTotal } from '../utils/money'

export function hasCapturedCashBreakdown(
  bills?: CentralCashBills,
  coinsAmount = 0,
): boolean {
  return (
    Boolean(bills && Object.values(bills).some((count) => count !== 0)) ||
    coinsAmount !== 0
  )
}

export function cashBreakdownMatchesAmount(
  bills: CentralCashBills,
  coinsAmount: number,
  amount: number,
): boolean {
  if (!Number.isFinite(amount)) return false
  const total = calculateCentralCashBillsTotal(bills) + coinsAmount
  return Math.round(total * 100) === Math.round(amount * 100)
}

export function requiresCashBreakdown(options: {
  fundingSource: PaymentFundingSource
  paymentMethod: PaymentMethod
  hasCapturedBreakdown: boolean
}): boolean {
  return (
    options.paymentMethod === 'efectivo' &&
    (options.fundingSource === 'central_cash' ||
      (options.fundingSource === 'store_cash' &&
        options.hasCapturedBreakdown))
  )
}

export function cashBreakdownOpenAfterFundingSourceChange(options: {
  currentFundingSource: PaymentFundingSource
  nextFundingSource: PaymentFundingSource
  hasCapturedBreakdown: boolean
}): boolean {
  return (
    options.nextFundingSource === 'central_cash' ||
    (options.currentFundingSource === 'central_cash' &&
      options.hasCapturedBreakdown)
  )
}

export function shouldConfirmCashBreakdownClose(options: {
  nextOpen: boolean
  hasCapturedBreakdown: boolean
}): boolean {
  return !options.nextOpen && options.hasCapturedBreakdown
}
