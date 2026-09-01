import { describe, expect, it } from 'vitest'
import { isNotificationPresenceActive } from './useNotificationPresence'

describe('notification presence activity', () => {
  it('requires both a visible document and focus', () => {
    expect(isNotificationPresenceActive('visible', true)).toBe(true)
    expect(isNotificationPresenceActive('hidden', true)).toBe(false)
    expect(isNotificationPresenceActive('visible', false)).toBe(false)
  })
})
