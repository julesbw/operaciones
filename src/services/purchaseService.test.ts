import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/database'
import { EMPTY_CENTRAL_CASH_BILLS } from '../domain/constants'
import type { CreatePurchaseInput, UserProfile } from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: rpcMock },
}))

import {
  PurchaseDomainError,
  mapPurchasePayment,
  normalizePurchaseBreakdown,
  purchaseToRpcArgs,
  purchaseService,
  validatePurchaseInput,
} from './purchaseService'

const admin: UserProfile = {
  id: 'admin-id',
  fullName: 'Administración',
  role: 'admin',
}

const store = {
  id: 'store-id',
  name: 'Tienda Centro',
  status: 'active' as const,
  createdAt: '2026-08-17T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
}

const supplier = {
  id: 'supplier-id',
  name: 'Bimbo',
  isActive: true,
  createdBy: admin.id,
  createdAt: '2026-08-17T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
}

const input: CreatePurchaseInput = {
  purchaseId: 'purchase-id',
  paymentId: 'payment-id',
  supplierId: 'supplier-id',
  businessDate: '2026-08-17',
  amount: 1_280,
  fundingSource: 'store_cash',
  sourceStoreId: 'store-id',
  paymentMethod: 'efectivo',
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

beforeEach(async () => {
  await Promise.all([
    db.stores.clear(),
    db.suppliers.clear(),
    db.purchases.clear(),
    db.purchasePayments.clear(),
    db.syncQueue.clear(),
  ])
  await db.stores.put(store)
  await db.suppliers.put(supplier)
  rpcMock.mockReset()
})

afterEach(async () => {
  await Promise.all([
    db.stores.clear(),
    db.suppliers.clear(),
    db.purchases.clear(),
    db.purchasePayments.clear(),
    db.syncQueue.clear(),
  ])
})

describe('purchase validation', () => {
  it('accepts an exact cash breakdown', () => {
    expect(() => validatePurchaseInput(input)).not.toThrow()
  })

  it('allows store cash without a captured breakdown', () => {
    expect(() =>
      validatePurchaseInput({
        ...input,
        bills: undefined,
        coinsAmount: 0,
      }),
    ).not.toThrow()
  })

  it('allows a non-cash payment without a captured breakdown', () => {
    expect(() =>
      validatePurchaseInput({
        ...input,
        paymentMethod: 'transferencia',
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

  it('normalizes an empty UI breakdown to a payment without breakdown', () => {
    expect(
      normalizePurchaseBreakdown({
        b1000: 0,
        b500: 0,
        b200: 0,
        b100: 0,
        b50: 0,
        b20: 0,
      }),
    ).toEqual({ bills: undefined, coinsAmount: 0 })
  })

  it('preserves a real breakdown', () => {
    expect(normalizePurchaseBreakdown(input.bills, input.coinsAmount)).toEqual({
      bills: input.bills,
      coinsAmount: 10,
    })
  })

  it('maps remote null breakdown to the domain absence', () => {
    expect(
      mapPurchasePayment({
        id: 'payment-id',
        purchase_id: 'purchase-id',
        amount: 10,
        funding_source: 'store_cash',
        source_store_id: 'store-id',
        payment_method: 'efectivo',
        bills: null,
        coins_amount: 0,
        paid_at: '2026-08-17T12:00:00.000Z',
        created_by: 'admin-id',
        created_at: '2026-08-17T12:00:00.000Z',
      }),
    ).toMatchObject({ bills: undefined, coinsAmount: 0 })
  })

  it('keeps a no-breakdown purchase identical after opening and closing the counter', async () => {
    const noCounter = {
      ...input,
      purchaseId: 'purchase-no-breakdown',
      paymentId: 'payment-no-breakdown',
      amount: 100,
      bills: undefined,
      coinsAmount: 0,
    }
    const openedAndClosed = {
      ...noCounter,
      bills: { ...EMPTY_CENTRAL_CASH_BILLS },
      coinsAmount: 0,
    }

    const first = await purchaseService.create(noCounter, admin)
    const retry = await purchaseService.create(openedAndClosed, admin)

    expect(retry).toEqual(first)
    expect(await db.purchasePayments.get(noCounter.paymentId)).toEqual(
      first.payment,
    )
    expect(await db.syncQueue.get(`purchase:${noCounter.purchaseId}`)).toEqual(
      expect.objectContaining({
        entityType: 'purchase',
        entityId: noCounter.purchaseId,
        attempts: 0,
      }),
    )
    expect(
      purchaseToRpcArgs(noCounter, '2026-08-17T12:00:00.000Z'),
    ).toEqual(
      purchaseToRpcArgs(openedAndClosed, '2026-08-17T12:00:00.000Z'),
    )
  })

  it('persists and retries a no-breakdown store purchase with null RPC bills', async () => {
    const created = await purchaseService.create(
      {
        ...input,
        purchaseId: 'purchase-sync',
        paymentId: 'payment-sync',
        amount: 100,
        bills: undefined,
        coinsAmount: 0,
      },
      admin,
    )
    const queueItem = await db.syncQueue.get('purchase:purchase-sync')
    expect(created.payment).toMatchObject({ bills: undefined, coinsAmount: 0 })
    expect(queueItem).toBeDefined()

    await operationsRepository.failQueueItem(queueItem!, 'Sin conexión')
    expect(await db.syncQueue.get('purchase:purchase-sync')).toMatchObject({
      attempts: 1,
      lastError: 'Sin conexión',
    })

    rpcMock.mockResolvedValueOnce({
      data: {
        purchase: {
          id: 'purchase-sync',
          supplier_id: 'supplier-id',
          supplier_name_snapshot: 'Bimbo',
          business_date: '2026-08-17',
          folio: null,
          amount: 100,
          notes: null,
          created_by: 'admin-id',
          created_at: created.purchase.createdAt,
          updated_at: created.purchase.updatedAt,
        },
        payment: {
          id: 'payment-sync',
          purchase_id: 'purchase-sync',
          amount: 100,
          funding_source: 'store_cash',
          source_store_id: 'store-id',
          payment_method: 'efectivo',
          bills: null,
          coins_amount: 0,
          paid_at: created.payment.paidAt,
          created_by: 'admin-id',
          created_at: created.payment.createdAt,
        },
      },
      error: null,
    })

    await purchaseService.sync('purchase-sync')
    expect(rpcMock).toHaveBeenCalledWith(
      'create_paid_purchase',
      expect.objectContaining({ p_bills: null, p_coins_amount: 0 }),
    )

    await operationsRepository.completeQueueItem(queueItem!, 0)
    expect(await db.syncQueue.get('purchase:purchase-sync')).toBeUndefined()
    expect(await db.purchases.get('purchase-sync')).toMatchObject({
      syncStatus: 'synced',
    })
  })

  it('persists real store cash bills', async () => {
    const created = await purchaseService.create(input, admin)

    expect(created.payment).toMatchObject({
      bills: input.bills,
      coinsAmount: input.coinsAmount,
    })
    expect(await db.purchasePayments.get(input.paymentId)).toMatchObject({
      bills: input.bills,
      coinsAmount: input.coinsAmount,
    })
  })
})
