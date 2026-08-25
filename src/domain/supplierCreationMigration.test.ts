import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608250001_store_manager_supplier_creation.sql',
    import.meta.url,
  ),
  'utf8',
)
const sql = migration.replace(/\s+/g, ' ')

describe('store manager supplier creation migration', () => {
  it('grants supplier creation only to store managers in the operator matrix', () => {
    expect(sql).toContain(
      "when 'cashier' then p_capability in ( 'expense_store_cash', 'attendance', 'transfer' )",
    )
    expect(sql).toContain(
      "'purchase_store_cash', 'cash_closing', 'supplier_create'",
    )
  })

  it('authorizes non-admin creation from the protected operator session', () => {
    expect(sql).toContain(
      'from private.require_operator_session(p_operator_token)',
    )
    expect(sql).toContain(
      "private.operator_has_capability( v_session.role, 'supplier_create' )",
    )
    expect(sql).toContain(
      'insert into public.suppliers (id, name, created_by)',
    )
  })

  it('keeps supplier table permissions and maintenance policies unchanged', () => {
    expect(migration).not.toMatch(/create\s+policy|alter\s+policy/i)
    expect(migration).not.toMatch(
      /grant\s+(select|insert|update|delete)\s+on\s+(table\s+)?public\.suppliers/i,
    )
    expect(sql).toContain(
      'grant execute on function public.create_supplier(uuid, text, text) to authenticated',
    )
    expect(migration).not.toMatch(/approval_status|approved_by|approved_at/i)
  })
})
