import { describe, expect, it } from 'vitest'
import {
  cashBreakdownEnabledAfterFundingSourceChange,
  requiresCashBreakdown,
} from './purchasePolicy'

describe('purchase cash breakdown policy', () => {
  it('requires breakdown only for cash payments that capture physical cash', () => {
    expect(
      requiresCashBreakdown({
        fundingSource: 'store_cash',
        paymentMethod: 'efectivo',
        cashBreakdownEnabled: false,
      }),
    ).toBe(false)
    expect(
      requiresCashBreakdown({
        fundingSource: 'store_cash',
        paymentMethod: 'efectivo',
        cashBreakdownEnabled: true,
      }),
    ).toBe(true)
    expect(
      requiresCashBreakdown({
        fundingSource: 'central_cash',
        paymentMethod: 'efectivo',
        cashBreakdownEnabled: false,
      }),
    ).toBe(true)
    expect(
      requiresCashBreakdown({
        fundingSource: 'central_cash',
        paymentMethod: 'tarjeta',
        cashBreakdownEnabled: false,
      }),
    ).toBe(false)
  })

  it('turns the breakdown on when changing to central cash', () => {
    expect(
      cashBreakdownEnabledAfterFundingSourceChange({
        currentFundingSource: 'store_cash',
        nextFundingSource: 'central_cash',
        hasCapturedBreakdown: false,
      }),
    ).toBe(true)
  })

  it('keeps captured values visible when changing central cash to store cash', () => {
    expect(
      cashBreakdownEnabledAfterFundingSourceChange({
        currentFundingSource: 'central_cash',
        nextFundingSource: 'store_cash',
        hasCapturedBreakdown: true,
      }),
    ).toBe(true)
    expect(
      cashBreakdownEnabledAfterFundingSourceChange({
        currentFundingSource: 'central_cash',
        nextFundingSource: 'store_cash',
        hasCapturedBreakdown: false,
      }),
    ).toBe(false)
  })
})
