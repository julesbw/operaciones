import { describe, expect, it } from 'vitest'
import { validOperationsExportFile } from '../testFixtures/operationsExport'
import { validateOperationsExportFile } from './exportValidation'

describe('Operations export 2.0 validation', () => {
  it('reconciles financial movements independently from physical cash', () => {
    const payload = validOperationsExportFile()

    expect(validateOperationsExportFile(payload)).toEqual([])
    expect(payload.cortes[0]?.financial_movements).toHaveLength(4)
    expect(
      payload.cortes[0]?.financial_movements.some(
        (movement) => movement.monto === 2_500,
      ),
    ).toBe(false)
    expect(payload.cortes[0]?.physical_cash.coins_amount).toBe(50)
  })

  it('rejects an additional total movement that would duplicate expenses', () => {
    const payload = validOperationsExportFile()
    payload.cortes[0]!.financial_movements.push({
      ...payload.cortes[0]!.financial_movements[1]!,
      id: '88888888-8888-4888-8888-888888888888',
      source_id: '88888888-8888-4888-8888-888888888888',
      monto: 500,
      concepto: 'Total gastos',
    })

    expect(validateOperationsExportFile(payload).join('\n')).toContain(
      'salidas de gastos',
    )
  })

  it('rejects a physical amount that does not include coins', () => {
    const payload = validOperationsExportFile()
    payload.cortes[0]!.physical_cash.coins_amount = 0

    expect(validateOperationsExportFile(payload).join('\n')).toContain(
      'billetes, monedas',
    )
  })
})
