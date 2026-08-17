import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608160001_central_cash.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('Central cash migration', () => {
  it('separates receipts from movements and protects one receipt per closing', () => {
    expect(migration).toContain('create table public.central_cash_movements')
    expect(migration).toContain('create table public.central_cash_receipts')
    expect(migration).toMatch(/cash_closing_id uuid not null unique/i)
    expect(migration).toContain("'cash_closing', v_closing.id")
    expect(migration).toContain('CENTRAL_CASH_CLOSING_ALREADY_RECEIVED')
  })

  it('keeps the ledger immutable and denies direct client writes', () => {
    expect(migration).toContain('central_cash_movements_immutable')
    expect(migration).toContain('central_cash_receipts_immutable')
    expect(migration).toContain(
      'revoke all on public.central_cash_movements from public, anon, authenticated',
    )
    expect(migration).toContain(
      'alter table public.central_cash_movements enable row level security',
    )
    expect(migration).not.toMatch(
      /grant\s+(insert|update|delete).*central_cash_movements/i,
    )
  })

  it('validates physical cash and derives the balance from movements', () => {
    expect(migration).toContain(
      'private.operations_central_cash_bills_total(v_bills) + v_coins',
    )
    expect(migration).toContain('CENTRAL_CASH_CLOSING_MISMATCH')
    expect(migration).toContain('CENTRAL_CASH_ADJUSTMENT_MISMATCH')
    expect(migration).toContain(
      "case when movement.movement_type = 'inflow'",
    )
  })

  it('keeps receipt and adjustment retries idempotent with client UUIDs', () => {
    expect(migration).toContain('where receipt.id = p_receipt_id')
    expect(migration).toContain('where movement.id = p_movement_id')
    expect(migration).toContain('CENTRAL_CASH_REQUEST_ID_CONFLICT')
    expect(migration).toContain('pg_advisory_xact_lock')
  })
})
