import { describe, expect, it } from 'vitest'
import { getOperationalDate, OPERATIONS_TIME_ZONE } from './date'

describe('getOperationalDate', () => {
  it('uses the configured Mexico City business day around UTC midnight', () => {
    expect(OPERATIONS_TIME_ZONE).toBe('America/Mexico_City')
    expect(getOperationalDate(new Date('2026-08-13T05:59:59.000Z'))).toBe(
      '2026-08-12',
    )
    expect(getOperationalDate(new Date('2026-08-13T06:00:00.000Z'))).toBe(
      '2026-08-13',
    )
  })
})
