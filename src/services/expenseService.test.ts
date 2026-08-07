import { describe, expect, it } from 'vitest'
import { validateExpense } from './expenseService'

const validInput = {
  storeId: 'store-id',
  businessDate: '2026-08-06',
  amount: 50,
  concept: 'Carne',
  paymentMethod: 'efectivo' as const,
  notes: '',
}

describe('validateExpense', () => {
  it('accepts the minimum expense data', () => {
    expect(validateExpense(validInput)).toEqual([])
  })

  it('rejects invalid amounts and blank concepts', () => {
    expect(validateExpense({ ...validInput, amount: 0, concept: '  ' })).toEqual([
      'El monto debe ser mayor a cero',
      'Escribe el concepto del gasto',
    ])
  })
})
