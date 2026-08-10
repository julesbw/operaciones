import { BILL_DENOMINATIONS, EMPTY_BILLS } from '../domain/constants'
import type { Bills, CashClosingDraft, Expense } from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import { calculateBillsTotal } from '../utils/money'

export type ClosingExpenseTotals = {
  total: number
  cash: number
}

export type ClosingSummary = {
  expensesTotal: number
  cashExpensesTotal: number
  resultAfterExpenses: number
  countedCash: number
  cashBalance: number
  cashToWithdraw: number
  withdrawBills: Bills
  expectedCash: number
  difference: number
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateWithdrawBills(
  countedBills: Bills,
  balanceBills: Bills,
): Bills {
  const withdrawBills = { ...EMPTY_BILLS }
  for (const denomination of BILL_DENOMINATIONS) {
    const difference =
      countedBills[denomination.key] - balanceBills[denomination.key]
    withdrawBills[denomination.key] =
      denomination.key === 'monedas'
        ? roundMoney(difference)
        : Math.trunc(difference)
  }
  return withdrawBills
}

export function validateClosingBillCounts(draft: CashClosingDraft): string[] {
  const errors: string[] = []
  for (const denomination of BILL_DENOMINATIONS) {
    const counted = draft.bills[denomination.key]
    const balance = draft.balanceBills[denomination.key]
    const requiresInteger = denomination.key !== 'monedas'

    if (
      !Number.isFinite(counted) ||
      counted < 0 ||
      (requiresInteger && !Number.isInteger(counted))
    ) {
      errors.push(`El conteo de ${denomination.label} no es válido`)
    }
    if (
      !Number.isFinite(balance) ||
      balance < 0 ||
      (requiresInteger && !Number.isInteger(balance))
    ) {
      errors.push(`El saldo de ${denomination.label} no es válido`)
    } else if (balance > counted) {
      errors.push(
        `No pueden permanecer más ${denomination.label} de los que se contaron`,
      )
    }
  }
  return errors
}

export function calculateExpenseTotals(
  expenses: Expense[],
): ClosingExpenseTotals {
  const totals = expenses.reduce<ClosingExpenseTotals>(
    (accumulator, expense) => ({
      total: accumulator.total + expense.amount,
      cash:
        accumulator.cash +
        (expense.paymentMethod === 'efectivo' ? expense.amount : 0),
    }),
    { total: 0, cash: 0 },
  )
  return {
    total: roundMoney(totals.total),
    cash: roundMoney(totals.cash),
  }
}

export function calculateClosingSummary(
  draft: CashClosingDraft,
  expenses: ClosingExpenseTotals,
): ClosingSummary {
  const countedCash = roundMoney(calculateBillsTotal(draft.bills))
  const cashBalance = roundMoney(calculateBillsTotal(draft.balanceBills))
  const withdrawBills = calculateWithdrawBills(
    draft.bills,
    draft.balanceBills,
  )
  const grossSales = roundMoney(draft.grossSales)
  const expectedCash = roundMoney(grossSales - expenses.cash)

  return {
    expensesTotal: expenses.total,
    cashExpensesTotal: expenses.cash,
    resultAfterExpenses: roundMoney(grossSales - expenses.total),
    countedCash,
    cashBalance,
    cashToWithdraw: roundMoney(calculateBillsTotal(withdrawBills)),
    withdrawBills,
    expectedCash,
    difference: roundMoney(countedCash - expectedCash),
  }
}

export function applyClosingSummary(
  draft: CashClosingDraft,
  expenses: ClosingExpenseTotals,
): CashClosingDraft {
  const summary = calculateClosingSummary(draft, expenses)
  return {
    ...draft,
    grossSales: roundMoney(draft.grossSales),
    cashBalance: summary.cashBalance,
    withdrawBills: summary.withdrawBills,
    expensesTotal: summary.expensesTotal,
    cashExpensesTotal: summary.cashExpensesTotal,
    countedCash: summary.countedCash,
    cashToWithdraw: summary.cashToWithdraw,
    expectedCash: summary.expectedCash,
    difference: summary.difference,
  }
}

class ClosingService {
  async load(
    storeId: string,
    businessDate: string,
    userId: string,
  ): Promise<CashClosingDraft | undefined> {
    const saved = await operationsRepository.getClosingDraft(
      storeId,
      businessDate,
    )
    if (!saved) return undefined

    return {
      ...saved,
      createdBy: saved.createdBy || userId,
    }
  }

  create(
    storeId: string,
    businessDate: string,
    userId: string,
  ): CashClosingDraft {
    const now = new Date().toISOString()
    return {
      id: crypto.randomUUID(),
      storeId,
      businessDate,
      grossSales: 0,
      bills: { ...EMPTY_BILLS },
      balanceBills: { ...EMPTY_BILLS },
      withdrawBills: { ...EMPTY_BILLS },
      cashBalance: 0,
      expensesTotal: 0,
      cashExpensesTotal: 0,
      countedCash: 0,
      cashToWithdraw: 0,
      expectedCash: 0,
      difference: 0,
      currentStep: 1,
      status: 'draft',
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }
  }

  async save(
    draft: CashClosingDraft,
    expenses: ClosingExpenseTotals,
  ): Promise<CashClosingDraft> {
    const savedDraft = {
      ...applyClosingSummary(draft, expenses),
      updatedAt: new Date().toISOString(),
    }
    await operationsRepository.saveClosingDraft(savedDraft)
    return savedDraft
  }

  discard(id: string): Promise<void> {
    return operationsRepository.deleteClosingDraft(id)
  }

  async close(
    draft: CashClosingDraft,
    expenses: ClosingExpenseTotals,
    userId: string,
  ): Promise<void> {
    if (!supabase) throw new Error('Supabase no está configurado')

    const closedDraft = applyClosingSummary(draft, expenses)
    const billErrors = validateClosingBillCounts(closedDraft)
    if (billErrors.length > 0) throw new Error(billErrors[0])
    if (closedDraft.grossSales < 0) {
      throw new Error('Las ventas brutas no pueden ser negativas')
    }
    if (closedDraft.cashBalance < 0) {
      throw new Error('El saldo de caja no puede ser negativo')
    }
    if (closedDraft.cashToWithdraw < 0) {
      throw new Error('El saldo de caja no puede superar el efectivo contado')
    }

    const { error } = await supabase.from('cash_closings').upsert(
      {
        id: closedDraft.id,
        store_id: closedDraft.storeId,
        business_date: closedDraft.businessDate,
        gross_sales: closedDraft.grossSales,
        expense_total: closedDraft.expensesTotal,
        cash_expense_total: closedDraft.cashExpensesTotal,
        other_movements: 0,
        opening_balance: 0,
        counted_cash: closedDraft.countedCash,
        cash_balance: closedDraft.cashBalance,
        cash_to_withdraw: closedDraft.cashToWithdraw,
        expected_cash: closedDraft.expectedCash,
        difference: closedDraft.difference,
        bills: closedDraft.bills,
        balance_bills: closedDraft.balanceBills,
        withdraw_bills: closedDraft.withdrawBills,
        notes: closedDraft.notes ?? null,
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: userId,
        created_by: closedDraft.createdBy || userId,
      },
      { onConflict: 'id' },
    )
    if (error) throw error
    await operationsRepository.deleteClosingDraft(closedDraft.id)
  }
}

export const closingService = new ClosingService()
