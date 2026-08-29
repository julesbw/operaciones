import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LocalAppContext,
  OperatorSession,
  UserProfile,
} from '../domain/models'

const mocks = vi.hoisted(() => ({
  getSessionUserId: vi.fn(),
  loadProfile: vi.fn(),
  prepareForAuthenticatedProfile: vi.fn(),
  setAccessState: vi.fn(),
  saveAuthenticatedProfile: vi.fn(),
  recordSuccessfulSync: vi.fn(),
  seedDemoReferenceData: vi.fn(),
  refreshReferenceData: vi.fn(),
  ensureOfflineShell: vi.fn(),
  sync: vi.fn(),
  refreshPayments: vi.fn(),
  refreshPurchases: vi.fn(),
  refreshPurchaseSuppliers: vi.fn(),
  validateOperator: vi.fn(),
  clearAdministrativePaymentData: vi.fn(),
}))

vi.mock('./authService', () => ({
  authService: {
    getSessionUserId: mocks.getSessionUserId,
    loadProfile: mocks.loadProfile,
  },
}))

vi.mock('./bootstrapService', () => ({
  bootstrapService: {
    seedDemoReferenceData: mocks.seedDemoReferenceData,
  },
}))

vi.mock('./localContextService', () => ({
  localContextService: {
    prepareForAuthenticatedProfile: mocks.prepareForAuthenticatedProfile,
    setAccessState: mocks.setAccessState,
    saveAuthenticatedProfile: mocks.saveAuthenticatedProfile,
    recordSuccessfulSync: mocks.recordSuccessfulSync,
  },
}))

vi.mock('./offlineShellService', () => ({
  offlineShellService: { ensureReady: mocks.ensureOfflineShell },
}))

vi.mock('./syncService', () => ({
  syncService: { process: mocks.sync },
}))

vi.mock('./paymentService', () => ({
  paymentService: { refreshRemote: mocks.refreshPayments },
}))

vi.mock('./purchaseService', () => ({
  purchaseService: { refreshRemote: mocks.refreshPurchases },
}))

vi.mock('./operatorSessionService', () => ({
  operatorSessionService: { validate: mocks.validateOperator },
}))

vi.mock('./referenceDataService', () => ({
  referenceDataService: {
    refresh: mocks.refreshReferenceData,
    refreshPurchaseSuppliers: mocks.refreshPurchaseSuppliers,
  },
}))

vi.mock('../repositories/operationsRepository', () => ({
  operationsRepository: {
    clearAdministrativePaymentData: mocks.clearAdministrativePaymentData,
  },
}))

import {
  RemoteBootstrapCancelledError,
  RemoteBootstrapService,
} from './remoteBootstrapService'

const profile: UserProfile = {
  id: 'user-id',
  fullName: 'Usuario',
  role: 'admin',
}

const context: LocalAppContext = {
  id: 'current',
  userId: profile.id,
  displayName: profile.fullName,
  role: profile.role,
  accessState: 'enabled',
  initializedAt: '2026-08-13T12:00:00.000Z',
  lastAuthenticatedAt: '2026-08-13T12:00:00.000Z',
  updatedAt: '2026-08-13T12:00:00.000Z',
}

