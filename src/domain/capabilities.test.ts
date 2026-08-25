import { describe, expect, it } from 'vitest'
import type { OperatorSession, UserProfile } from './models'
import {
  canAccessPage,
  getEffectiveRole,
  getRuntimeStoreScope,
  roleHasCapability,
} from './capabilities'

const technicalUser: UserProfile = {
  id: 'technical-user',
  fullName: 'Terminal Tienda',
  role: 'cashier',
  storeId: 'store-a',
}

function operator(role: 'cashier' | 'store_manager'): OperatorSession {
  return {
    token: 'operator-token',
    expiresAt: '2999-01-01T00:00:00.000Z',
    account: {
      id: `${role}-id`,
      username: role,
      displayName: role,
      role,
      storeId: 'store-a',
    },
  }
}

describe('runtime capability matrix', () => {
  it('allows purchases and closings only to store managers and admins', () => {
    expect(roleHasCapability('cashier', 'purchases')).toBe(false)
    expect(roleHasCapability('cashier', 'cashClosings')).toBe(false)
    expect(roleHasCapability('store_manager', 'purchases')).toBe(true)
    expect(roleHasCapability('store_manager', 'cashClosings')).toBe(true)
    expect(roleHasCapability('admin', 'purchases')).toBe(true)
    expect(roleHasCapability('admin', 'cashClosings')).toBe(true)
  })

  it('allows supplier creation to store managers and admins, but not cashiers', () => {
    expect(roleHasCapability('cashier', 'supplierCreation')).toBe(false)
    expect(roleHasCapability('store_manager', 'supplierCreation')).toBe(true)
    expect(roleHasCapability('admin', 'supplierCreation')).toBe(true)
  })

  it('does not grant admin-only capabilities to a store manager', () => {
    for (const capability of [
      'payments',
      'centralCash',
      'exports',
      'settingsAdmin',
      'closingAdjustments',
    ] as const) {
      expect(roleHasCapability('store_manager', capability)).toBe(false)
    }
  })

  it('uses the current operator role and store only as the runtime UX scope', () => {
    const identity = {
      technicalUser,
      operatorSession: operator('store_manager'),
    }
    expect(getEffectiveRole(identity)).toBe('store_manager')
    expect(getRuntimeStoreScope(identity)).toEqual({
      kind: 'fixed',
      storeId: 'store-a',
    })
    expect(canAccessPage(identity, 'purchases')).toBe(true)
    expect(canAccessPage(identity, 'central-cash')).toBe(false)
  })

  it('grants no operator capability when the local operator snapshot is absent', () => {
    const identity = { technicalUser }
    expect(getEffectiveRole(identity)).toBeUndefined()
    expect(getRuntimeStoreScope(identity)).toEqual({ kind: 'unavailable' })
    expect(canAccessPage(identity, 'expenses')).toBe(false)
  })
})
