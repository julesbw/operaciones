import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608140001_operations_export_batches.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('Operations export migration', () => {
  it('defines admin-only idempotent batch transitions and active reservations', () => {
    expect(migration).toContain('private.operations_export_require_admin()')
    expect(migration).toContain('public.prepare_export_batch')
    expect(migration).toContain('public.confirm_export_batch')
    expect(migration).toContain('public.cancel_export_batch')
    expect(migration).toContain('export_batch_items_active_closing_key')
    expect(migration).toContain("reservation_status in ('reserved', 'confirmed')")
    expect(migration).toContain('alter table public.export_batches enable row level security')
  })

  it('builds payload details only from closing snapshot relations', () => {
    expect(migration).toContain('public.cash_closing_expense_items')
    expect(migration).toContain('public.cash_closing_payment_items')
    expect(migration).toContain('public.cash_closing_transfer_items')
    expect(migration).not.toMatch(/from public\.expenses\b/i)
    expect(migration).not.toMatch(/from public\.collaborator_payments\b/i)
    expect(migration).not.toMatch(/from public\.merchandise_transfers\b/i)
    expect(migration).not.toContain('gross_sales')
  })

  it('separates bills_total and coins_amount in physical_cash', () => {
    expect(migration).toContain("'physical_cash', jsonb_build_object(")
    expect(migration).toContain("'bills_total', v_bills_total")
    expect(migration).toContain("'coins_amount', v_coins_amount")
    expect(migration).toContain(
      'round(v_bills_total + v_coins_amount, 2) <> v_closing.cash_to_withdraw',
    )
  })
})
