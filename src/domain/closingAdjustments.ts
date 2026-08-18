import type { Bills, CentralCashBills } from './models'
import { BILL_DENOMINATIONS, EMPTY_BILLS } from './constants'
import { calculateBillsTotal } from '../utils/money'

const BILL_KEYS = ['b1000', 'b500', 'b200', 'b100', 'b50', 'b20'] as const

export const CLOSING_ADJUSTMENT_TYPES = ['inflow', 'outflow'] as const
export type ClosingAdjustmentType = (typeof CLOSING_ADJUSTMENT_TYPES)[number]

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

export type EffectiveClosingInput = {
  countedCash: number
  cashBalance: number
  cashToWithdraw: number
  countedBills: Bills
  withdrawBills: Bills
}

export type EffectiveClosingValues = EffectiveClosingInput & {
  adjustmentsNet: number
  adjustments: ClosingAdjustment[]
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function adjustmentSign(type: ClosingAdjustmentType): 1 | -1 {
  return type === 'inflow' ? 1 : -1
}

export function calculateAdjustmentNet(
  adjustments: readonly ClosingAdjustment[],
): number {
  return roundMoney(
    adjustments.reduce(
      (total, adjustment) =>
        total + adjustmentSign(adjustment.type) * adjustment.amount,
      0,
    ),
  )
}

export function calculateEffectiveClosing(
  original: EffectiveClosingInput,
  adjustments: readonly ClosingAdjustment[],
): EffectiveClosingValues {
  const adjustmentsNet = calculateAdjustmentNet(adjustments)
  const countedBills = { ...original.countedBills }
  const withdrawBills = { ...original.withdrawBills }

  for (const adjustment of adjustments) {
    const sign = adjustmentSign(adjustment.type)
    for (const denomination of BILL_DENOMINATIONS) {
      const physicalChange = denomination.key === 'monedas'
        ? adjustment.coinsAmount
        : adjustment.bills[denomination.key]
      countedBills[denomination.key] = roundMoney(
        countedBills[denomination.key] + sign * physicalChange,
      )
      withdrawBills[denomination.key] = roundMoney(
        withdrawBills[denomination.key] + sign * physicalChange,
      )
    }
  }

  return {
    countedCash: roundMoney(original.countedCash + adjustmentsNet),
    cashBalance: roundMoney(original.cashBalance),
    cashToWithdraw: roundMoney(original.cashToWithdraw + adjustmentsNet),
    countedBills,
    withdrawBills,
    adjustmentsNet,
    adjustments: [...adjustments],
  }
}

export function limitAdjustmentToAvailableStock(
  bills: CentralCashBills,
  coinsAmount: number,
  availableStock: Bills,
): { bills: CentralCashBills; coinsAmount: number } {
  const limitedBills = { ...bills }
  for (const key of BILL_KEYS) {
    limitedBills[key] = Math.min(
      Math.max(0, Math.trunc(Number(bills[key]) || 0)),
      Math.max(0, Math.trunc(Number(availableStock[key]) || 0)),
    )
  }
  return {
    bills: limitedBills,
    coinsAmount: roundMoney(
      Math.min(
        Math.max(0, Number(coinsAmount) || 0),
        Math.max(0, Number(availableStock.monedas) || 0),
      ),
    ),
  }
}

export function validateAdjustmentPhysicalAmount(
  amount: number,
  bills: CentralCashBills,
  coinsAmount: number,
): string | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return 'CLOSING_ADJUSTMENT_INVALID_AMOUNT'
  if (!Number.isFinite(coinsAmount) || coinsAmount < 0) {
    return 'CLOSING_ADJUSTMENT_BILLS_MISMATCH'
  }
  if (Object.values(bills).some((value) =>
    !Number.isFinite(value) || value < 0 || !Number.isInteger(value),
  )) {
    return 'CLOSING_ADJUSTMENT_BILLS_MISMATCH'
  }
  return Math.abs(
    BILL_KEYS.reduce(
      (total, key) => total + bills[key] * Number(key.slice(1)),
      0,
    ) + coinsAmount - amount,
  ) < 0.005
    ? undefined
    : 'CLOSING_ADJUSTMENT_BILLS_MISMATCH'
}

export function validateEffectiveClosing(
  effective: EffectiveClosingValues,
): string | undefined {
  if (effective.countedCash < 0 || effective.cashToWithdraw < 0) {
    return 'CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT'
  }
  if (effective.cashBalance > effective.countedCash) {
    return 'CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT'
  }
  if (
    BILL_DENOMINATIONS.some(({ key }) =>
      effective.countedBills[key] < 0 || effective.withdrawBills[key] < 0,
    )
  ) {
    return 'CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT'
  }
  if (
    Math.abs(calculateBillsTotal(effective.withdrawBills) - effective.cashToWithdraw) >= 0.005
  ) {
    return 'CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT'
  }
  return undefined
}

export function emptyBills(): Bills {
  return { ...EMPTY_BILLS }
}
