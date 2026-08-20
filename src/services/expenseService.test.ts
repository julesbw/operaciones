import { describe, expect, it } from 'vitest'
import { validateExpense } from './expenseService'

const validInput = {
  storeId: 'store-id',
  businessDate: '2026-08-06',
  amount: 50,
  concept: 'Carne',
  paymentMethod: 'efectivo' as const,
  fundingSource: 'store_cash' as const,
  sourceStoreId: 'store-id',
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

  it('requires an exact bill and coin breakdown for central cash', () => {
    const centralInput = {
      ...validInput,
      amount: 1_000,
      fundingSource: 'central_cash' as const,
      sourceStoreId: undefined,
      bills: {
        b1000: 1,
        b500: 0,
        b200: 0,
        b100: 0,
        b50: 0,
        b20: 0,
      },
      coinsAmount: 0,
    }

    expect(validateExpense(centralInput)).toEqual([])
    expect(
      validateExpense({
        ...centralInput,
        bills: { ...centralInput.bills, b500: 1 },
      }),
    ).toContain('Las denominaciones deben sumar exactamente el monto')
  })
})
