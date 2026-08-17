import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608170001_purchases.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('Purchases migration', () => {
  it('keeps purchases, payments and suppliers as distinct entities', () => {
    expect(migration).toContain('create table public.suppliers')
    expect(migration).toContain('create table public.purchases')
    expect(migration).toContain('create table public.purchase_payments')
    expect(migration).toContain('suppliers_normalized_name_key')
  })

  it('creates central cash atomically and protects retries', () => {
    expect(migration).toContain('public.create_paid_purchase')
    expect(migration).toContain("'outflow', 'purchase', v_payment.id")
    expect(migration).toContain('PURCHASE_INSUFFICIENT_CENTRAL_CASH')
    expect(migration).toContain('PURCHASE_REQUEST_ID_CONFLICT')
    expect(migration).toContain("hashtext('operations.central_cash_ledger')")
    expect(migration).toContain("'operations.purchase:' || p_purchase_id::text")
  })

  it('snapshots purchases once in closings and extends export 2.0', () => {
    expect(migration).toContain('create table public.cash_closing_purchase_items')
    expect(migration).toMatch(/purchase_payment_id uuid not null unique/i)
    expect(migration).toContain('cash_purchases_total_snapshot')
    expect(migration).toContain("'source_type', 'purchase'")
    expect(migration).toContain('prepare_export_batch_without_purchases')
    expect(migration).toContain('Las Compras históricas no coinciden con el Corte')
  })

  it('denies direct financial writes and enables RLS', () => {
    expect(migration).toContain('alter table public.purchases enable row level security')
    expect(migration).toContain(
      'revoke all on public.purchase_payments from public, anon, authenticated',
    )
    expect(migration).not.toMatch(
      /grant\s+(insert|update|delete).*purchase_payments/i,
    )
  })
})
