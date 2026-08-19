import type {
  CentralCashBills,
  CentralCashMovementType,
} from './models'
import { calculateCentralCashBillsTotal } from '../utils/money'

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
