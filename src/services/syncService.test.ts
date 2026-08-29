import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalAppContext, SyncQueueItem } from '../domain/models'

const mocks = vi.hoisted(() => ({
  completeQueueItem: vi.fn(),
  countPendingQueue: vi.fn(),
  failQueueItem: vi.fn(),
  getAttendance: vi.fn(),
  getLocalAppContext: vi.fn(),
  listPendingQueue: vi.fn(),
  markEntitySyncStatus: vi.fn(),
  reconcileAttendanceQueueItem: vi.fn(),
  saveRemoteAttendance: vi.fn(),
  saveRemoteExpenses: vi.fn(),
  saveRemoteMerchandiseTransfers: vi.fn(),
  purchaseSync: vi.fn(),
  getSession: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  isNetworkAvailable: vi.fn(),
  getRequiredActiveSession: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    from: mocks.from,
    rpc: mocks.rpc,
  },
}))

vi.mock('../repositories/operationsRepository', () => ({
  operationsRepository: {
    completeQueueItem: mocks.completeQueueItem,
    countPendingQueue: mocks.countPendingQueue,
    failQueueItem: mocks.failQueueItem,
    getAttendance: mocks.getAttendance,
    getLocalAppContext: mocks.getLocalAppContext,
    listPendingQueue: mocks.listPendingQueue,
    markEntitySyncStatus: mocks.markEntitySyncStatus,
    reconcileAttendanceQueueItem: mocks.reconcileAttendanceQueueItem,
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

vi.mock('./operatorSessionService', () => ({
  operatorSessionService: {
    getRequiredActiveSession: mocks.getRequiredActiveSession,
  },
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
    expect(mocks.purchaseSync).toHaveBeenCalledWith('purchase-id', null)
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
    mocks.getLocalAppContext.mockResolvedValue({
      ...context,
      role: 'cashier',
      storeId: 'store-id',
    })
    mocks.getRequiredActiveSession.mockReturnValue({
      token: 'operator-token',
      expiresAt: '2999-01-01T00:00:00.000Z',
      account: {
        id: 'operator-a',
        username: 'operator-a',
        displayName: 'Operador A',
        role: 'store_manager',
        storeId: 'store-id',
      },
    })
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

    expect(mocks.purchaseSync).toHaveBeenCalledWith('operator-a', 'operator-token')
    expect(mocks.purchaseSync).not.toHaveBeenCalledWith('operator-b', 'operator-token')
  })

  it('keeps legacy unattributed work pending with an actionable error', async () => {
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
    mocks.getLocalAppContext.mockResolvedValue({
      ...context,
      role: 'cashier',
      storeId: 'store-id',
    })
    mocks.getRequiredActiveSession.mockReturnValue({
      token: 'operator-token',
      expiresAt: '2999-01-01T00:00:00.000Z',
      account: {
        id: 'operator-a',
        username: 'operator-a',
        displayName: 'Operador A',
        role: 'store_manager',
        storeId: 'store-id',
      },
    })
    mocks.isNetworkAvailable.mockReturnValue(true)
    mocks.listPendingQueue.mockResolvedValue([
      { ...pendingPurchase, operatorAccountId: null },
    ])
    mocks.countPendingQueue.mockResolvedValue(1)
    mocks.saveRemoteAttendance.mockResolvedValue(undefined)
    mocks.saveRemoteExpenses.mockResolvedValue(undefined)
    mocks.saveRemoteMerchandiseTransfers.mockResolvedValue(undefined)

    const service = new SyncService()
    const result = await service.process({
      forceRetry: true,
      operatorAccountId: 'operator-a',
    })

    expect(result).toMatchObject({ synced: 0, failed: 1, pending: 1 })
    expect(result.errors?.[0]).toContain('sin identidad operativa')
    expect(mocks.failQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: pendingPurchase.id }),
      expect.stringContaining('sin identidad operativa'),
      expect.objectContaining({
        errorCode: 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED',
        diagnosticError: 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED',
        lastAttemptAt: expect.any(String),
      }),
    )
    expect(mocks.purchaseSync).not.toHaveBeenCalled()
  })

  it('preserves a pending purchase after a server-side role downgrade', async () => {
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
    mocks.getLocalAppContext.mockResolvedValue({
      ...context,
      role: 'cashier',
      storeId: 'store-id',
    })
    mocks.getRequiredActiveSession.mockReturnValue({
      token: 'new-session-token',
      expiresAt: '2999-01-01T00:00:00.000Z',
      account: {
        id: 'operator-a',
        username: 'operator-a',
        displayName: 'Operador A',
        role: 'cashier',
        storeId: 'store-id',
      },
    })
    mocks.isNetworkAvailable.mockReturnValue(true)
    mocks.listPendingQueue.mockResolvedValue([
      { ...pendingPurchase, operatorAccountId: 'operator-a' },
    ])
    mocks.countPendingQueue.mockResolvedValue(1)
    mocks.purchaseSync.mockRejectedValue(
      new Error('OPERATOR_CAPABILITY_FORBIDDEN'),
    )
    mocks.saveRemoteAttendance.mockResolvedValue(undefined)
    mocks.saveRemoteExpenses.mockResolvedValue(undefined)
    mocks.saveRemoteMerchandiseTransfers.mockResolvedValue(undefined)

    const service = new SyncService()
    const result = await service.process({
      forceRetry: true,
      operatorAccountId: 'operator-a',
    })

    expect(result).toMatchObject({ synced: 0, failed: 1, pending: 1 })
    expect(result.errors?.[0]).toContain('rol actual')
    expect(mocks.completeQueueItem).not.toHaveBeenCalled()
    expect(mocks.failQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: pendingPurchase.id }),
      expect.stringContaining('rol actual'),
      expect.objectContaining({
        errorCode: 'SYNC_FAILED',
        diagnosticError: 'OPERATOR_CAPABILITY_FORBIDDEN',
        lastAttemptAt: expect.any(String),
      }),
    )
  })

  it('persists a safe Supabase code and diagnostic details', async () => {
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
      { ...pendingPurchase, nextAttemptAt: undefined },
    ])
    mocks.countPendingQueue.mockResolvedValue(1)
    mocks.purchaseSync.mockRejectedValue({
      code: 'P0001',
      message: 'Attendance already belongs to a confirmed payment',
      details: 'The attendance record cannot be changed',
      hint: 'Review the payment',
    })
    mocks.saveRemoteAttendance.mockResolvedValue(undefined)
    mocks.saveRemoteExpenses.mockResolvedValue(undefined)
    mocks.saveRemoteMerchandiseTransfers.mockResolvedValue(undefined)

    const service = new SyncService()
    const result = await service.process({ forceRetry: true })

    expect(result).toMatchObject({ synced: 0, failed: 1, pending: 1 })
    expect(mocks.failQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: pendingPurchase.id }),
      'No se pudo sincronizar esta operación',
      expect.objectContaining({
        errorCode: 'P0001',
        diagnosticError:
          'Attendance already belongs to a confirmed payment · The attendance record cannot be changed · Review the payment',
        lastAttemptAt: expect.any(String),
      }),
    )
  })

  it('reconciles a paid attendance instead of retrying the rejected update', async () => {
    const remoteAttendance = {
      id: 'attendance-id',
      collaborator_id: 'collaborator-id',
      store_id: 'store-id',
      attendance_date: '2026-08-28',
      status: 'present' as const,
      recorded_by: 'user-id',
      recorded_by_operator_account_id: null,
      created_at: '2026-08-28T12:00:00.000Z',
      updated_at: '2026-08-28T13:00:00.000Z',
      version: 4,
    }
    const attendanceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: remoteAttendance,
        error: null,
      }),
      returns: vi.fn().mockResolvedValue({
        data: [remoteAttendance],
        error: null,
      }),
    }
    const otherQuery = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    mocks.from.mockImplementation((table: string) =>
      table === 'attendance_records' ? attendanceQuery : otherQuery,
    )
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-id' } } },
      error: null,
    })
    mocks.getLocalAppContext.mockResolvedValue(context)
    mocks.isNetworkAvailable.mockReturnValue(true)
    mocks.listPendingQueue.mockResolvedValue([
      {
        id: 'attendance:attendance-id',
        entityType: 'attendance',
        entityId: 'attendance-id',
        operation: 'update',
        createdAt: '2026-08-28T12:30:00.000Z',
        attempts: 2,
      },
    ])
    mocks.getAttendance.mockResolvedValue({
      id: 'attendance-id',
      collaboratorId: 'collaborator-id',
      storeId: 'store-id',
      attendanceDate: '2026-08-28',
      status: 'absent',
      recordedBy: 'user-id',
      operatorAccountId: null,
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:30:00.000Z',
      version: 3,
      syncStatus: 'pending',
    })
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '55000',
        message: 'PAID_ATTENDANCE_IMMUTABLE',
      },
    })
    mocks.countPendingQueue.mockResolvedValue(0)
    mocks.reconcileAttendanceQueueItem.mockResolvedValue(undefined)
    mocks.saveRemoteAttendance.mockResolvedValue(undefined)
    mocks.saveRemoteExpenses.mockResolvedValue(undefined)
    mocks.saveRemoteMerchandiseTransfers.mockResolvedValue(undefined)

    const service = new SyncService()
    const result = await service.process({ forceRetry: true })

    expect(result).toMatchObject({ synced: 1, failed: 0, pending: 0 })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'sync_attendance',
      expect.objectContaining({ p_status: 'absent' }),
    )
    expect(mocks.reconcileAttendanceQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'attendance-id' }),
      expect.objectContaining({
        id: 'attendance-id',
        status: 'present',
        version: 4,
        syncStatus: 'synced',
      }),
    )
    expect(mocks.failQueueItem).not.toHaveBeenCalled()
  })

  it('reconciles existing paid-attendance queue metadata without another RPC attempt', async () => {
    const remoteAttendance = {
      id: 'attendance-id',
      collaborator_id: 'collaborator-id',
      store_id: 'store-id',
      attendance_date: '2026-08-28',
      status: 'absent' as const,
      recorded_by: 'user-id',
      recorded_by_operator_account_id: null,
      created_at: '2026-08-28T12:00:00.000Z',
      updated_at: '2026-08-28T13:00:00.000Z',
      version: 4,
    }
    const attendanceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: remoteAttendance,
        error: null,
      }),
      returns: vi.fn().mockResolvedValue({
        data: [remoteAttendance],
        error: null,
      }),
    }
    const otherQuery = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    mocks.from.mockImplementation((table: string) =>
      table === 'attendance_records' ? attendanceQuery : otherQuery,
    )
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-id' } } },
      error: null,
    })
    mocks.getLocalAppContext.mockResolvedValue(context)
    mocks.isNetworkAvailable.mockReturnValue(true)
    mocks.listPendingQueue.mockResolvedValue([
      {
        id: 'attendance:attendance-id',
        entityType: 'attendance',
        entityId: 'attendance-id',
        operation: 'update',
        createdAt: '2026-08-28T12:30:00.000Z',
        attempts: 5,
        nextAttemptAt: '2999-01-01T00:00:00.000Z',
        operatorAccountId: 'operator-b',
        errorCode: '55000',
        diagnosticError: 'PAID_ATTENDANCE_IMMUTABLE',
      },
    ])
    mocks.countPendingQueue.mockResolvedValue(0)
    mocks.reconcileAttendanceQueueItem.mockResolvedValue(undefined)
    mocks.saveRemoteAttendance.mockResolvedValue(undefined)
    mocks.saveRemoteExpenses.mockResolvedValue(undefined)
    mocks.saveRemoteMerchandiseTransfers.mockResolvedValue(undefined)

    const service = new SyncService()
    const result = await service.process()

    expect(result).toMatchObject({ synced: 1, failed: 0, pending: 0 })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.reconcileAttendanceQueueItem).toHaveBeenCalledOnce()
    expect(mocks.failQueueItem).not.toHaveBeenCalled()
  })

  it('keeps a paid attendance terminal while remote reconciliation is unavailable', async () => {
    const remoteAttendance = {
      id: 'attendance-id',
      collaborator_id: 'collaborator-id',
      store_id: 'store-id',
      attendance_date: '2026-08-28',
      status: 'present' as const,
      recorded_by: 'user-id',
      recorded_by_operator_account_id: null,
      created_at: '2026-08-28T12:00:00.000Z',
      updated_at: '2026-08-28T13:00:00.000Z',
      version: 4,
    }
    const attendanceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce({ data: remoteAttendance, error: null }),
      returns: vi.fn().mockResolvedValue({ data: [remoteAttendance], error: null }),
    }
    const otherQuery = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    mocks.from.mockImplementation((table: string) =>
      table === 'attendance_records' ? attendanceQuery : otherQuery,
    )
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-id' } } },
      error: null,
    })
    mocks.getLocalAppContext.mockResolvedValue(context)
    mocks.isNetworkAvailable.mockReturnValue(true)
    mocks.listPendingQueue.mockResolvedValue([
      {
        id: 'attendance:attendance-id',
        entityType: 'attendance',
        entityId: 'attendance-id',
        operation: 'update',
        createdAt: '2026-08-28T12:30:00.000Z',
        attempts: 2,
        errorCode: '55000',
        diagnosticError: 'PAID_ATTENDANCE_IMMUTABLE',
      },
    ])
    mocks.countPendingQueue.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    mocks.failQueueItem.mockResolvedValue(undefined)
    mocks.reconcileAttendanceQueueItem.mockResolvedValue(undefined)
    mocks.saveRemoteAttendance.mockResolvedValue(undefined)
    mocks.saveRemoteExpenses.mockResolvedValue(undefined)
    mocks.saveRemoteMerchandiseTransfers.mockResolvedValue(undefined)

    const service = new SyncService()

    await expect(service.process()).resolves.toMatchObject({
      synced: 0,
      failed: 1,
      pending: 1,
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.failQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'attendance-id' }),
      'Sin conexión con el servidor',
      expect.objectContaining({
        errorCode: '55000',
        diagnosticError: expect.stringContaining('PAID_ATTENDANCE_IMMUTABLE'),
      }),
    )

    await expect(service.process()).resolves.toMatchObject({
      synced: 1,
      failed: 0,
      pending: 0,
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.reconcileAttendanceQueueItem).toHaveBeenCalledOnce()
  })
})
