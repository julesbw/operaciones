import { describe, expect, it } from 'vitest'
import type { CashClosingDraft } from '../domain/models'
import { calculateClosingSummary } from './closingService'

const draft: CashClosingDraft = {
  id: 'closing-id',
  storeId: 'store-id',
  businessDate: '2026-08-06',
  grossSales: 16_000,
  otherMovements: 0,
  openingBalance: 0,
  bills: {
    b1000: 15,
    b500: 0,
    b200: 0,
    b100: 0,
    b50: 0,
    b20: 0,
    monedas: 0,
  },
  updatedAt: '2026-08-06T12:00:00.000Z',
}

describe('calculateClosingSummary', () => {
  it('distinguishes gross sales, expenses and resulting cash', () => {
    expect(calculateClosingSummary(draft, 1_000)).toEqual({
      expenses: 1_000,
      netIncome: 15_000,
      countedCash: 15_000,
      expectedCash: 15_000,
      difference: 0,
    })
  })
})
