import type {
  LocalAppContext,
  OperatorSession,
  UserProfile,
} from '../domain/models'
import { authService } from './authService'
import { bootstrapService } from './bootstrapService'
import { localContextService } from './localContextService'
import { offlineShellService } from './offlineShellService'
import { OperatorAuthorizationError } from './operatorAuthorization'
import { operatorSessionService } from './operatorSessionService'
import { paymentService } from './paymentService'
import { purchaseService } from './purchaseService'
import { operationsRepository } from '../repositories/operationsRepository'
import { referenceDataService } from './referenceDataService'
import { syncService, type SyncResult } from './syncService'

export type RemoteBootstrapResult =
  | {
      status: 'authenticated'
      profile: UserProfile
      context: LocalAppContext
      sync: SyncResult
      operatorSession?: OperatorSession
    }
  | { status: 'requires-login' }
  | {
      status: 'requires-operator-login'
      profile: UserProfile
      context: LocalAppContext
    }

type RemoteBootstrapOptions = {
  forceRetry?: boolean
  profile?: UserProfile
  skipSync?: boolean
  onIdentityResolved?: (userId: string | undefined) => void
}

export class RemoteBootstrapCancelledError extends Error {
  constructor() {
    super('El arranque remoto fue cancelado')
    this.name = 'RemoteBootstrapCancelledError'
  }
}

export class RemoteBootstrapService {
  private running?: Promise<RemoteBootstrapResult>
  private generation = 0

  cancelForSignOut(): Promise<void> {
    this.generation += 1
    return (
      this.running?.then(
        () => undefined,
        () => undefined,
      ) ?? Promise.resolve()
    )
  }

  process(options: RemoteBootstrapOptions = {}): Promise<RemoteBootstrapResult> {
    if (this.running) return this.running

    this.running = this.processRemote(options).finally(() => {
      this.running = undefined
    })
    return this.running
  }

  private async processRemote(
    options: RemoteBootstrapOptions,
  ): Promise<RemoteBootstrapResult> {
    const generation = this.generation
    const ensureActive = () => {
      if (generation !== this.generation) {
        throw new RemoteBootstrapCancelledError()
      }
    }

    const sessionUserId = await authService.getSessionUserId()
    ensureActive()
    options.onIdentityResolved?.(sessionUserId)

    if (!sessionUserId) {
      await localContextService.setAccessState('reauthentication-required')
      return { status: 'requires-login' }
    }

    const profile =
      options.profile?.id === sessionUserId
        ? options.profile
        : await authService.loadProfile(sessionUserId)
    ensureActive()

    await localContextService.prepareForAuthenticatedProfile(profile)
    ensureActive()
    if (profile.demo) {
      await bootstrapService.seedDemoReferenceData()
    }

    ensureActive()
    await offlineShellService.ensureReady()
    ensureActive()
    const context = await localContextService.saveAuthenticatedProfile(profile)
    if (generation !== this.generation) {
      await localContextService.setAccessState('signed-out')
      throw new RemoteBootstrapCancelledError()
    }

    let operatorSession: OperatorSession | undefined
    if (profile.role !== 'admin') {
      operatorSession = await operatorSessionService.validate(profile.id)
      ensureActive()
      if (!operatorSession) {
        return {
          status: 'requires-operator-login',
          profile,
          context,
        }
      }
      if (
        profile.storeId &&
        operatorSession.account.storeId !== profile.storeId
      ) {
        throw new OperatorAuthorizationError('OPERATOR_STORE_FORBIDDEN')
      }
    }

    const sync = options.skipSync
      ? { synced: 0, failed: 0, pending: await syncService.countPending() }
      : await this.synchronizeNow(
          profile,
          operatorSession,
          options.forceRetry,
          ensureActive,
        )
    ensureActive()

    return {
      status: 'authenticated',
      profile,
      context,
      sync,
      operatorSession,
    }
  }

  private async synchronizeNow(
    profile: UserProfile,
    operatorSession: OperatorSession | undefined,
    forceRetry: boolean | undefined,
    ensureActive: () => void,
  ): Promise<SyncResult> {
    const sync = await syncService.process({
      forceRetry,
      operatorAccountId: operatorSession?.account.id,
    })
    ensureActive()

    await referenceDataService.refresh(profile)
    ensureActive()

    if (profile.role === 'admin' && !profile.demo) {
      await Promise.all([
        paymentService.refreshRemote(),
        purchaseService.refreshRemote(profile),
      ])
    } else if (operatorSession?.account.role === 'store_manager') {
      await Promise.all([
        referenceDataService.refreshPurchaseSuppliers(profile),
        purchaseService.refreshRemote(profile),
      ])
    } else if (!profile.demo) {
      await operationsRepository.clearAdministrativePaymentData()
    }
    ensureActive()

    if (sync.failed === 0) {
      await localContextService.recordSuccessfulSync(profile.id)
    }

    return sync
  }
}

export const remoteBootstrapService = new RemoteBootstrapService()
