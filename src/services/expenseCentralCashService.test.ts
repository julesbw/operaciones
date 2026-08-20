import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExpenseInput, UserProfile } from '../domain/models'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  saveExpenseWithQueue: vi.fn(),
  saveRemoteExpenses: vi.fn(),
  getSummary: vi.fn(),
  listMovements: vi.fn(),
  isNetworkAvailable: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: mocks.rpc },
}))

vi.mock('../repositories/operationsRepository', () => ({
  operationsRepository: {
    saveExpenseWithQueue: mocks.saveExpenseWithQueue,
    saveRemoteExpenses: mocks.saveRemoteExpenses,
  },
}))

vi.mock('./centralCashService', () => ({
  centralCashService: {
    getSummary: mocks.getSummary,
    listMovements: mocks.listMovements,
  },
}))

vi.mock('./connectivityService', () => ({
  connectivityService: {
    isNetworkAvailable: mocks.isNetworkAvailable,
  },
}))

import { expenseService } from './expenseService'

const admin: UserProfile = {
  id: 'admin-id',
  fullName: 'Administración',
  role: 'admin',
}

const cashier: UserProfile = {
  id: 'cashier-id',
  fullName: 'Cajero',
  role: 'cashier',
  storeId: 'store-id',
}

const bills = {
  b1000: 1,
  b500: 0,
  b200: 0,
  b100: 0,
  b50: 0,
  b20: 0,
}

const storeCashInput: ExpenseInput = {
  storeId: 'store-id',
  businessDate: '2026-08-19',
  amount: 100,
  concept: 'Gasto local',
  paymentMethod: 'efectivo',
  fundingSource: 'store_cash',
  sourceStoreId: 'store-id',
  notes: '',
}

const centralCashInput: ExpenseInput = {
  ...storeCashInput,
  amount: 1_000,
  concept: 'Gasto central',
  fundingSource: 'central_cash',
  sourceStoreId: undefined,
  requestId: 'expense-request-id',
  bills,
  coinsAmount: 0,
}

const expenseRow = {
  id: 'expense-request-id',
  store_id: 'store-id',
  business_date: '2026-08-19',
  amount: 1_000,
  concept: 'Gasto central',
  payment_method: 'efectivo' as const,
  funding_source: 'central_cash' as const,
  source_store_id: null,
  notes: null,
  weekly_payment_id: null,
  created_by: admin.id,
  created_at: '2026-08-19T12:00:00.000Z',
  updated_at: '2026-08-19T12:00:00.000Z',
  version: 1,
}

describe('ExpenseService central cash boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isNetworkAvailable.mockReturnValue(true)
    mocks.saveExpenseWithQueue.mockResolvedValue(undefined)
    mocks.saveRemoteExpenses.mockResolvedValue(undefined)
    mocks.getSummary.mockResolvedValue({ data: {}, fromCache: false })
    mocks.listMovements.mockResolvedValue({ data: [], fromCache: false })
    mocks.rpc.mockResolvedValue({
      data: { expense: expenseRow },
      error: null,
    })
  })

  it('keeps store cash local-first and queues it for sync', async () => {
    const created = await expenseService.create(storeCashInput, admin)

    expect(created).toMatchObject({
      fundingSource: 'store_cash',
      sourceStoreId: 'store-id',
      syncStatus: 'pending',
    })
    expect(mocks.saveExpenseWithQueue).toHaveBeenCalledOnce()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.saveRemoteExpenses).not.toHaveBeenCalled()
  })

  it('uses the central RPC without creating a local sync queue item', async () => {
    const created = await expenseService.create(centralCashInput, admin)

    expect(created).toMatchObject({
      id: 'expense-request-id',
      fundingSource: 'central_cash',
      sourceStoreId: undefined,
      syncStatus: 'synced',
    })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_central_cash_expense',
      expect.objectContaining({
        p_expense_id: 'expense-request-id',
        p_funding_source: 'central_cash',
        p_bills: bills,
        p_coins_amount: 0,
      }),
    )
    expect(mocks.saveRemoteExpenses).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'expense-request-id' }),
    ])
    expect(mocks.saveExpenseWithQueue).not.toHaveBeenCalled()
    expect(mocks.getSummary).toHaveBeenCalledOnce()
    expect(mocks.listMovements).toHaveBeenCalledOnce()
  })

  it('blocks central cash offline before any persistence or RPC call', async () => {
    mocks.isNetworkAvailable.mockReturnValue(false)

    await expect(expenseService.create(centralCashInput, admin)).rejects.toMatchObject({
      code: 'EXPENSE_CENTRAL_CASH_REQUIRES_ONLINE',
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.saveRemoteExpenses).not.toHaveBeenCalled()
    expect(mocks.saveExpenseWithQueue).not.toHaveBeenCalled()
  })

  it('rejects a central cash expense from a cashier before persistence', async () => {
    await expect(expenseService.create(centralCashInput, cashier)).rejects.toMatchObject({
      code: 'EXPENSE_REQUIRES_ADMIN',
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.saveRemoteExpenses).not.toHaveBeenCalled()
    expect(mocks.saveExpenseWithQueue).not.toHaveBeenCalled()
  })

  it('surfaces an insufficient-central-cash rejection without local writes', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'EXPENSE_INSUFFICIENT_CENTRAL_CASH' },
    })

    await expect(expenseService.create(centralCashInput, admin)).rejects.toMatchObject({
      code: 'EXPENSE_INSUFFICIENT_CENTRAL_CASH',
    })
    expect(mocks.saveRemoteExpenses).not.toHaveBeenCalled()
    expect(mocks.saveExpenseWithQueue).not.toHaveBeenCalled()
  })
})
