import type {
  LocalAccessState,
  LocalAppContext,
  UserProfile,
} from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'

export class UserSwitchBlockedError extends Error {
  constructor(
    readonly localContext: LocalAppContext | undefined,
    readonly attemptedUserId: string,
    readonly protectedCount: number,
  ) {
    super(
      localContext
        ? `Este dispositivo conserva ${protectedCount} captura${protectedCount === 1 ? '' : 's'} o borrador${protectedCount === 1 ? '' : 'es'} de ${localContext.displayName}. Inicia sesión con esa cuenta y resuélvelos antes de cambiar de usuario.`
        : 'Este dispositivo conserva capturas de otra cuenta. Inicia sesión con la cuenta que las creó para recuperarlas antes de cambiar de usuario.',
    )
    this.name = 'UserSwitchBlockedError'
  }
}

export function profileFromLocalContext(
  context: LocalAppContext,
): UserProfile {
  return {
    id: context.userId,
    fullName: context.displayName,
    role: context.role,
    storeId: context.storeId,
    storeName: context.storeName,
    demo: context.demo,
  }
}

export class LocalContextService {
  constructor(private readonly repository = operationsRepository) {}

  load(): Promise<LocalAppContext | undefined> {
    return this.repository.getLocalAppContext()
  }

  async prepareForAuthenticatedProfile(profile: UserProfile): Promise<void> {
    const current = await this.load()
    if (current?.userId === profile.id) return

    const protection = await this.repository.getLocalProtectionSummary()
    if (!current) {
      const belongsToProfile =
        protection.protectedCount > 0 &&
        protection.unresolvedCount === 0 &&
        protection.ownerIds.length === 1 &&
        protection.ownerIds[0] === profile.id
      if (protection.protectedCount > 0 && !belongsToProfile) {
        throw new UserSwitchBlockedError(
          undefined,
          profile.id,
          protection.protectedCount,
        )
      }
      if (protection.protectedCount === 0) {
        await this.repository.clearCachedIdentityData()
      }
      return
    }

    if (protection.protectedCount > 0) {
      await this.repository.updateLocalAppContext({
        accessState: 'reauthentication-required',
        updatedAt: new Date().toISOString(),
      })
      throw new UserSwitchBlockedError(
        current,
        profile.id,
        protection.protectedCount,
      )
    }

    await this.repository.clearCachedIdentityData()
  }

  async saveAuthenticatedProfile(
    profile: UserProfile,
  ): Promise<LocalAppContext> {
    const current = await this.load()
    const now = new Date().toISOString()
    const context: LocalAppContext = {
      id: 'current',
      userId: profile.id,
      displayName: profile.fullName,
      role: profile.role,
      storeId: profile.storeId,
      storeName: profile.storeName,
      demo: profile.demo,
      accessState: 'enabled',
      initializedAt:
        current?.userId === profile.id ? current.initializedAt : now,
      lastAuthenticatedAt: now,
      lastSuccessfulSyncAt:
        current?.userId === profile.id
          ? current.lastSuccessfulSyncAt
          : undefined,
      updatedAt: now,
    }
    await this.repository.saveLocalAppContext(context)
    return context
  }

  async setAccessState(accessState: LocalAccessState): Promise<void> {
    const context = await this.load()
    if (!context) return
    await this.repository.updateLocalAppContext({
      accessState,
      updatedAt: new Date().toISOString(),
    })
  }

  async recordSuccessfulSync(userId: string): Promise<void> {
    const context = await this.load()
    if (!context || context.userId !== userId) return
    const now = new Date().toISOString()
    await this.repository.updateLocalAppContext({
      lastSuccessfulSyncAt: now,
      updatedAt: now,
    })
  }
}

export const localContextService = new LocalContextService()
