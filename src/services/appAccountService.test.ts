import { describe, expect, it } from 'vitest'
import {
  assertAppAccountPin,
  normalizeAppAccountUsername,
} from './appAccountService'

describe('app account client validation', () => {
  it('normalizes usernames before sending them to the backend', () => {
    expect(normalizeAppAccountUsername(' Maria.Centro ')).toBe('maria.centro')
  })

  it('accepts exactly six PIN digits and retains leading zeroes', () => {
    expect(() => assertAppAccountPin('012345')).not.toThrow()
    expect(() => assertAppAccountPin('481920')).not.toThrow()
  })

  it.each(['1234', '1234567', 'abcdef', 'abc123'])('rejects invalid PIN %s', (pin) => {
    expect(() => assertAppAccountPin(pin)).toThrow('exactamente 6 dígitos')
  })
})
