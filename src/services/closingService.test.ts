import { describe, expect, it } from 'vitest'
import type {
  CashClosingDraft,
  Expense,
  MerchandiseTransfer,
  PaidPurchase,
  Payment,
} from '../domain/models'
import {
  calculateClosingSummary,
  calculateExpenseTotals,
  calculateOperationalTotals,
  calculateWithdrawBills,
  mergePendingStoreCashPurchases,
  selectClosingMovements,
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
  outgoingTransfersTotal: 0,
  storeCashPaymentsTotal: 0,
  purchasesTotal: 0,
  cashPurchasesTotal: 0,
  operationalOutflowsTotal: 0,
  cashOutflowsTotal: 0,
  selectedExpenseIds: [],
  selectedTransferIds: [],
  selectedPaymentIds: [],
  selectedPurchasePaymentIds: [],
  knownExpenseIds: [],
  knownTransferIds: [],
  knownPaymentIds: [],
  knownPurchasePaymentIds: [],
  movementSelectionInitialized: false,
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

function transfer(id: string, amount: number): MerchandiseTransfer {
  return {
    id,
    originStoreId: draft.storeId,
    destinationStoreId: 'destination-id',
    ticketNumber: id,
    amount,
    businessDate: draft.businessDate,
    createdBy: 'admin-id',
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    version: 1,
    syncStatus: 'synced',
  }
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
    fundingSource: 'store_cash',
    sourceStoreId: draft.storeId,
    createdBy: 'admin-id',
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    version: 1,
    syncStatus: 'synced',
  }
}

function payment(id: string, amount: number): Payment {
  return {
    id,
    collaboratorId: 'collaborator-id',
    collaboratorNameSnapshot: 'Trabajador',
    collaboratorStoreIdSnapshot: draft.storeId,
    payCycleEndWeekdaySnapshot: 6,
    businessDate: draft.businessDate,
    paidAt: draft.createdAt,
    paidBy: 'admin-id',
    suggestedAmount: amount,
    paidAmount: amount,
    fundingSource: 'store_cash',
    sourceStoreId: draft.storeId,
    createdAt: draft.createdAt,
  }
}

function purchase(
  id: string,
  amount: number,
  paymentMethod: PaidPurchase['payment']['paymentMethod'],
): PaidPurchase {
  return {
    purchase: {
      id: `purchase-${id}`,
      supplierId: 'supplier-id',
      supplierNameSnapshot: 'Bimbo',
      businessDate: draft.businessDate,
      amount,
      createdBy: 'admin-id',
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      syncStatus: 'synced',
    },
    payment: {
      id,
      purchaseId: `purchase-${id}`,
      amount,
      fundingSource: 'store_cash',
      sourceStoreId: draft.storeId,
      paymentMethod,
      coinsAmount: 0,
      paidAt: draft.createdAt,
      createdBy: 'admin-id',
      createdAt: draft.createdAt,
    },
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
  it('includes transfers in operational outflows but not physical cash', () => {
    const operational = calculateOperationalTotals(
      [
        expense('cash', 900, 'efectivo'),
        expense('transfer', 100, 'transferencia'),
      ],
      [transfer('0018452', 2_350)],
    )

    expect(
      calculateClosingSummary(draft, operational),
    ).toEqual({
      expensesTotal: 1_000,
      cashExpensesTotal: 900,
      outgoingTransfersTotal: 2_350,
      storeCashPaymentsTotal: 0,
      purchasesTotal: 0,
      cashPurchasesTotal: 0,
      operationalOutflowsTotal: 3_350,
      cashOutflowsTotal: 900,
      resultAfterExpenses: 15_000,
      resultAfterOperationalOutflows: 12_650,
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
      grossCashReconstructed: 15_900,
      difference: -100,
    })
  })

  it('includes store cash payments in operational and physical cash outflows', () => {
    const operational = calculateOperationalTotals(
      [expense('cash', 900, 'efectivo')],
      [transfer('transfer', 2_350)],
      [payment('payment', 2_000)],
    )

    expect(operational).toEqual({
      expensesTotal: 900,
      cashExpensesTotal: 900,
      outgoingTransfersTotal: 2_350,
      storeCashPaymentsTotal: 2_000,
      purchasesTotal: 0,
      cashPurchasesTotal: 0,
      operationalOutflowsTotal: 5_250,
      cashOutflowsTotal: 2_900,
    })
  })

  it('separates all purchases from purchases that affect physical cash', () => {
    const operational = calculateOperationalTotals(
      [],
      [],
      [],
      [
        purchase('cash-purchase', 1_280, 'efectivo'),
        purchase('card-purchase', 500, 'tarjeta'),
      ],
    )

    expect(operational).toEqual({
      expensesTotal: 0,
      cashExpensesTotal: 0,
      outgoingTransfersTotal: 0,
      storeCashPaymentsTotal: 0,
      purchasesTotal: 1_780,
      cashPurchasesTotal: 1_280,
      operationalOutflowsTotal: 1_780,
      cashOutflowsTotal: 1_280,
    })
  })
})

describe('selectClosingMovements', () => {
  it('calculates totals from selected ids only', () => {
    const expenses = [
      expense('included-expense', 800, 'efectivo'),
      expense('excluded-expense', 100, 'efectivo'),
    ]
    const transfers = [
      transfer('included-transfer', 2_350),
      transfer('excluded-transfer', 900),
    ]
    const payments = [
      payment('included-payment', 2_000),
      payment('excluded-payment', 500),
    ]

    expect(
      selectClosingMovements(
        {
          expenses,
          outgoingTransfers: transfers,
          storeCashPayments: payments,
          storeCashPurchases: [],
        },
        ['included-expense'],
        ['included-transfer'],
        ['included-payment'],
      ),
    ).toMatchObject({
      expenses: [{ id: 'included-expense' }],
      outgoingTransfers: [{ id: 'included-transfer' }],
      storeCashPayments: [{ id: 'included-payment' }],
      expensesTotal: 800,
      outgoingTransfersTotal: 2_350,
      storeCashPaymentsTotal: 2_000,
      operationalOutflowsTotal: 5_150,
      cashOutflowsTotal: 2_800,
    })
  })
})

describe('mergePendingStoreCashPurchases', () => {
  it('keeps pending local purchases visible beside remote candidates', () => {
    const remote = purchase('remote', 1_000, 'efectivo')
    const pending = purchase('pending', 1_280, 'efectivo')
    pending.purchase.syncStatus = 'error'
    const staleSynced = purchase('stale', 500, 'tarjeta')

    expect(
      mergePendingStoreCashPurchases(
        [remote],
        [remote, pending, staleSynced],
      ).map(({ purchase: item }) => item.id),
    ).toEqual([remote.purchase.id, pending.purchase.id])
  })

  it('never selects a central cash expense for a closing', () => {
    const central = {
      ...expense('central-expense', 800, 'efectivo'),
      fundingSource: 'central_cash' as const,
      sourceStoreId: undefined,
    }

    expect(
      selectClosingMovements(
        {
          expenses: [central, expense('store-expense', 100, 'efectivo')],
          outgoingTransfers: [],
          storeCashPayments: [],
          storeCashPurchases: [],
        },
        ['central-expense', 'store-expense'],
        [],
      ).expenses.map((item) => item.id),
    ).toEqual(['store-expense'])
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
