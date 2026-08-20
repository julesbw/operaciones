import { describe, expect, it } from 'vitest'
import {
  cashBreakdownOpenAfterFundingSourceChange,
  cashBreakdownMatchesAmount,
  hasCapturedCashBreakdown,
  requiresCashBreakdown,
  shouldConfirmCashBreakdownClose,
} from './purchasePolicy'

describe('purchase cash breakdown policy', () => {
  it('requires breakdown only for cash payments that capture physical cash', () => {
    expect(
      requiresCashBreakdown({
        fundingSource: 'store_cash',
        paymentMethod: 'efectivo',
        hasCapturedBreakdown: false,
      }),
    ).toBe(false)
    expect(
      requiresCashBreakdown({
        fundingSource: 'store_cash',
        paymentMethod: 'efectivo',
        hasCapturedBreakdown: true,
      }),
    ).toBe(true)
    expect(
      requiresCashBreakdown({
        fundingSource: 'central_cash',
        paymentMethod: 'efectivo',
        hasCapturedBreakdown: false,
      }),
    ).toBe(true)
    expect(
      requiresCashBreakdown({
        fundingSource: 'central_cash',
        paymentMethod: 'tarjeta',
        hasCapturedBreakdown: false,
      }),
    ).toBe(false)
  })

  it('turns the breakdown on when changing to central cash', () => {
    expect(
      cashBreakdownOpenAfterFundingSourceChange({
        currentFundingSource: 'store_cash',
        nextFundingSource: 'central_cash',
        hasCapturedBreakdown: false,
      }),
    ).toBe(true)
  })

  it('keeps captured values visible when changing central cash to store cash', () => {
    expect(
      cashBreakdownOpenAfterFundingSourceChange({
        currentFundingSource: 'central_cash',
        nextFundingSource: 'store_cash',
        hasCapturedBreakdown: true,
      }),
    ).toBe(true)
    expect(
      cashBreakdownOpenAfterFundingSourceChange({
        currentFundingSource: 'central_cash',
        nextFundingSource: 'store_cash',
        hasCapturedBreakdown: false,
      }),
    ).toBe(false)
  })

  it('detects only real captured cash values', () => {
    expect(
      hasCapturedCashBreakdown({
        b1000: 0,
        b500: 0,
        b200: 0,
        b100: 0,
        b50: 0,
        b20: 0,
      }),
    ).toBe(false)
    expect(
      hasCapturedCashBreakdown(
        {
          b1000: 1,
          b500: 0,
          b200: 0,
          b100: 0,
          b50: 0,
          b20: 0,
        },
        0,
      ),
    ).toBe(true)
  })

  it('confirms before closing a counter that has captured values', () => {
    expect(
      shouldConfirmCashBreakdownClose({
        nextOpen: false,
        hasCapturedBreakdown: true,
      }),
    ).toBe(true)
    expect(
      shouldConfirmCashBreakdownClose({
        nextOpen: false,
        hasCapturedBreakdown: false,
      }),
    ).toBe(false)
    expect(
      shouldConfirmCashBreakdownClose({
        nextOpen: true,
        hasCapturedBreakdown: true,
      }),
    ).toBe(false)
  })

  it('requires captured bills and coins to match the entered amount', () => {
    const bills = {
      b1000: 1,
      b500: 0,
      b200: 0,
      b100: 0,
      b50: 0,
      b20: 0,
    }

    expect(cashBreakdownMatchesAmount(bills, 0, 1_000)).toBe(true)
    expect(cashBreakdownMatchesAmount(bills, 0, 950)).toBe(false)
    expect(cashBreakdownMatchesAmount(bills, 10, 1_010)).toBe(true)
  })
})
