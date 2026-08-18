import { describe, expect, it } from 'vitest'
import {
  calculateAdjustmentNet,
  calculateEffectiveClosing,
  limitAdjustmentToAvailableStock,
  validateAdjustmentPhysicalAmount,
  validateEffectiveClosing,
} from './closingAdjustments'
import type { ClosingAdjustment } from './models'

const original = {
  countedCash: 10_000,
  cashBalance: 2_000,
  cashToWithdraw: 8_000,
  countedBills: {
    b1000: 10,
    b500: 0,
    b200: 0,
    b100: 0,
    b50: 0,
    b20: 0,
    monedas: 0,
  },
  withdrawBills: {
    b1000: 8,
    b500: 0,
    b200: 0,
    b100: 0,
    b50: 0,
    b20: 0,
    monedas: 0,
  },
}

function adjustment(
  id: string,
  type: ClosingAdjustment['type'],
  amount: number,
  bills: ClosingAdjustment['bills'],
  coinsAmount = 0,
): ClosingAdjustment {
  return {
    id,
    cashClosingId: 'closing-id',
    type,
    amount,
    concept: id,
    bills,
    coinsAmount,
    createdBy: 'admin-id',
    createdAt: '2026-08-18T12:00:00.000Z',
  }
}

describe('closing adjustments effective values', () => {
  it('applies an inflow without changing the original snapshot', () => {
    const effective = calculateEffectiveClosing(original, [
      adjustment('inflow', 'inflow', 500, {
        b1000: 0, b500: 1, b200: 0, b100: 0, b50: 0, b20: 0,
      }),
    ])

    expect(effective.countedCash).toBe(10_500)
    expect(effective.cashToWithdraw).toBe(8_500)
    expect(effective.countedBills.b500).toBe(1)
    expect(effective.withdrawBills.b500).toBe(1)
    expect(original.cashToWithdraw).toBe(8_000)
  })

  it('supports outflow, multiple adjustments and compensation', () => {
    const adjustments = [
      adjustment('inflow', 'inflow', 500, { b1000: 0, b500: 1, b200: 0, b100: 0, b50: 0, b20: 0 }),
      adjustment('outflow', 'outflow', 200, { b1000: 0, b500: 0, b200: 1, b100: 0, b50: 0, b20: 0 }),
      adjustment('fifty', 'inflow', 50, { b1000: 0, b500: 0, b200: 0, b100: 0, b50: 1, b20: 0 }),
      adjustment('reverse', 'outflow', 500, { b1000: 0, b500: 1, b200: 0, b100: 0, b50: 0, b20: 0 }),
    ]
    expect(calculateAdjustmentNet(adjustments.slice(0, 3))).toBe(350)
    expect(calculateAdjustmentNet(adjustments)).toBe(-150)
    const effective = calculateEffectiveClosing({
      ...original,
      countedBills: {
        ...original.countedBills,
        b1000: 9,
        b200: 5,
      },
      withdrawBills: { ...original.withdrawBills, b1000: 7, b200: 5 },
    }, adjustments)
    expect(effective.cashToWithdraw).toBe(7_850)
    expect(validateEffectiveClosing(effective)).toBeUndefined()
  })

  it('accepts a valid outflow and applies it to the effective denominations', () => {
    const effective = calculateEffectiveClosing(original, [
      adjustment('outflow', 'outflow', 1_000, {
        b1000: 1, b500: 0, b200: 0, b100: 0, b50: 0, b20: 0,
      }),
    ])

    expect(effective.countedCash).toBe(9_000)
    expect(effective.countedBills.b1000).toBe(9)
    expect(effective.withdrawBills.b1000).toBe(7)
    expect(validateEffectiveClosing(effective)).toBeUndefined()
  })

  it('rejects an outflow that makes one denomination negative even when totals reconcile', () => {
    const effective = calculateEffectiveClosing({
      ...original,
      countedCash: 2_150,
      cashBalance: 2_000,
      cashToWithdraw: 150,
      countedBills: { ...original.countedBills, b1000: 2, b50: 1, b20: 5 },
      withdrawBills: { ...original.withdrawBills, b1000: 0, b50: 1, b20: 5 },
    }, [
      adjustment('negative-fifty', 'outflow', 100, {
        b1000: 0, b500: 0, b200: 0, b100: 0, b50: 2, b20: 0,
      }),
    ])

    expect(effective.cashToWithdraw).toBe(50)
    expect(effective.withdrawBills.b50).toBe(-1)
    expect(validateEffectiveClosing(effective)).toBe(
      'CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT',
    )
  })

  it('rejects a negative effective coins amount', () => {
    const effective = calculateEffectiveClosing({
      ...original,
      countedCash: 2_110,
      cashBalance: 2_000,
      cashToWithdraw: 110,
      countedBills: { ...original.countedBills, b1000: 2, monedas: 10 },
      withdrawBills: { ...original.withdrawBills, b1000: 0, monedas: 10 },
    }, [
      adjustment('negative-coins', 'outflow', 15, {
        b1000: 0, b500: 0, b200: 0, b100: 0, b50: 0, b20: 0,
      }, 15),
    ])

    expect(effective.withdrawBills.monedas).toBe(-5)
    expect(validateEffectiveClosing(effective)).toBe(
      'CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT',
    )
  })

  it('rebuilds the projection immediately across multiple adjustments', () => {
    const adjustments = [
      adjustment('inflow', 'inflow', 500, {
        b1000: 0, b500: 1, b200: 0, b100: 0, b50: 0, b20: 0,
      }),
      adjustment('outflow', 'outflow', 500, {
        b1000: 0, b500: 1, b200: 0, b100: 0, b50: 0, b20: 0,
      }),
      adjustment('coins', 'inflow', 12.5, {
        b1000: 0, b500: 0, b200: 0, b100: 0, b50: 0, b20: 0,
      }, 12.5),
    ]

    const effective = calculateEffectiveClosing({
      ...original,
    }, adjustments)

    expect(effective.adjustmentsNet).toBe(12.5)
    expect(effective.countedCash).toBe(10_012.5)
    expect(effective.countedBills.b500).toBe(0)
    expect(effective.countedBills.monedas).toBe(12.5)
    expect(effective.withdrawBills.monedas).toBe(12.5)
    expect(validateEffectiveClosing(effective)).toBeUndefined()
  })

  it('limits an outflow breakdown to the effective available stock', () => {
    const limited = limitAdjustmentToAvailableStock({
      b1000: 5, b500: 0, b200: 0, b100: 0, b50: 3, b20: 0,
    }, 20, {
      ...original.withdrawBills,
      b1000: 2,
      b50: 1,
      monedas: 12.5,
    })

    expect(limited.bills.b1000).toBe(2)
    expect(limited.bills.b50).toBe(1)
    expect(limited.coinsAmount).toBe(12.5)
  })

  it('rejects a negative final physical result', () => {
    const effective = calculateEffectiveClosing(original, [
      adjustment('outflow', 'outflow', 8_500, {
        b1000: 8, b500: 1, b200: 0, b100: 0, b50: 0, b20: 0,
      }),
    ])
    expect(validateEffectiveClosing(effective)).toBe(
      'CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT',
    )
  })

  it('requires the physical breakdown to equal the positive amount', () => {
    expect(
      validateAdjustmentPhysicalAmount(500, {
        b1000: 0, b500: 1, b200: 0, b100: 0, b50: 0, b20: 0,
      }, 0),
    ).toBeUndefined()
    expect(
      validateAdjustmentPhysicalAmount(500, {
        b1000: 0, b500: 0, b200: 2, b100: 0, b50: 0, b20: 0,
      }, 0),
    ).toBe('CLOSING_ADJUSTMENT_BILLS_MISMATCH')
  })
})
