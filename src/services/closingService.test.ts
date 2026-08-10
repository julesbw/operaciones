import { describe, expect, it } from 'vitest'
import type { CashClosingDraft, Expense } from '../domain/models'
import {
  calculateClosingSummary,
  calculateExpenseTotals,
  calculateWithdrawBills,
  validateClosingBillCounts,
} from './closingService'

const draft: CashClosingDraft = {
  id: 'closing-id',
  storeId: 'store-id',
  businessDate: '2026-08-10',
  grossSales: 16_000,
  bills: {
    b1000: 15,
    b500: 0,
    b200: 0,
    b100: 0,
    b50: 0,
    b20: 0,
    monedas: 0,
  },
  balanceBills: {
    b1000: 2,
    b500: 0,
    b200: 0,
    b100: 0,
    b50: 0,
    b20: 0,
    monedas: 0,
  },
  withdrawBills: {
    b1000: 0,
    b500: 0,
    b200: 0,
    b100: 0,
    b50: 0,
    b20: 0,
    monedas: 0,
  },
  cashBalance: 2_000,
  expensesTotal: 0,
  cashExpensesTotal: 0,
  countedCash: 0,
  cashToWithdraw: 0,
  expectedCash: 0,
  difference: 0,
  currentStep: 1,
  status: 'draft',
  createdBy: 'admin-id',
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
}

function expense(
  id: string,
  amount: number,
  paymentMethod: Expense['paymentMethod'],
): Expense {
  return {
    id,
    storeId: draft.storeId,
    businessDate: draft.businessDate,
    amount,
    concept: id,
    paymentMethod,
    createdBy: 'admin-id',
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    version: 1,
    syncStatus: 'synced',
  }
}

describe('calculateExpenseTotals', () => {
  it('separates all expenses from those paid in cash', () => {
    expect(
      calculateExpenseTotals([
        expense('cash', 900, 'efectivo'),
        expense('transfer', 100, 'transferencia'),
      ]),
    ).toEqual({ total: 1_000, cash: 900 })
  })
})

describe('calculateClosingSummary', () => {
  it('uses only cash expenses to reconcile physical cash', () => {
    expect(
      calculateClosingSummary(draft, { total: 1_000, cash: 900 }),
    ).toEqual({
      expensesTotal: 1_000,
      cashExpensesTotal: 900,
      resultAfterExpenses: 15_000,
      countedCash: 15_000,
      cashBalance: 2_000,
      cashToWithdraw: 13_000,
      withdrawBills: {
        b1000: 13,
        b500: 0,
        b200: 0,
        b100: 0,
        b50: 0,
        b20: 0,
        monedas: 0,
      },
      expectedCash: 15_100,
      difference: -100,
    })
  })
})

describe('cash balance denominations', () => {
  it('withdraws one $50 bill when five were counted and four remain', () => {
    const counted = { ...draft.bills, b1000: 0, b50: 5 }
    const balance = { ...draft.balanceBills, b1000: 0, b50: 4 }

    expect(calculateWithdrawBills(counted, balance).b50).toBe(1)
    expect(
      validateClosingBillCounts({
        ...draft,
        bills: counted,
        balanceBills: balance,
      }),
    ).toEqual([])
  })

  it('rejects leaving more bills than were counted', () => {
    expect(
      validateClosingBillCounts({
        ...draft,
        bills: { ...draft.bills, b50: 5 },
        balanceBills: { ...draft.balanceBills, b50: 6 },
      }),
    ).toContain('No pueden permanecer más $50 de los que se contaron')
  })
})
