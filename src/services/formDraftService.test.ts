import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExpenseDraftData } from './formDraftService'
import {
  formDraftService,
  isExpenseDraftData,
} from './formDraftService'

const expenseData: ExpenseDraftData = {
  formStoreId: 'store-a',
  formDate: '2026-08-30',
  amount: '125.50',
  concept: 'Material de limpieza',
  requestId: 'request-a',
  fundingSource: 'store_cash',
  paymentMethod: 'efectivo',
  bills: {
    b1000: 0,
    b500: 0,
    b200: 0,
    b100: 1,
    b50: 0,
    b20: 0,
  },
  coinsAmount: 25.5,
  cashBreakdownOpen: true,
  notes: 'Urgente',
}

function createSessionStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  }
}

describe('formDraftService', () => {
  let sessionStorage: ReturnType<typeof createSessionStorage>

  beforeEach(() => {
    sessionStorage = createSessionStorage()
    vi.stubGlobal('window', { sessionStorage })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists a versioned draft and preserves its creation time on updates', () => {
    const first = formDraftService.save('expense', 'operator-a', expenseData)
    expect(first).toMatchObject({
      version: 1,
      ownerId: 'operator-a',
      data: expenseData,
    })

    const second = formDraftService.save('expense', 'operator-a', {
      ...expenseData,
      amount: '200',
    })

    expect(second?.createdAt).toBe(first?.createdAt)
    expect(second?.updatedAt).toBeTruthy()
    expect(
      formDraftService.read('expense', 'operator-a', isExpenseDraftData),
    ).toMatchObject({
      ownerId: 'operator-a',
      data: { amount: '200' },
    })
  })

  it('does not expose or clear a draft owned by another operator', () => {
    formDraftService.save('expense', 'operator-a', expenseData)

    expect(
      formDraftService.read('expense', 'operator-b', isExpenseDraftData),
    ).toBeUndefined()
    formDraftService.clear('expense', 'operator-b')
    expect(sessionStorage.removeItem).not.toHaveBeenCalled()

    formDraftService.clear('expense', 'operator-a')
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(
      'operaciones.form-draft.expense',
    )
  })

  it('discards incompatible or malformed drafts safely', () => {
    sessionStorage.setItem(
      'operaciones.form-draft.expense',
      JSON.stringify({
        version: 2,
        ownerId: 'operator-a',
        createdAt: '2026-08-30T12:00:00.000Z',
        updatedAt: '2026-08-30T12:00:00.000Z',
        data: expenseData,
      }),
    )

    expect(
      formDraftService.read('expense', 'operator-a', isExpenseDraftData),
    ).toBeUndefined()
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(
      'operaciones.form-draft.expense',
    )

    sessionStorage.setItem('operaciones.form-draft.expense', '{invalid')
    expect(
      formDraftService.read('expense', 'operator-a', isExpenseDraftData),
    ).toBeUndefined()
  })
})

