import { describe, expect, it } from 'vitest'
import {
  calculateBillsTotal,
  calculateCentralCashBillsTotal,
  calculateSuggestedPay,
} from './money'

describe('calculateSuggestedPay', () => {
  it('preserves the exact weekly pay for six worked days', () => {
    expect(calculateSuggestedPay(2_000, 6)).toBe(2_000)
  })

  it('uses the floored daily amount for incomplete weeks', () => {
    expect(calculateSuggestedPay(2_000, 5)).toBe(1_665)
    expect(calculateSuggestedPay(2_000, 3)).toBe(999)
  })

  it('never returns a negative payment', () => {
    expect(calculateSuggestedPay(2_000, -1)).toBe(0)
  })
})

describe('calculateBillsTotal', () => {
  it('adds every bill denomination and monedas', () => {
    expect(
      calculateBillsTotal({
        b1000: 1,
        b500: 2,
        b200: 1,
        b100: 1,
        b50: 1,
        b20: 2,
        monedas: 35,
      }),
    ).toBe(2_425)
  })
})

describe('calculateCentralCashBillsTotal', () => {
  it('calculates only the six bill denominations', () => {
    expect(
      calculateCentralCashBillsTotal({
        b1000: 2,
        b500: 1,
        b200: 0,
        b100: 3,
        b50: 0,
        b20: 1,
      }),
    ).toBe(2_820)
  })
})