describe('RemoteBootstrapService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionUserId.mockResolvedValue(profile.id)
    mocks.loadProfile.mockResolvedValue(profile)
    mocks.prepareForAuthenticatedProfile.mockResolvedValue(undefined)
    mocks.refreshReferenceData.mockResolvedValue(undefined)
    mocks.ensureOfflineShell.mockResolvedValue(undefined)
    mocks.saveAuthenticatedProfile.mockResolvedValue(context)
    mocks.sync.mockResolvedValue({ synced: 1, failed: 0, pending: 0 })
    mocks.recordSuccessfulSync.mockResolvedValue(undefined)
    mocks.refreshPayments.mockResolvedValue(undefined)
    mocks.refreshPurchases.mockResolvedValue(undefined)
    mocks.refreshPurchaseSuppliers.mockResolvedValue(undefined)
    mocks.validateOperator.mockResolvedValue(undefined)
    mocks.clearAdministrativePaymentData.mockResolvedValue(undefined)
  })

  it('completes the authenticated bootstrap and sync pull sequence', async () => {
    const service = new RemoteBootstrapService()

    await expect(service.process()).resolves.toMatchObject({
      status: 'authenticated',
      profile,
      context,
    })
    expect(mocks.prepareForAuthenticatedProfile).toHaveBeenCalledWith(profile)
    expect(mocks.refreshReferenceData).toHaveBeenCalledOnce()
    expect(mocks.ensureOfflineShell).toHaveBeenCalledOnce()
    expect(mocks.saveAuthenticatedProfile).toHaveBeenCalledWith(profile)
    expect(mocks.sync).toHaveBeenCalledOnce()
    expect(mocks.refreshPayments).toHaveBeenCalledOnce()
    expect(mocks.refreshPurchases).toHaveBeenCalledOnce()
  })

  it('does not persist an authenticated context after sign-out cancellation', async () => {
    let releaseShell: (() => void) | undefined
    mocks.ensureOfflineShell.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseShell = resolve
        }),
    )
    const service = new RemoteBootstrapService()
    const running = service.process()
    await vi.waitFor(() => {
      expect(mocks.ensureOfflineShell).toHaveBeenCalledOnce()
    })

    const stopped = service.cancelForSignOut()
    releaseShell?.()

    await expect(running).rejects.toBeInstanceOf(
      RemoteBootstrapCancelledError,
    )
    await expect(stopped).resolves.toBeUndefined()
    expect(mocks.saveAuthenticatedProfile).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('requires login without attempting remote data requests when there is no session', async () => {
    mocks.getSessionUserId.mockResolvedValue(undefined)
    const service = new RemoteBootstrapService()

    await expect(service.process()).resolves.toEqual({
      status: 'requires-login',
    })
    expect(mocks.setAccessState).toHaveBeenCalledWith(
      'reauthentication-required',
    )
    expect(mocks.refreshReferenceData).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('validates the operator before the queue and pulls every allowed dataset after it', async () => {
    const cashier: UserProfile = {
      id: 'user-id',
      fullName: 'Cajera',
      role: 'cashier',
      storeId: 'store-id',
    }
    const operator: OperatorSession = {
      token: 'operator-token',
      account: {
        id: 'operator-id',
        username: 'operator',
        displayName: 'Operador',
        role: 'store_manager',
        storeId: 'store-id',
      },
      expiresAt: '2999-01-01T00:00:00.000Z',
    }
    const events: string[] = []
    mocks.getSessionUserId.mockResolvedValue(cashier.id)
    mocks.loadProfile.mockResolvedValue(cashier)
    mocks.validateOperator.mockImplementation(async () => {
      events.push('validate-operator')
      return operator
    })
    mocks.sync.mockImplementation(async () => {
      events.push('sync')
      return { synced: 1, failed: 0, pending: 0 }
    })
    mocks.refreshReferenceData.mockImplementation(async () => {
      events.push('references')
    })
    mocks.refreshPurchaseSuppliers.mockImplementation(async () => {
      events.push('suppliers')
    })
    mocks.refreshPurchases.mockImplementation(async () => {
      events.push('purchases')
    })

    const result = await new RemoteBootstrapService().process({
      forceRetry: true,
    })

    expect(result).toMatchObject({
      status: 'authenticated',
      operatorSession: operator,
      sync: { synced: 1, failed: 0, pending: 0 },
    })
    expect(events).toEqual([
      'validate-operator',
      'sync',
      'references',
      'suppliers',
      'purchases',
    ])
    expect(mocks.sync).toHaveBeenCalledWith({
      forceRetry: true,
      operatorAccountId: operator.account.id,
    })
  })

  it('stops before SyncQueue when the operator session is required', async () => {
    const cashier: UserProfile = {
      id: 'user-id',
      fullName: 'Cajera',
      role: 'cashier',
      storeId: 'store-id',
    }
    mocks.getSessionUserId.mockResolvedValue(cashier.id)
    mocks.loadProfile.mockResolvedValue(cashier)
    mocks.validateOperator.mockResolvedValue(undefined)

    await expect(new RemoteBootstrapService().process()).resolves.toMatchObject({
      status: 'requires-operator-login',
      profile: cashier,
      context,
    })
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(mocks.refreshReferenceData).not.toHaveBeenCalled()
  })
})
