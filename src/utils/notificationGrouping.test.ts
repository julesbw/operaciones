import { describe, expect, it } from 'vitest'
import {
  groupNotifications,
  sortNotifications,
} from './notificationGrouping'

function atLocalDate(month: number, day: number, hour = 12): string {
  return new Date(2026, month, day, hour).toISOString()
}

describe('notification presentation grouping', () => {
  const now = new Date(2026, 8, 2, 12)

  it('groups local calendar days as today, yesterday, this week and older', () => {
    const groups = groupNotifications([
      { id: 'older', createdAt: atLocalDate(7, 24) },
      { id: 'today', createdAt: atLocalDate(8, 2, 9) },
      { id: 'week', createdAt: atLocalDate(7, 31) },
      { id: 'yesterday', createdAt: atLocalDate(8, 1) },
    ], now)

    expect(groups.map((group) => [group.label, group.notifications.map((item) => item.id)])).toEqual([
      ['Hoy', ['today']],
      ['Ayer', ['yesterday']],
      ['Esta semana', ['week']],
      ['Anteriores', ['older']],
    ])
  })

  it('keeps the newest notification first', () => {
    expect(sortNotifications([
      { id: 'old', createdAt: atLocalDate(7, 29) },
      { id: 'new', createdAt: atLocalDate(7, 31) },
    ]).map((item) => item.id)).toEqual(['new', 'old'])
  })
})
