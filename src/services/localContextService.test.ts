import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { OperationsDatabase } from '../db/database'
import type {
  Expense,
  SyncQueueItem,
  UserProfile,
} from '../domain/models'
import { OperationsRepository } from '../repositories/operationsRepository'
import {
  LocalContextService,
  profileFromLocalContext,
  UserSwitchBlockedError,
} from './localContextService'

const USER_A: UserProfile = {
  id: 'user-a',
  fullName: 'Usuario A',
  role: 'admin',
}

const USER_B: UserProfile = {
  id: 'user-b',
  fullName: 'Usuario B',
  role: 'cashier',
  storeId: 'store-b',
}

function pendingExpense(userId: string): Expense {
  const now = '2026-08-13T12:00:00.000Z'
  return {
    id: 'expense-id',
    storeId: 'store-a',
    businessDate: '2026-08-13',
    amount: 100,
    concept: 'Gasto local',
    paymentMethod: 'efectivo',
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    version: 0,
    syncStatus: 'pending',
  }
}

function queueItem(): SyncQueueItem {
  return {
    id: 'expense:expense-id',
    entityType: 'expense',
    entityId: 'expense-id',
    operation: 'insert',
    createdAt: '2026-08-13T12:00:00.000Z',
    attempts: 0,
  }
}

async function withService(
  test: (
    database: OperationsDatabase,
    repository: OperationsRepository,
    service: LocalContextService,
  ) => Promise<void>,
) {
  const database = new OperationsDatabase(
    `operations-context-test-${crypto.randomUUID()}`,
  )
  const repository = new OperationsRepository(database)
  const service = new LocalContextService(repository)
  try {
    await database.open()
    await test(database, repository, service)
  } finally {
    database.close()
    await database.delete()
  }
}

describe('LocalContextService', () => {
  it('persists the minimum profile needed to render offline', async () => {
    await withService(async (_database, _repository, service) => {
      const context = await service.saveAuthenticatedProfile(USER_B)

      expect(context).toMatchObject({
        id: 'current',
        userId: USER_B.id,
        displayName: USER_B.fullName,
        role: USER_B.role,
        storeId: USER_B.storeId,
        accessState: 'enabled',
      })
      expect(profileFromLocalContext(context)).toEqual(USER_B)
    })
  })

  it('preserves pending writes and blocks a different user', async () => {
    await withService(async (_database, repository, service) => {
      await service.saveAuthenticatedProfile(USER_A)
      await repository.saveExpenseWithQueue(
        pendingExpense(USER_A.id),
        queueItem(),
      )

      await expect(
        service.prepareForAuthenticatedProfile(USER_B),
      ).rejects.toBeInstanceOf(UserSwitchBlockedError)
      await expect(repository.countPendingQueue()).resolves.toBe(1)
      await expect(service.load()).resolves.toMatchObject({
        userId: USER_A.id,
        accessState: 'reauthentication-required',
      })
    })
  })

  it('clears an old synchronized cache before accepting another user', async () => {
    await withService(async (database, repository, service) => {
      await service.saveAuthenticatedProfile(USER_A)
      await database.stores.put({
        id: 'store-a',
        name: 'Tienda A',
        status: 'active',
        createdAt: '2026-08-13T12:00:00.000Z',
        updatedAt: '2026-08-13T12:00:00.000Z',
      })
      await database.expenses.put({
        ...pendingExpense(USER_A.id),
        syncStatus: 'synced',
      })

      await service.prepareForAuthenticatedProfile(USER_B)

      await expect(repository.listStores()).resolves.toEqual([])
      await expect(repository.listExpenses()).resolves.toEqual([])
      await expect(service.load()).resolves.toBeUndefined()
    })
  })

  it('does not assign an unclaimed legacy queue to the wrong account', async () => {
    await withService(async (_database, repository, service) => {
      await repository.saveExpenseWithQueue(
        pendingExpense(USER_A.id),
        queueItem(),
      )

      await expect(
        service.prepareForAuthenticatedProfile(USER_B),
      ).rejects.toBeInstanceOf(UserSwitchBlockedError)
      await expect(
        service.prepareForAuthenticatedProfile(USER_A),
      ).resolves.toBeUndefined()
      await expect(repository.countPendingQueue()).resolves.toBe(1)
    })
  })

  it('disables offline access without deleting pending data', async () => {
    await withService(async (_database, repository, service) => {
      const context = await service.saveAuthenticatedProfile(USER_A)
      const initializedAt = context.initializedAt
      await repository.saveExpenseWithQueue(
        pendingExpense(USER_A.id),
        queueItem(),
      )

      await service.setAccessState('signed-out')

      const saved = await service.load()
      expect(saved?.accessState).toBe('signed-out')
      expect(saved?.initializedAt).toBe(initializedAt)
      await expect(repository.countPendingQueue()).resolves.toBe(1)
    })
  })
})
