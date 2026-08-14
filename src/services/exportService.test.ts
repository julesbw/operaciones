import { describe, expect, it } from 'vitest'
import type { ExportBatch } from '../domain/exportContract'
import { validOperationsExportFile } from '../testFixtures/operationsExport'
import { buildExportFilename, serializeExportFile } from './exportService'

function batch(): ExportBatch {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    contractVersion: '2.0',
    status: 'prepared',
    payloadSnapshot: validOperationsExportFile(),
    createdBy: '99999999-9999-4999-8999-999999999999',
    createdAt: '2026-08-14T18:00:00.000Z',
  }
}

describe('ExportService file generation', () => {
  it('serializes the authoritative snapshot without flattening physical cash', () => {
    const serialized = serializeExportFile(batch().payloadSnapshot)
    const parsed = JSON.parse(serialized)

    expect(parsed.version).toBe('2.0')
    expect(parsed.cortes[0].financial_movements).toHaveLength(4)
    expect(parsed.cortes[0].physical_cash).toMatchObject({
      amount: 8_000,
      bills_total: 7_950,
      coins_amount: 50,
    })
  })

  it('uses date and short batch id in the filename', () => {
    expect(buildExportFilename(batch())).toBe(
      'operaciones_2026-08-14_66666666.json',
    )
  })
})
