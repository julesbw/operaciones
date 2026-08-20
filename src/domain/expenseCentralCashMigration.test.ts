import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608190003_expense_central_cash.sql',
    import.meta.url,
  ),
  'utf8',
)

function functionSignature(sql: string, functionName: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\(([\\s\\S]*?)\\)\\s*returns`,
      'i',
    ),
  )
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
}

describe('Expense central cash migration', () => {
  it('keeps existing expenses store-cash and local-first', () => {
    expect(migration).toContain(
      'add column funding_source text not null default \'store_cash\'',
    )
    expect(migration).toContain('set source_store_id = store_id')
    expect(migration).toContain('old.source_store_id is null')
    expect(migration).toContain('new.source_store_id = old.store_id')
    expect(migration).toContain("values (\n      p_id, p_store_id")
    expect(migration).toContain("'store_cash', p_store_id")
    expect(migration).toContain('-- SyncQueue.')
    expect(migration).toContain(
      'disable trigger expenses_guard_assigned_movement',
    )
    expect(migration).toContain(
      'enable trigger expenses_guard_assigned_movement',
    )
  })

  it('creates the expense and central ledger movements atomically', () => {
    expect(migration).toContain('create or replace function public.create_central_cash_expense')
    expect(migration).toContain("'outflow', 'expense'")
    expect(migration).toContain("'inflow', 'expense_coin_compensation'")
    expect(migration).toContain("'expense_coin_compensation'")
    expect(migration).toContain('EXPENSE_INSUFFICIENT_CENTRAL_CASH')
    expect(migration).toContain('EXPENSE_BILLS_MISMATCH')
    expect(migration).toContain("hashtextextended('operations.expense:'")
    expect(migration).toContain("hashtext('operations.central_cash_ledger')")
  })

  it('excludes central expenses from candidates and rejects manual closing', () => {
    expect(migration).toContain("and expense.funding_source = 'store_cash'")
    expect(migration).toContain('CENTRAL_CASH_EXPENSE_NOT_ELIGIBLE')
    expect(migration).toContain(
      'cash_closing_expense_items_guard_central_cash',
    )
  })

  it('preserves the closing RPC signature introduced by purchases', () => {
    const closeSignature = functionSignature(migration, 'close_cash_closing')
    expect(closeSignature).toContain('p_purchase_payment_ids uuid[]')
    expect(closeSignature).toContain('p_payment_ids uuid[]')
    expect(functionSignature(migration, 'get_cash_closing_candidates')).toBe(
      'p_store_id uuid, p_business_date date',
    )
  })
})
