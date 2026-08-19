import { describe, expect, it } from 'vitest'
import type { CreatePurchaseInput } from '../domain/models'
import {
  PurchaseDomainError,
  validatePurchaseInput,
} from './purchaseService'

const input: CreatePurchaseInput = {
  purchaseId: 'purchase-id',
  paymentId: 'payment-id',
  supplierId: 'supplier-id',
  businessDate: '2026-08-17',
  amount: 1_280,
  fundingSource: 'store_cash',
  sourceStoreId: 'store-id',
  paymentMethod: 'efectivo',
  cashBreakdownEnabled: true,
  bills: {
    b1000: 1,
    b500: 0,
    b200: 1,
    b100: 0,
    b50: 1,
    b20: 1,
  },
  coinsAmount: 10,
}

describe('purchase validation', () => {
  it('accepts an exact cash breakdown', () => {
    expect(() => validatePurchaseInput(input)).not.toThrow()
  })

  it('allows store cash without a captured breakdown', () => {
    expect(() =>
      validatePurchaseInput({
        ...input,
        cashBreakdownEnabled: false,
        bills: undefined,
        coinsAmount: 0,
      }),
    ).not.toThrow()
  })

  it('requires a breakdown for central cash even when the toggle is off', () => {
    expect(() =>
      validatePurchaseInput({
        ...input,
        fundingSource: 'central_cash',
        sourceStoreId: undefined,
        cashBreakdownEnabled: false,
        bills: undefined,
        coinsAmount: 0,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PurchaseDomainError>>({
        code: 'PURCHASE_BILLS_MISMATCH',
      }),
    )
  })

  it('accepts a valid central cash breakdown', () => {
    expect(() =>
      validatePurchaseInput({
        ...input,
        fundingSource: 'central_cash',
        sourceStoreId: undefined,
        cashBreakdownEnabled: true,
      }),
    ).not.toThrow()
  })

  it('rejects cash denominations that do not match the amount', () => {
    expect(() =>
      validatePurchaseInput({ ...input, coinsAmount: 9 }),
    ).toThrowError(
      expect.objectContaining<Partial<PurchaseDomainError>>({
        code: 'PURCHASE_BILLS_MISMATCH',
      }),
    )
  })

  it('requires a store only for store cash', () => {
    expect(() =>
      validatePurchaseInput({ ...input, sourceStoreId: undefined }),
    ).toThrowError(
      expect.objectContaining<Partial<PurchaseDomainError>>({
        code: 'PURCHASE_STORE_REQUIRED',
      }),
    )
    expect(() =>
      validatePurchaseInput({
        ...input,
        fundingSource: 'central_cash',
        sourceStoreId: undefined,
      }),
    ).not.toThrow()
  })

  it('rejects amounts that round to zero cents', () => {
    expect(() =>
      validatePurchaseInput({
        ...input,
        amount: 0.001,
        paymentMethod: 'transferencia',
        bills: undefined,
        coinsAmount: 0,
      }),
    ).toThrowError('El monto debe ser mayor a cero.')
  })
})
