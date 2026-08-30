import { describe, expect, it } from 'vitest'
import {
  navigationFromLocation,
  navigationFromWorkerMessage,
} from './pushNotificationNavigation'

const target = {
  notificationId: '11111111-1111-4111-8111-111111111111',
  entityType: 'purchase' as const,
  entityId: '22222222-2222-4222-8222-222222222222',
  source: 'push' as const,
}

describe('push notification navigation', () => {
  it('reads only the supported destination query parameters', () => {
    const url = new URL(
      '/?notificationId=11111111-1111-4111-8111-111111111111&entityType=purchase&entityId=22222222-2222-4222-8222-222222222222',
      'https://operaciones.example',
    )

    expect(navigationFromLocation(url)).toEqual(target)
  })

  it('rejects malformed or unsupported query destinations', () => {
    const url = new URL(
      '/?notificationId=not-an-id&entityType=users&entityId=not-an-id',
      'https://operaciones.example',
    )

    expect(navigationFromLocation(url)).toBeUndefined()
  })

  it('requires the Operations source on service worker messages', () => {
    expect(navigationFromWorkerMessage({
      type: 'OPEN_NOTIFICATION',
      target: { ...target, sourceApp: 'operaciones' },
    })).toEqual(target)
    expect(navigationFromWorkerMessage({
      type: 'OPEN_NOTIFICATION',
      target: { ...target, sourceApp: 'arrendamientos' },
    })).toBeUndefined()
  })
})
