import { BILL_DENOMINATIONS } from '../domain/constants'
import type { Bills } from '../domain/models'

export const currencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function calculateBillsTotal(bills: Bills): number {
  return BILL_DENOMINATIONS.reduce(
    (total, denomination) =>
      total + bills[denomination.key] * denomination.value,
    0,
  )
}

export function calculateSuggestedPay(
  weeklyPay: number,
  workedDays: number,
): number {
  if (workedDays >= 6) {
    return weeklyPay
  }

  return Math.floor(weeklyPay / 6) * Math.max(0, workedDays)
}
