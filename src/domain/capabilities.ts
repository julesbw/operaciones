import type { AppAccountRole, OperatorSession, UserProfile } from './models'

export type EffectiveRole = 'admin' | AppAccountRole

export type AppCapability =
  | 'home'
  | 'expenses'
  | 'attendance'
  | 'transfers'
  | 'purchases'
  | 'cashClosings'
  | 'payments'
  | 'centralCash'
  | 'exports'
  | 'settingsLocal'
  | 'settingsAdmin'
  | 'closingAdjustments'

export type PageId =
  | 'home'
  | 'expenses'
  | 'transfers'
  | 'purchases'
  | 'collaborators'
  | 'closings'
  | 'central-cash'
  | 'exports'
  | 'settings'

export type RuntimeIdentity = {
  technicalUser: UserProfile
  operatorSession?: OperatorSession | null
}

export type RuntimeStoreScope =
  | { kind: 'global' }
  | { kind: 'fixed'; storeId: string }
  | { kind: 'unavailable' }

const CAPABILITIES: Record<EffectiveRole, ReadonlySet<AppCapability>> = {
  admin: new Set([
    'home', 'expenses', 'attendance', 'transfers', 'purchases',
    'cashClosings', 'payments', 'centralCash', 'exports', 'settingsLocal',
    'settingsAdmin', 'closingAdjustments',
  ]),
  cashier: new Set([
    'home', 'expenses', 'attendance', 'transfers', 'settingsLocal',
  ]),
  store_manager: new Set([
    'home', 'expenses', 'attendance', 'transfers', 'purchases',
    'cashClosings', 'settingsLocal',
  ]),
}

export const PAGE_CAPABILITY: Readonly<Record<PageId, AppCapability>> = {
  home: 'home',
  expenses: 'expenses',
  transfers: 'transfers',
  purchases: 'purchases',
  collaborators: 'attendance',
  closings: 'cashClosings',
  'central-cash': 'centralCash',
  exports: 'exports',
  settings: 'settingsLocal',
}

export function getEffectiveRole(
  identity: RuntimeIdentity,
): EffectiveRole | undefined {
  if (identity.technicalUser.role === 'admin') return 'admin'
  return identity.operatorSession?.account.role
}

export function roleHasCapability(
  role: EffectiveRole,
  capability: AppCapability,
): boolean {
  return CAPABILITIES[role].has(capability)
}

export function hasCapability(
  identity: RuntimeIdentity,
  capability: AppCapability,
): boolean {
  const role = getEffectiveRole(identity)
  return role ? roleHasCapability(role, capability) : false
}

export function canAccessPage(
  identity: RuntimeIdentity,
  page: PageId,
): boolean {
  return hasCapability(identity, PAGE_CAPABILITY[page])
}

export function getRuntimeStoreScope(
  identity: RuntimeIdentity,
): RuntimeStoreScope {
  if (identity.technicalUser.role === 'admin') return { kind: 'global' }
  const storeId = identity.operatorSession?.account.storeId
  return storeId ? { kind: 'fixed', storeId } : { kind: 'unavailable' }
}
