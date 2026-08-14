import type { LocalAppContext, UserProfile } from '../domain/models'
import { authService } from './authService'
import { bootstrapService } from './bootstrapService'
import { localContextService } from './localContextService'
import { offlineShellService } from './offlineShellService'
import { referenceDataService } from './referenceDataService'
import { syncService, type SyncResult } from './syncService'

export type RemoteBootstrapResult =
  | {
      status: 'authenticated'
      profile: UserProfile
      context: LocalAppContext
      sync: SyncResult
    }
  | { status: 'requires-login' }

type RemoteBootstrapOptions = {
  profile?: UserProfile
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
    if (this.running) {
      if (options.profile) {
        return this.running.then(
          () => this.process(options),
          () => this.process(options),
        )
      }
      return this.running
    }

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
    } else {
      await referenceDataService.refresh()
    }

    ensureActive()
    await offlineShellService.ensureReady()
    ensureActive()
    const context = await localContextService.saveAuthenticatedProfile(profile)
    if (generation !== this.generation) {
      await localContextService.setAccessState('signed-out')
      throw new RemoteBootstrapCancelledError()
    }
    const sync = await syncService.process()
    ensureActive()
    if (sync.failed === 0) {
      await localContextService.recordSuccessfulSync(profile.id)
    }

    return { status: 'authenticated', profile, context, sync }
  }
}

export const remoteBootstrapService = new RemoteBootstrapService()
