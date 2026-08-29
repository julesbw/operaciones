import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperatorSession, UserProfile } from '../domain/models'
import type { CashClosingRow } from '../types/database'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  replaceCachedCashClosingsForScope: vi.fn(),
  getCachedCashClosingDetail: vi.fn(),
  saveCachedCashClosingDetail: vi.fn(),
  saveCachedCashClosing: vi.fn(),
  requireOnline: vi.fn(),
  getRequiredActiveSession: vi.fn(),
  getRequiredActiveToken: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: mocks.rpc },
}))

vi.mock('../repositories/operationsRepository', () => ({
  operationsRepository: {
    replaceCachedCashClosingsForScope: mocks.replaceCachedCashClosingsForScope,
    getCachedCashClosingDetail: mocks.getCachedCashClosingDetail,
    saveCachedCashClosingDetail: mocks.saveCachedCashClosingDetail,
    saveCachedCashClosing: mocks.saveCachedCashClosing,
  },
}))

vi.mock('./connectivityService', () => ({
  connectivityService: { requireOnline: mocks.requireOnline },
}))

vi.mock('./operatorSessionService', () => ({
  operatorSessionService: {
    getRequiredActiveSession: mocks.getRequiredActiveSession,
    getRequiredActiveToken: mocks.getRequiredActiveToken,
  },
}))

import { cashClosingCacheService } from './cashClosingCacheService'

const admin: UserProfile = {
  id: 'admin-id',
  fullName: 'Administración',
  role: 'admin',
}

const manager: UserProfile = {
  id: 'technical-user-id',
  fullName: 'Cajero técnico',
  role: 'cashier',
  storeId: 'north',
}

const managerSession: OperatorSession = {
  token: 'operator-token',
  expiresAt: '2999-01-01T00:00:00.000Z',
  account: {
    id: 'manager-id',
    username: 'manager',
    displayName: 'Encargada',
    role: 'store_manager',
    storeId: 'north',
  },
}

const closing = {
  id: 'closing-id',
  store_id: 'north',
  business_date: '2026-08-28',
} as CashClosingRow

const bills = {
  b1000: 0,
  b500: 0,
  b200: 0,
  b100: 0,
  b50: 0,
  b20: 0,
}

describe('CashClosingCacheService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.replaceCachedCashClosingsForScope.mockResolvedValue(undefined)
    mocks.saveCachedCashClosingDetail.mockResolvedValue('closing-id')
    mocks.saveCachedCashClosing.mockResolvedValue('closing-id')
  })

  it('refreshes the requested admin scope and persists cached rows', async () => {
    mocks.rpc.mockResolvedValue({ data: [closing], error: null })

    await expect(
      cashClosingCacheService.refreshList({
        user: admin,
        storeId: 'north',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-28',
      }),
    ).resolves.toEqual([closing])

    expect(mocks.rpc).toHaveBeenCalledWith('list_cash_closings', {
      p_operator_token: null,
      p_store_id: 'north',
      p_date_from: '2026-08-01',
      p_date_to: '2026-08-28',
    })
    expect(mocks.replaceCachedCashClosingsForScope).toHaveBeenCalledWith(
      [expect.objectContaining({ id: closing.id, cachedAt: expect.any(String) })],
      'north',
      '2026-08-01',
      '2026-08-28',
    )
  })

  it('forces a store manager to use the assigned store and rejects another store', async () => {
    await expect(
      cashClosingCacheService.refreshList({
        user: manager,
        operatorSession: managerSession,
        storeId: 'center',
      }),
    ).rejects.toMatchObject({ code: 'OPERATOR_STORE_FORBIDDEN' })
    expect(mocks.rpc).not.toHaveBeenCalled()

    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await cashClosingCacheService.refreshList({
      user: manager,
      operatorSession: managerSession,
    })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'list_cash_closings',
      expect.objectContaining({
        p_operator_token: managerSession.token,
        p_store_id: 'north',
      }),
    )
  })

  it('maps and stores a remotely refreshed detail', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        closing,
        expenses: [],
        transfers: [],
        payments: [],
        purchases: [],
        adjustments: [
          {
            id: 'adjustment-id',
            cash_closing_id: closing.id,
            type: 'inflow',
            amount: '125.50',
            concept: 'Diferencia',
            notes: null,
            bills,
            coins_amount: '0',
            created_by: admin.id,
            created_at: '2026-08-28T20:00:00.000Z',
          },
        ],
      },
      error: null,
    })

    await expect(
      cashClosingCacheService.refreshDetail('closing-id', { user: admin }),
    ).resolves.toMatchObject({
      closing,
      adjustments: [
        expect.objectContaining({
          cashClosingId: 'closing-id',
          amount: 125.5,
          coinsAmount: 0,
        }),
      ],
    })
    expect(mocks.saveCachedCashClosingDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        closingId: 'closing-id',
        cachedAt: expect.any(String),
      }),
    )
  })

  it('stores an authoritative closing immediately', async () => {
    await expect(cashClosingCacheService.saveClosing(closing)).resolves.toBe(
      'closing-id',
    )
    expect(mocks.saveCachedCashClosing).toHaveBeenCalledWith(
      expect.objectContaining({
        id: closing.id,
        cachedAt: expect.any(String),
      }),
    )
  })
})
