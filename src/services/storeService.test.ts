import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { OperationsDatabase } from '../db/database'
import { OperationsRepository } from '../repositories/operationsRepository'
import { buildStoreUpdate } from './storeService'

const store = {
  id: 'store-id',
  name: 'Tienda Centro',
  status: 'active' as const,
  closingReconciliationMode: 'normal' as const,
  createdAt: '2026-08-19T12:00:00.000Z',
  updatedAt: '2026-08-19T12:00:00.000Z',
}

describe('buildStoreUpdate', () => {
  it('preserves the name and store visibility when only the closing mode changes', async () => {
    const database = new OperationsDatabase(`operations-test-${crypto.randomUUID()}`)
    const repository = new OperationsRepository(database)

    try {
      const changes = buildStoreUpdate(
        { closingReconciliationMode: 'sicar' },
        '2026-08-19T13:00:00.000Z',
      )
      expect(changes).not.toHaveProperty('name')

      await repository.saveStore(store)
      await repository.updateStore(store.id, changes)

      await expect(repository.listStores()).resolves.toMatchObject([
        { id: store.id, name: store.name, closingReconciliationMode: 'sicar' },
      ])
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('preserves the closing mode when only the name changes', () => {
    const changes = buildStoreUpdate(
      { name: ' Tienda Norte ' },
      '2026-08-19T13:00:00.000Z',
    )

    expect(changes).toEqual({
      name: 'Tienda Norte',
      updatedAt: '2026-08-19T13:00:00.000Z',
    })
    expect(changes).not.toHaveProperty('closingReconciliationMode')
  })
})
