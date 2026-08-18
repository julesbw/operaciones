import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/202608180001_closing_adjustments.sql', import.meta.url),
  'utf8',
)
const correctionMigration = readFileSync(
  new URL('../../supabase/migrations/202608180002_closing_adjustment_denominations.sql', import.meta.url),
  'utf8',
)
const exportMigration = readFileSync(
  new URL('../../supabase/migrations/202608140001_operations_export_batches.sql', import.meta.url),
  'utf8',
)

describe('closing adjustments migration transition guards', () => {
  it('keeps the critical prepared/cancelled/confirmed transition authoritative', () => {
    expect(migration).toContain("batch.status = 'prepared'")
    expect(migration).toContain("batch.status = 'confirmed'")
    expect(migration).toContain("where adjustment.cash_closing_id")
    expect(migration).toContain('CLOSING_ADJUSTMENT_EXPORT_PREPARED')
    expect(migration).toContain('CLOSING_ADJUSTMENT_ALREADY_EXPORTED')
    expect(exportMigration).toContain("status = 'cancelled'")
    expect(exportMigration).toContain("reservation_status = 'released'")
  })

  it('revalidates central receipt, physical result and idempotency in the RPC', () => {
    expect(migration).toContain('for update')
    expect(migration).toContain('CLOSING_ADJUSTMENT_ALREADY_RECEIVED')
    expect(migration).toContain('CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT')
    expect(migration).toContain('CLOSING_ADJUSTMENT_REQUEST_ID_CONFLICT')
    expect(migration).toContain('cash_closing_adjustments_immutable')
    expect(migration).toContain('operations_closing_effective_withdraw_bills')
    expect(migration).toContain('receive_cash_closing_into_central_cash')
    expect(migration).toContain('operations_export_apply_closing_adjustments')
  })

  it('rejects negative effective denominations in the corrective migration', () => {
    expect(correctionMigration).toContain('create or replace function public.create_cash_closing_adjustment')
    expect(correctionMigration).toContain("not private.operations_central_cash_valid_bills(v_effective_bills - 'monedas')")
    expect(correctionMigration).toContain('v_effective_coins < 0')
    expect(correctionMigration).toContain('v_effective_amount < 0')
    expect(correctionMigration).toContain('v_effective_counted < v_closing.cash_balance')
    expect(correctionMigration).toContain('CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT')
  })
})
