import { describe, expect, it } from 'vitest'
import {
  shouldShowUnreadBadge,
  unreadBadgeLabel,
} from './NotificationCenter'

describe('notification unread badge', () => {
  it('hides zero and uses a compact label from ten unread notifications', () => {
    expect(shouldShowUnreadBadge(0)).toBe(false)
    expect(shouldShowUnreadBadge(1)).toBe(true)
    expect(unreadBadgeLabel(9)).toBe(9)
    expect(unreadBadgeLabel(10)).toBe('9+')
  })
})
