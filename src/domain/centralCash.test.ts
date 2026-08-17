import { describe, expect, it } from 'vitest'
import {
  calculateCentralCashPhysicalTotal,
  centralCashPhysicalMatchesAmount,
  centralCashSignedAmount,
} from './centralCash'

describe('Caja Central', () => {
  const bills = {
    b1000: 7,
    b500: 1,
    b200: 1,
    b100: 1,
    b50: 1,
    b20: 0,
  }

  it('mantiene monedas separadas y reconcilia el efectivo físico', () => {
    expect(calculateCentralCashPhysicalTotal(bills, 150)).toBe(8_000)
    expect(centralCashPhysicalMatchesAmount(bills, 150, 8_000)).toBe(true)
    expect(centralCashPhysicalMatchesAmount(bills, 100, 8_000)).toBe(false)
  })

  it('deriva el signo desde el tipo de movimiento', () => {
    expect(centralCashSignedAmount('inflow', 8_000)).toBe(8_000)
    expect(centralCashSignedAmount('outflow', 500)).toBe(-500)
  })
})
