import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: mocks.rpc },
}))

import {
  base64UrlToUint8Array,
  pushNotificationService,
} from './pushNotificationService'

const publicKey = 'BElDUMMY_PUBLIC_KEY_1234567890'
function PushManagerStub() {}

function createSubscription() {
  return {
    endpoint: 'https://push.example.test/subscription/abc',
    toJSON: () => ({
      endpoint: 'https://push.example.test/subscription/abc',
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
    }),
    getKey: vi.fn(() => null),
    unsubscribe: vi.fn(async () => true),
  }
}

const getSubscription = vi.fn()
const subscribe = vi.fn()
const requestPermission = vi.fn()

beforeEach(() => {
  vi.stubEnv('VITE_WEB_PUSH_VAPID_PUBLIC_KEY', publicKey)
  vi.stubGlobal('window', {
    PushManager: PushManagerStub,
    Notification: { permission: 'default' },
    matchMedia: () => ({ matches: false }),
  })
  vi.stubGlobal('navigator', {
    userAgent: 'Chrome',
    platform: 'Linux',
    maxTouchPoints: 0,
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: { getSubscription, subscribe },
      }),
    },
  })
  vi.stubGlobal('Notification', {
    permission: 'default',
    requestPermission,
  })
  mocks.rpc.mockReset()
  getSubscription.mockReset()
  subscribe.mockReset()
  requestPermission.mockReset()
  requestPermission.mockResolvedValue('granted')
  mocks.rpc.mockResolvedValue({ data: 'subscription-id', error: null })
  getSubscription.mockResolvedValue(null)
})

describe('pushNotificationService', () => {
  it('converts a URL-safe VAPID key to bytes', () => {
    expect(base64UrlToUint8Array('AQID')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('does not ask for permission while reading the status', async () => {
    await expect(pushNotificationService.getStatus()).resolves.toEqual({
      state: 'permission-default',
    })
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('reports a blocked browser without requesting permission again', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission })

    await expect(pushNotificationService.getStatus()).resolves.toEqual({
      state: 'permission-denied',
    })
    await expect(pushNotificationService.enable()).rejects.toMatchObject({
      state: 'permission-denied',
    })
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('explains that an iPhone must have the PWA installed', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'iPhone',
      platform: 'iPhone',
      maxTouchPoints: 5,
      serviceWorker: {
        ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }),
      },
    })

    await expect(pushNotificationService.getStatus()).resolves.toEqual({
      state: 'ios-install-required',
      detail: 'Agrega Operaciones a la pantalla de inicio para activar Push.',
    })
  })

  it('requests permission on activation and registers the subscription', async () => {
    const subscription = createSubscription()
    subscribe.mockResolvedValue(subscription)
    const order: string[] = []
    requestPermission.mockImplementation(async () => {
      order.push('permission')
      return 'granted'
    })
    getSubscription.mockImplementation(async () => {
      order.push('subscription')
      return null
    })

    await expect(pushNotificationService.enable()).resolves.toEqual({
      state: 'enabled',
    })

    expect(order).toEqual(['permission', 'subscription'])
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    }))
    expect(mocks.rpc).toHaveBeenCalledWith('register_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_p256dh: 'p256dh-value',
      p_auth: 'auth-value',
    })
  })

  it('unsubscribes a newly-created local subscription if remote registration fails', async () => {
    const subscription = createSubscription()
    subscribe.mockResolvedValue(subscription)
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('remote failure') })

    await expect(pushNotificationService.enable()).rejects.toThrow()
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('revokes remotely before unsubscribing the local subscription', async () => {
    const subscription = createSubscription()
    getSubscription.mockResolvedValue(subscription)
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    const order: string[] = []
    mocks.rpc.mockImplementation(async () => {
      order.push('revoke')
      return { data: true, error: null }
    })
    subscription.unsubscribe.mockImplementation(async () => {
      order.push('unsubscribe')
      return true
    })

    await expect(pushNotificationService.disable()).resolves.toEqual({
      state: 'disabled',
    })
    expect(order).toEqual(['revoke', 'unsubscribe'])
  })
})
