import { describe, expect, it, vi } from 'vitest'
import type { LocalAppContext, SyncQueueItem } from '../domain/models'

const mocks = vi.hoisted(() => ({
  completeQueueItem: vi.fn(),
  countPendingQueue: vi.fn(),
  failQueueItem: vi.fn(),
  getLocalAppContext: vi.fn(),
  listPendingQueue: vi.fn(),
  markEntitySyncStatus: vi.fn(),
  saveRemoteAttendance: vi.fn(),
  saveRemoteExpenses: vi.fn(),
  saveRemoteMerchandiseTransfers: vi.fn(),
  purchaseSync: vi.fn(),
  getSession: vi.fn(),
  from: vi.fn(),
  isNetworkAvailable: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    from: mocks.from,
  },
}))

vi.mock('../repositories/operationsRepository', () => ({
  operationsRepository: {
    completeQueueItem: mocks.completeQueueItem,
    countPendingQueue: mocks.countPendingQueue,
    failQueueItem: mocks.failQueueItem,
    getLocalAppContext: mocks.getLocalAppContext,
    listPendingQueue: mocks.listPendingQueue,
    markEntitySyncStatus: mocks.markEntitySyncStatus,
    saveRemoteAttendance: mocks.saveRemoteAttendance,
    saveRemoteExpenses: mocks.saveRemoteExpenses,
    saveRemoteMerchandiseTransfers: mocks.saveRemoteMerchandiseTransfers,
  },
}))

vi.mock('./connectivityService', () => ({
  connectivityService: {
    isNetworkAvailable: mocks.isNetworkAvailable,
  },
}))

vi.mock('./purchaseService', () => ({
  purchaseService: { sync: mocks.purchaseSync },
}))

import { SyncService } from './syncService'

const context: LocalAppContext = {
  id: 'current',
  userId: 'user-id',
  displayName: 'Administración',
  role: 'admin',
  accessState: 'enabled',
  initializedAt: '2026-08-19T12:00:00.000Z',
  lastAuthenticatedAt: '2026-08-19T12:00:00.000Z',
  updatedAt: '2026-08-19T12:00:00.000Z',
}

const pendingPurchase: SyncQueueItem = {
  id: 'purchase:purchase-id',
  entityType: 'purchase',
  entityId: 'purchase-id',
  operation: 'insert',
  createdAt: '2026-08-19T12:00:00.000Z',
  attempts: 1,
  nextAttemptAt: '2999-01-01T00:00:00.000Z',
}

describe('SyncService manual retry', () => {
  it('bypasses backoff only when forceRetry is requested', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    mocks.from.mockReturnValue(query)
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-id' } } },
      error: null,
    })
    mocks.getLocalAppContext.mockResolvedValue(context)
    mocks.isNetworkAvailable.mockReturnValue(true)
    mocks.listPendingQueue.mockResolvedValue([pendingPurchase])
    mocks.countPendingQueue.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    mocks.purchaseSync.mockResolvedValue(undefined)
    mocks.completeQueueItem.mockResolvedValue(undefined)
    mocks.markEntitySyncStatus.mockResolvedValue(undefined)
    mocks.saveRemoteAttendance.mockResolvedValue(undefined)
    mocks.saveRemoteExpenses.mockResolvedValue(undefined)
    mocks.saveRemoteMerchandiseTransfers.mockResolvedValue(undefined)

    const service = new SyncService()

    await expect(service.process()).resolves.toMatchObject({
      synced: 0,
      failed: 0,
      pending: 1,
    })
    expect(mocks.purchaseSync).not.toHaveBeenCalled()

    await expect(service.process({ forceRetry: true })).resolves.toMatchObject({
      synced: 1,
      failed: 0,
      pending: 0,
    })
    expect(mocks.purchaseSync).toHaveBeenCalledWith('purchase-id')
  })

  it('does not synchronize an item attributed to a different operator', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    mocks.from.mockReturnValue(query)
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-id' } } },
      error: null,
    })
    mocks.getLocalAppContext.mockResolvedValue(context)
    mocks.isNetworkAvailable.mockReturnValue(true)
    mocks.listPendingQueue.mockResolvedValue([
      { ...pendingPurchase, id: 'purchase:operator-a', entityId: 'operator-a', operatorAccountId: 'operator-a' },
      { ...pendingPurchase, id: 'purchase:operator-b', entityId: 'operator-b', operatorAccountId: 'operator-b' },
    ])
    mocks.countPendingQueue.mockResolvedValue(1)
    mocks.purchaseSync.mockResolvedValue(undefined)
    mocks.completeQueueItem.mockResolvedValue(undefined)
    mocks.markEntitySyncStatus.mockResolvedValue(undefined)
    mocks.saveRemoteAttendance.mockResolvedValue(undefined)
    mocks.saveRemoteExpenses.mockResolvedValue(undefined)
    mocks.saveRemoteMerchandiseTransfers.mockResolvedValue(undefined)

    const service = new SyncService()

    await service.process({ forceRetry: true, operatorAccountId: 'operator-a' })

    expect(mocks.purchaseSync).toHaveBeenCalledWith('operator-a')
    expect(mocks.purchaseSync).not.toHaveBeenCalledWith('operator-b')
  })
})
