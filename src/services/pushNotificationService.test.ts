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
  LOCAL_PUSH_PREFERENCES_KEY,
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
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}

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
  vi.stubGlobal('localStorage', localStorageMock)
  mocks.rpc.mockReset()
  getSubscription.mockReset()
  subscribe.mockReset()
  requestPermission.mockReset()
  localStorageMock.getItem.mockReset()
  localStorageMock.setItem.mockReset()
  localStorageMock.removeItem.mockReset()
  requestPermission.mockResolvedValue('granted')
  mocks.rpc.mockResolvedValue({ data: true, error: null })
  getSubscription.mockResolvedValue(null)
  localStorageMock.getItem.mockReturnValue(null)
})

describe('pushNotificationService', () => {
  it('converts a URL-safe VAPID key to bytes', () => {
    expect(base64UrlToUint8Array('AQID')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('does not ask for permission while reading the status', async () => {
    await expect(pushNotificationService.getStatus('admin-a')).resolves.toEqual({
      state: 'permission-default',
    })
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('reports a blocked browser without requesting permission again', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission })

    await expect(pushNotificationService.getStatus('admin-a')).resolves.toEqual({
      state: 'permission-denied',
    })
    await expect(pushNotificationService.enable('admin-a')).rejects.toMatchObject({
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

    await expect(pushNotificationService.getStatus('admin-a')).resolves.toEqual({
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

    await expect(pushNotificationService.enable('admin-a')).resolves.toEqual({
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
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      LOCAL_PUSH_PREFERENCES_KEY,
      JSON.stringify([
        { sourceApp: 'operaciones', authUserId: 'admin-a', enabled: true },
      ]),
    )
  })

  it('unsubscribes a newly-created local subscription if remote registration fails', async () => {
    const subscription = createSubscription()
    subscribe.mockResolvedValue(subscription)
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('remote failure') })

    await expect(pushNotificationService.enable('admin-a')).rejects.toThrow()
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('replaces an unowned browser subscription only after explicit activation', async () => {
    const subscription = createSubscription()
    getSubscription.mockResolvedValue(subscription)
    subscribe.mockResolvedValue(subscription)
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    const order: string[] = []
    subscription.unsubscribe.mockImplementation(async () => {
      order.push('unsubscribe')
      return true
    })
    subscribe.mockImplementation(async () => {
      order.push('subscribe')
      return subscription
    })

    await expect(pushNotificationService.enable('admin-b')).resolves.toEqual({
      state: 'enabled',
    })

    expect(order).toEqual(['unsubscribe', 'subscribe'])
    expect(mocks.rpc).toHaveBeenCalledWith('register_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_p256dh: 'p256dh-value',
      p_auth: 'auth-value',
    })
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

    await expect(pushNotificationService.disable('admin-a')).resolves.toEqual({
      state: 'disabled',
    })
    expect(order).toEqual(['revoke', 'unsubscribe'])
  })

  it('unsubscribes locally even when remote revocation fails', async () => {
    const subscription = createSubscription()
    getSubscription.mockResolvedValue(subscription)
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('remote failure') })

    await expect(pushNotificationService.disable('admin-a')).rejects.toMatchObject({
      message: 'No fue posible revocar la suscripción Push en el servidor.',
    })
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      LOCAL_PUSH_PREFERENCES_KEY,
      JSON.stringify([
        { sourceApp: 'operaciones', authUserId: 'admin-a', enabled: false },
      ]),
    )
  })

  it('does not auto-reactivate Push for another admin', async () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify([
      { sourceApp: 'operaciones', authUserId: 'admin-a', enabled: true },
    ]))
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    const subscription = createSubscription()
    getSubscription.mockResolvedValue(subscription)

    await expect(pushNotificationService.reactivateForLogin('admin-b')).resolves.toEqual({
      state: 'disabled',
    })
    expect(getSubscription).not.toHaveBeenCalled()
  })

  it('pauses the current subscription on logout without unsubscribing it', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    const subscription = createSubscription()
    getSubscription.mockResolvedValue(subscription)

    await expect(pushNotificationService.pauseForLogout('admin-a')).resolves.toBeUndefined()

    expect(mocks.rpc).toHaveBeenCalledWith('pause_push_subscription', {
      p_endpoint: subscription.endpoint,
    })
    expect(subscription.unsubscribe).not.toHaveBeenCalled()
  })

  it('falls back to revoke and unsubscribe if logout pause fails', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    const subscription = createSubscription()
    getSubscription.mockResolvedValue(subscription)
    mocks.rpc.mockImplementation(async (functionName: string) =>
      functionName === 'pause_push_subscription'
        ? { data: false, error: null }
        : { data: true, error: null },
    )

    await expect(pushNotificationService.pauseForLogout('admin-a')).resolves.toBeUndefined()

    expect(mocks.rpc).toHaveBeenCalledWith('revoke_push_subscription', {
      p_endpoint: subscription.endpoint,
    })
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      LOCAL_PUSH_PREFERENCES_KEY,
      JSON.stringify([
        { sourceApp: 'operaciones', authUserId: 'admin-a', enabled: false },
      ]),
    )
  })

  it('reactivates an enabled admin preference without requesting permission', async () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify([
      { sourceApp: 'operaciones', authUserId: 'admin-a', enabled: true },
    ]))
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    const subscription = createSubscription()
    getSubscription.mockResolvedValue(subscription)

    await expect(pushNotificationService.reactivateForLogin('admin-a')).resolves.toEqual({
      state: 'enabled',
    })

    expect(requestPermission).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('resume_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_p256dh: 'p256dh-value',
      p_auth: 'auth-value',
    })
  })

  it('requires an explicit action when the preferred subscription is gone', async () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify([
      { sourceApp: 'operaciones', authUserId: 'admin-a', enabled: true },
    ]))
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    getSubscription.mockResolvedValue(null)

    await expect(pushNotificationService.reactivateForLogin('admin-a')).resolves.toMatchObject({
      state: 'needs-reactivation',
    })
    expect(requestPermission).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not auto-reactivate a remotely revoked subscription', async () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify([
      { sourceApp: 'operaciones', authUserId: 'admin-a', enabled: true },
    ]))
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    const subscription = createSubscription()
    getSubscription.mockResolvedValue(subscription)
    mocks.rpc.mockResolvedValue({ data: false, error: null })

    await expect(pushNotificationService.reactivateForLogin('admin-a')).resolves.toMatchObject({
      state: 'needs-reactivation',
    })
    expect(requestPermission).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})
