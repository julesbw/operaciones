import { EMPTY_BILLS } from '../domain/constants'
import type { CashClosingDraft } from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'
import { calculateBillsTotal } from '../utils/money'
import { supabase } from '../lib/supabase'

export type ClosingSummary = {
  expenses: number
  netIncome: number
  countedCash: number
  expectedCash: number
  difference: number
}

export function calculateClosingSummary(
  draft: CashClosingDraft,
  expenses: number,
): ClosingSummary {
  const netIncome = draft.grossSales - expenses + draft.otherMovements
  const countedCash = calculateBillsTotal(draft.bills)
  const expectedCash = draft.openingBalance + netIncome

  return {
    expenses,
    netIncome,
    countedCash,
    expectedCash,
    difference: countedCash - expectedCash,
  }
}

class ClosingService {
  async load(storeId: string, businessDate: string): Promise<CashClosingDraft> {
    const saved = await operationsRepository.getClosingDraft(
      storeId,
      businessDate,
    )
    return (
      saved ?? {
        id: crypto.randomUUID(),
        storeId,
        businessDate,
        grossSales: 0,
        otherMovements: 0,
        openingBalance: 0,
        bills: { ...EMPTY_BILLS },
        updatedAt: new Date().toISOString(),
      }
    )
  }

  async save(draft: CashClosingDraft): Promise<void> {
    await operationsRepository.saveClosingDraft({
      ...draft,
      updatedAt: new Date().toISOString(),
    })
  }

  async close(
    draft: CashClosingDraft,
    expenses: number,
    userId: string,
  ): Promise<void> {
    if (!supabase) throw new Error('Supabase no está configurado')

    const summary = calculateClosingSummary(draft, expenses)
    const { error } = await supabase.from('cash_closings').upsert(
      {
        id: draft.id,
        store_id: draft.storeId,
        business_date: draft.businessDate,
        gross_sales: draft.grossSales,
        expense_total: summary.expenses,
        other_movements: draft.otherMovements,
        opening_balance: draft.openingBalance,
        counted_cash: summary.countedCash,
        expected_cash: summary.expectedCash,
        difference: summary.difference,
        bills: draft.bills,
        notes: draft.notes ?? null,
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: userId,
      },
      { onConflict: 'id' },
    )
    if (error) throw error
    await operationsRepository.deleteClosingDraft(draft.id)
  }
}

export const closingService = new ClosingService()
