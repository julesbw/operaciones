import type {
  CentralCashBills,
  CentralCashMovementType,
  CentralCashSummary,
} from './models'
import { calculateCentralCashBillsTotal } from '../utils/money'

export type CentralCashAdjustmentValidationCode =
  | 'CENTRAL_CASH_ADJUSTMENT_MISMATCH'
  | 'CENTRAL_CASH_INSUFFICIENT_FUNDS'

export function calculateCentralCashPhysicalTotal(
  bills: CentralCashBills,
  coinsAmount: number,
): number {
  return Math.round((calculateCentralCashBillsTotal(bills) + coinsAmount) * 100) / 100
}

export function centralCashSignedAmount(
  movementType: CentralCashMovementType,
  amount: number,
): number {
  return movementType === 'inflow' ? amount : -amount
}

export function centralCashPhysicalMatchesAmount(
  bills: CentralCashBills,
  coinsAmount: number,
  amount: number,
): boolean {
  return (
    Math.abs(calculateCentralCashPhysicalTotal(bills, coinsAmount) - amount) <
    0.005
  )
}

export function validateCentralCashAdjustment(
  summary: Pick<CentralCashSummary, 'balance' | 'bills' | 'coinsAmount'>,
  movementType: CentralCashMovementType,
  bills: CentralCashBills,
  coinsAmount: number,
  amount: number,
): CentralCashAdjustmentValidationCode | undefined {
  const billCountsValid = Object.values(bills).every(
    (count) => Number.isSafeInteger(count) && count >= 0,
  )
  const validCoins = Number.isFinite(coinsAmount) && coinsAmount >= 0
  const coinsHaveCurrencyPrecision =
    validCoins &&
    Math.abs(coinsAmount * 100 - Math.round(coinsAmount * 100)) < 1e-9
  const validAmount = Number.isFinite(amount) && amount > 0

  if (
    !billCountsValid ||
    !coinsHaveCurrencyPrecision ||
    !validAmount ||
    !centralCashPhysicalMatchesAmount(bills, coinsAmount, amount)
  ) {
    return 'CENTRAL_CASH_ADJUSTMENT_MISMATCH'
  }

  if (movementType !== 'outflow') return undefined

  const exceedsCurrentBills = Object.keys(bills).some((key) => {
    const billKey = key as keyof CentralCashBills
    return bills[billKey] > summary.bills[billKey]
  })

  if (
    amount > summary.balance ||
    coinsAmount > summary.coinsAmount ||
    exceedsCurrentBills
  ) {
    return 'CENTRAL_CASH_INSUFFICIENT_FUNDS'
  }

  return undefined
}
