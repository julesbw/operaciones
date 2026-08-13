import { BILL_DENOMINATIONS, EMPTY_BILLS } from '../domain/constants'
import type {
  Bills,
  CashClosingDraft,
  Expense,
  MerchandiseTransfer,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type { CashClosingRow } from '../types/database'
import { calculateBillsTotal } from '../utils/money'
import { syncService } from './syncService'

export type ClosingExpenseTotals = {
  total: number
  cash: number
}

export type ClosingOperationalTotals = {
  expensesTotal: number
  cashExpensesTotal: number
  outgoingTransfersTotal: number
  storeCashPaymentsTotal: number
  operationalOutflowsTotal: number
  cashOutflowsTotal: number
}

export type ClosingOperationalSummary = ClosingOperationalTotals & {
  expenses: Expense[]
  outgoingTransfers: MerchandiseTransfer[]
}

export type ClosingSummary = ClosingOperationalTotals & {
  resultAfterExpenses: number
  resultAfterOperationalOutflows: number
  countedCash: number
  cashBalance: number
  cashToWithdraw: number
  withdrawBills: Bills
  expectedCash: number
  grossCashReconstructed: number
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

export function calculateOperationalTotals(
  expenses: Expense[],
  outgoingTransfers: MerchandiseTransfer[],
): ClosingOperationalTotals {
  const expenseTotals = calculateExpenseTotals(expenses)
  const outgoingTransfersTotal = roundMoney(
    outgoingTransfers.reduce((total, transfer) => total + transfer.amount, 0),
  )
  const storeCashPaymentsTotal = 0

  return {
    expensesTotal: expenseTotals.total,
    cashExpensesTotal: expenseTotals.cash,
    outgoingTransfersTotal,
    storeCashPaymentsTotal,
    operationalOutflowsTotal: roundMoney(
      expenseTotals.total + outgoingTransfersTotal + storeCashPaymentsTotal,
    ),
    cashOutflowsTotal: roundMoney(
      expenseTotals.cash + storeCashPaymentsTotal,
    ),
  }
}

export function calculateClosingSummary(
  draft: CashClosingDraft,
  operational: ClosingOperationalTotals,
): ClosingSummary {
  const countedCash = roundMoney(calculateBillsTotal(draft.bills))
  const cashBalance = roundMoney(calculateBillsTotal(draft.balanceBills))
  const withdrawBills = calculateWithdrawBills(
    draft.bills,
    draft.balanceBills,
  )
  const grossSales = roundMoney(draft.grossSales)
  const expectedCash = roundMoney(grossSales - operational.cashOutflowsTotal)

  return {
    ...operational,
    resultAfterExpenses: roundMoney(grossSales - operational.expensesTotal),
    resultAfterOperationalOutflows: roundMoney(
      grossSales - operational.operationalOutflowsTotal,
    ),
    countedCash,
    cashBalance,
    cashToWithdraw: roundMoney(calculateBillsTotal(withdrawBills)),
    withdrawBills,
    expectedCash,
    grossCashReconstructed: roundMoney(
      countedCash + operational.cashOutflowsTotal,
    ),
    difference: roundMoney(countedCash - expectedCash),
  }
}

export function applyClosingSummary(
  draft: CashClosingDraft,
  operational: ClosingOperationalTotals,
): CashClosingDraft {
  const summary = calculateClosingSummary(draft, operational)
  return {
    ...draft,
    grossSales: roundMoney(draft.grossSales),
    cashBalance: summary.cashBalance,
    withdrawBills: summary.withdrawBills,
    expensesTotal: summary.expensesTotal,
    cashExpensesTotal: summary.cashExpensesTotal,
    outgoingTransfersTotal: summary.outgoingTransfersTotal,
    storeCashPaymentsTotal: summary.storeCashPaymentsTotal,
    operationalOutflowsTotal: summary.operationalOutflowsTotal,
    cashOutflowsTotal: summary.cashOutflowsTotal,
    countedCash: summary.countedCash,
    cashToWithdraw: summary.cashToWithdraw,
    expectedCash: summary.expectedCash,
    difference: summary.difference,
  }
}

class ClosingService {
  async getOperationalSummary(
    storeId: string,
    businessDate: string,
  ): Promise<ClosingOperationalSummary> {
    const [expenses, outgoingTransfers] = await Promise.all([
      operationsRepository.listExpenses(storeId, businessDate),
      operationsRepository.listMerchandiseTransfers(storeId, businessDate),
    ])

    return {
      expenses,
      outgoingTransfers,
      ...calculateOperationalTotals(expenses, outgoingTransfers),
    }
  }

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
      outgoingTransfersTotal: 0,
      storeCashPaymentsTotal: 0,
      operationalOutflowsTotal: 0,
      cashOutflowsTotal: 0,
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
    operational: ClosingOperationalTotals,
  ): Promise<CashClosingDraft> {
    const savedDraft = {
      ...applyClosingSummary(draft, operational),
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
  ): Promise<CashClosingRow> {
    if (!supabase) throw new Error('Supabase no está configurado')

    try {
      await syncService.process()
    } catch (cause: unknown) {
      console.error('No fue posible sincronizar antes del cierre', cause)
      throw new Error(
        'No fue posible sincronizar los movimientos del día. Intenta nuevamente.',
        { cause },
      )
    }

    const pending = await operationsRepository.countPendingClosingMovements(
      draft.storeId,
      draft.businessDate,
    )
    if (pending.expenses > 0 || pending.transfers > 0) {
      throw new Error(
        'Hay movimientos del día pendientes de sincronizar. Sincronízalos antes de cerrar el corte.',
      )
    }

    const operational = await this.getOperationalSummary(
      draft.storeId,
      draft.businessDate,
    )
    const closedDraft = applyClosingSummary(draft, operational)
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

    await operationsRepository.saveClosingDraft({
      ...closedDraft,
      updatedAt: new Date().toISOString(),
    })
    const { data, error } = await supabase.rpc('close_cash_closing', {
      p_id: closedDraft.id,
      p_store_id: closedDraft.storeId,
      p_business_date: closedDraft.businessDate,
      p_gross_sales: closedDraft.grossSales,
      p_bills: closedDraft.bills,
      p_balance_bills: closedDraft.balanceBills,
      p_notes: closedDraft.notes ?? null,
    })
    if (error) throw error
    if (!data) throw new Error('Supabase no devolvió el corte confirmado')
    await operationsRepository.deleteClosingDraft(closedDraft.id)
    return data
  }
}

export const closingService = new ClosingService()
