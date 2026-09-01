import { describe, expect, it } from 'vitest'
import {
  calculateCentralCashPhysicalTotal,
  centralCashPhysicalMatchesAmount,
  centralCashSignedAmount,
  validateCentralCashAdjustment,
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

  it('valida una salida contra el saldo y el efectivo físico actual', () => {
    const summary = {
      balance: 8_000,
      bills: {
        b1000: 7,
        b500: 1,
        b200: 1,
        b100: 1,
        b50: 1,
        b20: 0,
      },
      coinsAmount: 150,
    }

    expect(
      validateCentralCashAdjustment(
        summary,
        'outflow',
        {
          b1000: 5,
          b500: 0,
          b200: 0,
          b100: 0,
          b50: 0,
          b20: 0,
        },
        100,
        5_100,
      ),
    ).toBeUndefined()
    expect(
      validateCentralCashAdjustment(
        { ...summary, balance: 3_000 },
        'outflow',
        {
          b1000: 5,
          b500: 0,
          b200: 0,
          b100: 0,
          b50: 0,
          b20: 0,
        },
        100,
        5_100,
      ),
    ).toBe('CENTRAL_CASH_INSUFFICIENT_FUNDS')
    expect(
      validateCentralCashAdjustment(
        summary,
        'outflow',
        { ...summary.bills, b1000: 8 },
        150,
        9_000,
      ),
    ).toBe('CENTRAL_CASH_INSUFFICIENT_FUNDS')
  })

  it('rejects a breakdown that does not match the captured amount', () => {
    expect(
      validateCentralCashAdjustment(
        {
          balance: 0,
          bills: {
            b1000: 0,
            b500: 0,
            b200: 0,
            b100: 0,
            b50: 0,
            b20: 0,
          },
          coinsAmount: 0,
        },
        'inflow',
        { ...bills, b1000: 0 },
        0,
        8_000,
      ),
    ).toBe('CENTRAL_CASH_ADJUSTMENT_MISMATCH')

    expect(
      validateCentralCashAdjustment(
        {
          balance: 0,
          bills: {
            b1000: 0,
            b500: 0,
            b200: 0,
            b100: 0,
            b50: 0,
            b20: 0,
          },
          coinsAmount: 0,
        },
        'inflow',
        { ...bills, b1000: 0 },
        0.001,
        8_000.001,
      ),
    ).toBe('CENTRAL_CASH_ADJUSTMENT_MISMATCH')
  })
})
