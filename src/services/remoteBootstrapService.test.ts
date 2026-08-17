import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalAppContext, UserProfile } from '../domain/models'

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

vi.mock('./referenceDataService', () => ({
  referenceDataService: { refresh: mocks.refreshReferenceData },
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
    mocks.clearAdministrativePaymentData.mockResolvedValue(undefined)
  })

  it('persists context only after profile, references and app shell succeed', async () => {
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
    let releaseRefresh: (() => void) | undefined
    mocks.refreshReferenceData.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseRefresh = resolve
        }),
    )
    const service = new RemoteBootstrapService()
    const running = service.process()
    await vi.waitFor(() => {
      expect(mocks.refreshReferenceData).toHaveBeenCalledOnce()
    })

    const stopped = service.cancelForSignOut()
    releaseRefresh?.()

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
})
