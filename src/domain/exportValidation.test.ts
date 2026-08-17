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

  it('reconciles the additive purchase extension without changing contract 2.0', () => {
    const payload = validOperationsExportFile()
    const closing = payload.cortes[0]!
    closing.gross_cash += 1_280
    closing.purchases_total = 1_280
    closing.cash_purchases_total = 1_280
    closing.purchase_items = [
      {
        id: '99999999-9999-4999-8999-999999999999',
        payment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        amount: 1_280,
        supplier_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        supplier_name: 'Bimbo',
        folio: 'N-42',
        payment_method: 'cash',
        affects_cash: true,
      },
    ]
    closing.financial_movements[0]!.monto = closing.gross_cash
    closing.financial_movements.push({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source_type: 'purchase',
      source_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tipo: 'salida',
      fecha_movimiento: closing.business_date,
      monto: 1_280,
      concepto: 'Compra Bimbo',
      categoria: 'Compra',
      store_id: closing.store_id,
    })

    expect(validateOperationsExportFile(payload)).toEqual([])
  })

  it('rejects a physical amount that does not include coins', () => {
    const payload = validOperationsExportFile()
    payload.cortes[0]!.physical_cash.coins_amount = 0

    expect(validateOperationsExportFile(payload).join('\n')).toContain(
      'billetes, monedas',
    )
  })
})
