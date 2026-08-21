import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/202608210001_store_manager_capabilities.sql',
    import.meta.url,
  ),
  'utf8',
)
const sql = migration.replace(/\s+/g, ' ')

describe('store manager capability migration', () => {
  it('resolves current account, role and store from the protected token server-side', () => {
    expect(sql).toContain(
      'from private.require_operator_session(p_operator_token)',
    )
    expect(sql).toContain(
      "private.require_operator_authority( p_operator_token, 'cash_closing', p_store_id )",
    )
    expect(migration).toContain('session.device_user_id = v_device_user_id')
    expect(migration).toContain(
      'v_technical_store_id is distinct from v_account.store_id',
    )
    expect(migration).toContain('v_session.expires_at <= now()')
  })

  it('enforces the five operator capabilities and requested store in protected writes', () => {
    expect(sql).toContain(
      "when 'cashier' then p_capability in ( 'expense_store_cash', 'attendance', 'transfer' )",
    )
    expect(sql).toContain(
      "when 'store_manager' then p_capability in ( 'expense_store_cash', 'attendance', 'transfer', 'purchase_store_cash', 'cash_closing' )",
    )
    for (const check of [
      "p_operator_token, 'expense_store_cash', p_store_id",
      "p_operator_token, 'attendance', p_store_id",
      "p_operator_token, 'transfer', p_origin_store_id",
      "p_operator_token, 'purchase_store_cash', p_source_store_id",
      "p_operator_token, 'cash_closing', p_store_id",
    ]) {
      expect(sql).toContain(check)
    }
  })

  it('records AppAccount attribution without attributing legacy null rows', () => {
    for (const column of [
      'created_by_operator_account_id',
      'recorded_by_operator_account_id',
      'closed_by_operator_account_id',
    ]) {
      expect(migration).toContain(column)
    }
    const schemaChanges = migration.slice(
      0,
      migration.indexOf('create or replace function'),
    )
    expect(schemaChanges).not.toMatch(/\bupdate\b/i)
  })

  it('keeps retries tied to AppAccount rather than AppSession', () => {
    expect(migration).toContain(
      'v_existing.closed_by_operator_account_id = v_operator_account_id',
    )
    expect(migration).toContain(
      'v_existing_purchase.created_by_operator_account_id',
    )
    expect(migration).not.toMatch(
      /closed_by_operator_session_id|created_by_operator_session_id/i,
    )
  })

  it('does not broaden RLS for purchases, closings or suppliers', () => {
    expect(migration).not.toMatch(/create\s+policy/i)
    expect(migration).not.toMatch(/alter\s+policy/i)
    expect(migration).not.toMatch(
      /grant\s+(select|insert|update|delete)\s+on\s+(table\s+)?public\.(purchases|cash_closings|suppliers)/i,
    )
    expect(migration).not.toMatch(
      /create or replace function public\.(confirm_collaborator_payment|create_central_cash|prepare_export|create_cash_closing_adjustment)/i,
    )
  })

  it('makes legacy sync and purchase overloads admin-only', () => {
    expect(migration).toContain(
      "raise exception 'OPERATOR_SESSION_REQUIRED' using errcode = '42501'",
    )
    expect(sql).toContain(
      'revoke all on function public.sync_expense( uuid, integer, uuid, date, numeric, text, text, text, timestamptz, timestamptz, uuid ) from public, anon, authenticated',
    )
    expect(sql).toContain(
      'revoke all on function public.sync_attendance( uuid, integer, uuid, uuid, date, text, timestamptz, timestamptz, uuid ) from public, anon, authenticated',
    )
    expect(sql).toContain(
      'revoke all on function public.sync_merchandise_transfer( uuid, integer, uuid, uuid, text, numeric, date, text, timestamptz, timestamptz, uuid ) from public, anon, authenticated',
    )
    expect(sql).toContain(
      'revoke all on function public.create_paid_purchase( uuid, uuid, uuid, date, text, numeric, text, text, uuid, text, jsonb, numeric, timestamptz ) from public, anon, authenticated',
    )
  })

  it('conditionally revokes every historical closing overload by exact signature', () => {
    expect(migration).toContain('pg_catalog.to_regprocedure(v_signature)')
    const signatures = [...migration.matchAll(
      /'public\.close_cash_closing\(([^']+)\)'/g,
    )]
    const arities = signatures.map(
      (match) => match[1]!.split(',').length,
    )
    expect(arities).toEqual([7, 9, 10, 11, 12, 13])
    expect(sql).toContain(
      "'revoke all on function %s from public, anon, authenticated'",
    )
  })

  it('re-grants only the current 12-argument admin and 13-argument protected closing signatures', () => {
    const grants = [...migration.matchAll(
      /grant execute on function public\.close_cash_closing\(([\s\S]*?)\) to authenticated;/g,
    )]
    const arities = grants.map(
      (match) => match[1]!.split(',').map((value) => value.trim()).length,
    )
    expect(arities).toEqual([12, 13])
  })
})
