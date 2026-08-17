import { BILL_DENOMINATIONS } from './constants'
import type {
  CentralCashBills,
  CentralCashMovementType,
} from './models'

export function calculateCentralCashPhysicalTotal(
  bills: CentralCashBills,
  coinsAmount: number,
): number {
  const billsTotal = BILL_DENOMINATIONS.reduce((total, denomination) => {
    if (denomination.key === 'monedas') return total
    return total + bills[denomination.key] * denomination.value
  }, 0)
  return Math.round((billsTotal + coinsAmount) * 100) / 100
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
