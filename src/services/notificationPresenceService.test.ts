import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: mocks.rpc },
}))

import {
  getNotificationPresenceId,
  isNotificationPresenceId,
  NOTIFICATION_PRESENCE_STORAGE_KEY,
  NotificationPresenceService,
} from './notificationPresenceService'

const storage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
}

beforeEach(() => {
  mocks.rpc.mockReset()
  storage.getItem.mockReset()
  storage.setItem.mockReset()
  storage.getItem.mockReturnValue(null)
  mocks.rpc.mockResolvedValue({ data: true, error: null })
})

describe('notification presence', () => {
  it('validates and reuses a per-session presence id', () => {
    const id = getNotificationPresenceId(storage)

    expect(isNotificationPresenceId(id)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(
      NOTIFICATION_PRESENCE_STORAGE_KEY,
      id,
    )
    storage.getItem.mockReturnValue(id)
    expect(getNotificationPresenceId(storage)).toBe(id)
    expect(isNotificationPresenceId('short')).toBe(false)
  })

  it('records and releases presence without sending auth user ids', async () => {
    const service = new NotificationPresenceService(storage)

    await expect(service.heartbeat()).resolves.toBe(true)
    await expect(service.release()).resolves.toBe(true)
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      'heartbeat_notification_presence',
      expect.objectContaining({ p_source_app: 'operaciones' }),
    )
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      'release_notification_presence',
      expect.objectContaining({ p_source_app: 'operaciones' }),
    )
    expect(mocks.rpc.mock.calls.flat()).not.toContain('auth_user_id')
  })

  it('fails open when the presence RPC cannot be reached', async () => {
    mocks.rpc.mockRejectedValue(new Error('offline'))
    const service = new NotificationPresenceService(storage)

    await expect(service.heartbeat()).rejects.toThrow('offline')
    await expect(service.release()).rejects.toThrow('offline')
  })
})
