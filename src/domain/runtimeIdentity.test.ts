import { describe, expect, it } from 'vitest'
import type { OperatorSession, UserProfile } from './models'
import { getEffectiveDisplayName } from './runtimeIdentity'

const technicalUser: UserProfile = {
  id: 'technical-user',
  fullName: 'Terminal Centro',
  role: 'cashier',
}

const operatorSession: OperatorSession = {
  token: 'test-token',
  expiresAt: '2999-01-01T00:00:00.000Z',
  account: {
    id: 'operator-account',
    username: 'maria',
    displayName: 'María López',
    role: 'cashier',
    storeId: 'store-centro',
  },
}

describe('getEffectiveDisplayName', () => {
  it('uses the operator name when an operator session is active', () => {
    expect(getEffectiveDisplayName(technicalUser, operatorSession)).toBe('María López')
  })

  it('uses the technical user name when no operator session is active', () => {
    expect(getEffectiveDisplayName(technicalUser, null)).toBe('Terminal Centro')
  })
})
