import {
  OPERATIONS_NOTIFICATION_SOURCE_APP,
} from '../domain/models'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export const PUSH_NOTIFICATION_STATES = [
  'unsupported',
  'ios-install-required',
  'permission-default',
  'enabled',
  'needs-reactivation',
  'permission-denied',
  'disabled',
  'error',
] as const

export type PushNotificationState =
  (typeof PUSH_NOTIFICATION_STATES)[number]

export type PushNotificationStatus = {
  state: PushNotificationState
  detail?: string
}

export class PushNotificationError extends Error {
  readonly state?: PushNotificationState

  constructor(message: string, state?: PushNotificationState) {
    super(message)
    this.name = 'PushNotificationError'
    this.state = state
  }
}

type PushSubscriptionJSON = {
  endpoint?: string
  keys?: {
    p256dh?: string
    auth?: string
  }
}

type PushSubscriptionWithJSON = PushSubscription & {
  toJSON?: () => PushSubscriptionJSON
}

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean
}

const PUBLIC_KEY_ENV_NAME = 'VITE_WEB_PUSH_VAPID_PUBLIC_KEY'
export const LOCAL_PUSH_PREFERENCES_KEY = 'operaciones-push-preferences'
const LOGOUT_CLEANUP_TIMEOUT_MS = 5_000

type StoredPushPreference = {
  sourceApp: typeof OPERATIONS_NOTIFICATION_SOURCE_APP
  authUserId: string
  enabled: boolean
}

type SerializedPushSubscription = {
  endpoint: string
  p256dh: string
  auth: string
}

function publicVapidKey(): string {
  return import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? ''
}

function browserLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    return localStorage
  } catch {
    return undefined
  }
}

function readPushPreferences(): StoredPushPreference[] {
  const storage = browserLocalStorage()
  if (!storage) return []

  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(LOCAL_PUSH_PREFERENCES_KEY) ?? '[]',
    )
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is StoredPushPreference => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<StoredPushPreference>
      return (
        candidate.sourceApp === OPERATIONS_NOTIFICATION_SOURCE_APP &&
        typeof candidate.authUserId === 'string' &&
        candidate.authUserId.length > 0 &&
        typeof candidate.enabled === 'boolean'
      )
    })
  } catch {
    return []
  }
}

function pushPreference(authUserId: string): boolean | undefined {
  return readPushPreferences().find(
    (item) =>
      item.sourceApp === OPERATIONS_NOTIFICATION_SOURCE_APP &&
      item.authUserId === authUserId,
  )?.enabled
}

function savePushPreference(authUserId: string, enabled: boolean): void {
  if (!authUserId.trim()) return
  const storage = browserLocalStorage()
  if (!storage) return

  try {
    const preferences = readPushPreferences().filter(
      (item) =>
        item.sourceApp !== OPERATIONS_NOTIFICATION_SOURCE_APP ||
        item.authUserId !== authUserId,
    )
    preferences.push({
      sourceApp: OPERATIONS_NOTIFICATION_SOURCE_APP,
      authUserId,
      enabled,
    })
    storage.setItem(LOCAL_PUSH_PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // El backend sigue siendo la fuente de autorización para la entrega.
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new PushNotificationError(
        'La limpieza de notificaciones tardó demasiado.',
        'error',
      ))
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  })
}

function isIosOrIpados(): boolean {
  if (typeof navigator === 'undefined') return false
  const userAgent = navigator.userAgent
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const standaloneDisplay =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone =
    (navigator as NavigatorWithStandalone).standalone === true
  return standaloneDisplay || iosStandalone
}

function browserSupportsPush(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PushNotificationError('La clave pública de Push no es válida.')
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  let decoded: string
  try {
    decoded = atob(`${normalized}${padding}`)
  } catch {
    throw new PushNotificationError('La clave pública de Push no es válida.')
  }

  const result = new Uint8Array(new ArrayBuffer(decoded.length))
  for (let index = 0; index < decoded.length; index += 1) {
    result[index] = decoded.charCodeAt(index)
  }
  return result
}

function arrayBufferToBase64Url(value: ArrayBuffer | null): string {
  if (!value) return ''
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function subscriptionJSON(
  subscription: PushSubscriptionWithJSON,
): SerializedPushSubscription {
  const serialized = subscription.toJSON?.() ?? {}
  const endpoint = serialized.endpoint ?? subscription.endpoint
  const p256dh =
    serialized.keys?.p256dh ??
    arrayBufferToBase64Url(subscription.getKey('p256dh'))
  const auth =
    serialized.keys?.auth ?? arrayBufferToBase64Url(subscription.getKey('auth'))

  if (!endpoint || !p256dh || !auth) {
    throw new PushNotificationError(
      'El navegador no devolvió una suscripción Push válida.',
    )
  }

  return { endpoint, p256dh, auth }
}

function unsupportedStatus(): PushNotificationStatus {
  if (isIosOrIpados() && !isStandalonePwa()) {
    return {
      state: 'ios-install-required',
      detail: 'Agrega Operaciones a la pantalla de inicio para activar Push.',
    }
  }
  if (!browserSupportsPush()) {
    return {
      state: 'unsupported',
      detail: 'Este navegador no ofrece Web Push para Operaciones.',
    }
  }
  if (!isSupabaseConfigured || !supabase || !publicVapidKey()) {
    return {
      state: 'unsupported',
      detail: 'Push requiere configuración remota de Operaciones.',
    }
  }
  return { state: 'disabled' }
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  if (!browserSupportsPush()) {
    throw new PushNotificationError('Web Push no está disponible.', 'unsupported')
  }
  try {
    return await navigator.serviceWorker.ready
  } catch (cause: unknown) {
    throw new PushNotificationError(
      cause instanceof Error
        ? cause.message
        : 'No fue posible preparar el service worker.',
    )
  }
}

export class PushNotificationService {
  private readonly reactivationStatusByUser = new Map<
    string,
    PushNotificationStatus
  >()

  async getStatus(authUserId: string): Promise<PushNotificationStatus> {
    const initial = unsupportedStatus()
    if (initial.state !== 'disabled') return initial

    const permission = Notification.permission
    if (permission === 'denied') return { state: 'permission-denied' }
    if (permission === 'default') return { state: 'permission-default' }
    const preference = pushPreference(authUserId)
    if (preference === false) {
      this.reactivationStatusByUser.delete(authUserId)
      return { state: 'disabled' }
    }
    const reactivationStatus = this.reactivationStatusByUser.get(authUserId)
    if (reactivationStatus) return reactivationStatus

    try {
      const registration = await readyRegistration()
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        return preference === true
          ? { state: 'enabled' }
          : {
              state: 'needs-reactivation',
              detail: 'Activa Push explícitamente para este administrador.',
            }
      }
      return preference === true
        ? {
            state: 'needs-reactivation',
            detail: 'La suscripción Push requiere reactivación en este dispositivo.',
          }
        : { state: 'disabled' }
    } catch (cause: unknown) {
      return {
        state: 'error',
        detail:
          cause instanceof Error
            ? cause.message
            : 'No fue posible consultar el estado de Push.',
      }
    }
  }

  async reactivateForLogin(authUserId: string): Promise<PushNotificationStatus> {
    const initial = unsupportedStatus()
    if (initial.state !== 'disabled') return initial
    if (!authUserId.trim()) return { state: 'disabled' }

    const preference = pushPreference(authUserId)
    if (preference !== true) {
      this.reactivationStatusByUser.delete(authUserId)
      return { state: 'disabled' }
    }

    const permission = Notification.permission
    if (permission === 'denied') return { state: 'permission-denied' }
    if (permission === 'default') return { state: 'permission-default' }

    try {
      const registration = await readyRegistration()
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        const status: PushNotificationStatus = {
          state: 'needs-reactivation',
          detail: 'La suscripción Push requiere reactivación en este dispositivo.',
        }
        this.reactivationStatusByUser.set(authUserId, status)
        return status
      }

      const serialized = subscriptionJSON(subscription as PushSubscriptionWithJSON)
      const { data, error } = await supabase!.rpc('resume_push_subscription', {
        p_endpoint: serialized.endpoint,
        p_p256dh: serialized.p256dh,
        p_auth: serialized.auth,
      })
      if (error) throw error
      if (data !== true) {
        const status: PushNotificationStatus = {
          state: 'needs-reactivation',
          detail: 'La suscripción requiere activación explícita en este dispositivo.',
        }
        this.reactivationStatusByUser.set(authUserId, status)
        return status
      }

      this.reactivationStatusByUser.delete(authUserId)
      savePushPreference(authUserId, true)
      return { state: 'enabled' }
    } catch (cause: unknown) {
      const status: PushNotificationStatus = {
        state: 'error',
        detail:
          cause instanceof Error
            ? cause.message
            : 'No fue posible reactivar la suscripción Push.',
      }
      this.reactivationStatusByUser.set(authUserId, status)
      return status
    }
  }

  async enable(authUserId: string): Promise<PushNotificationStatus> {
    const initial = unsupportedStatus()
    if (initial.state === 'unsupported' || initial.state === 'ios-install-required') {
      throw new PushNotificationError(
        initial.detail ?? 'Web Push no está disponible.',
        initial.state,
      )
    }
    if (!supabase) {
      throw new PushNotificationError('Supabase no está configurado.')
    }
    if (!authUserId.trim()) {
      throw new PushNotificationError('No fue posible identificar al administrador.')
    }
    if (Notification.permission === 'denied') {
      throw new PushNotificationError(
        'El navegador bloqueó las notificaciones. Habilítalas desde sus ajustes.',
        'permission-denied',
      )
    }

    let permission: NotificationPermission = Notification.permission
    if (permission === 'default') {
      // Invocar la solicitud antes del primer await conserva el gesto del
      // usuario requerido por algunos navegadores para mostrar el prompt.
      permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new PushNotificationError(
          permission === 'denied'
            ? 'El navegador bloqueó las notificaciones.'
            : 'No se concedió permiso para las notificaciones.',
          permission === 'denied' ? 'permission-denied' : 'permission-default',
        )
      }
    }

    const registration = await readyRegistration()
    let subscription = await registration.pushManager.getSubscription()
    let createdLocally = false

    if (subscription && pushPreference(authUserId) !== true) {
      try {
        const unsubscribed = await subscription.unsubscribe()
        if (!unsubscribed) {
          throw new Error('El navegador no confirmó la sustitución.')
        }
      } catch (cause: unknown) {
        throw new PushNotificationError(
          cause instanceof Error
            ? cause.message
            : 'No fue posible preparar la activación Push.',
        )
      }
      subscription = null
    }

    if (!subscription) {
      if (permission !== 'granted') {
        throw new PushNotificationError(
          'No se concedió permiso para las notificaciones.',
          permission === 'denied' ? 'permission-denied' : 'permission-default',
        )
      }

      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicVapidKey()),
        })
        createdLocally = true
      } catch (cause: unknown) {
        throw new PushNotificationError(
          cause instanceof Error
            ? cause.message
            : 'No fue posible crear la suscripción Push.',
        )
      }
    }

    let serialized: SerializedPushSubscription
    try {
      serialized = subscriptionJSON(subscription as PushSubscriptionWithJSON)
    } catch (cause: unknown) {
      if (createdLocally) {
        await subscription.unsubscribe().catch(() => undefined)
      }
      throw cause
    }
    try {
      const { data, error } = await supabase.rpc('register_push_subscription', {
        p_endpoint: serialized.endpoint,
        p_p256dh: serialized.p256dh,
        p_auth: serialized.auth,
      })
      if (error) throw error
      if (!data) throw new Error('No fue posible registrar el dispositivo.')
    } catch {
      if (createdLocally) {
        await subscription.unsubscribe().catch(() => undefined)
      }
      throw new PushNotificationError(
        'No fue posible registrar este dispositivo.',
      )
    }

    savePushPreference(authUserId, true)
    this.reactivationStatusByUser.delete(authUserId)
    return { state: 'enabled' }
  }

  async disable(authUserId: string): Promise<PushNotificationStatus> {
    const initial = unsupportedStatus()
    if (initial.state === 'unsupported' || initial.state === 'ios-install-required') {
      throw new PushNotificationError(
        initial.detail ?? 'Web Push no está disponible.',
        initial.state,
      )
    }
    if (!supabase) throw new PushNotificationError('Supabase no está configurado.')

    if (!authUserId.trim()) {
      throw new PushNotificationError('No fue posible identificar al administrador.')
    }
    savePushPreference(authUserId, false)
    this.reactivationStatusByUser.delete(authUserId)
    const registration = await readyRegistration()
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return { state: 'disabled' }

    let revokeFailed = false
    try {
      const { data, error } = await supabase.rpc('revoke_push_subscription', {
        p_endpoint: subscription.endpoint,
      })
      if (error || data !== true) revokeFailed = true
    } catch {
      revokeFailed = true
    }

    let unsubscribeFailed = false
    try {
      const unsubscribed = await subscription.unsubscribe()
      if (!unsubscribed) {
        unsubscribeFailed = true
      }
    } catch {
      unsubscribeFailed = true
    }

    if (revokeFailed) {
      throw new PushNotificationError(
        'No fue posible revocar la suscripción Push en el servidor.',
        'error',
      )
    }
    if (unsubscribeFailed) {
      throw new PushNotificationError(
        'No fue posible quitar la suscripción Push del navegador.',
        'error',
      )
    }

    return { state: 'disabled' }
  }

  async pauseForLogout(authUserId?: string): Promise<void> {
    if (!browserSupportsPush()) return

    let subscription: PushSubscription | null = null
    try {
      const registration = await withTimeout(
        readyRegistration(),
        LOGOUT_CLEANUP_TIMEOUT_MS,
      )
      subscription = await withTimeout(
        registration.pushManager.getSubscription(),
        LOGOUT_CLEANUP_TIMEOUT_MS,
      )
      if (!subscription) return
      if (!supabase) {
        throw new Error('Supabase no está configurado.')
      }

      const { data, error } = await withTimeout(
        Promise.resolve(
          supabase.rpc('pause_push_subscription', {
            p_endpoint: subscription.endpoint,
          }),
        ),
        LOGOUT_CLEANUP_TIMEOUT_MS,
      )
      if (error || data !== true) {
        throw new Error('No fue posible pausar la suscripción Push.')
      }
      return
    } catch (cause: unknown) {
      if (!subscription) {
        console.error(
          'No fue posible obtener la suscripción Push durante el logout',
          cause,
        )
        return
      }

      savePushPreference(authUserId ?? '', false)
      if (authUserId) this.reactivationStatusByUser.delete(authUserId)
      const revoke = supabase
        ? withTimeout(
            Promise.resolve(
              supabase.rpc('revoke_push_subscription', {
                p_endpoint: subscription.endpoint,
              }),
            ),
            LOGOUT_CLEANUP_TIMEOUT_MS,
          ).catch(() => undefined)
        : Promise.resolve(undefined)
      const unsubscribe = withTimeout(
        Promise.resolve(subscription.unsubscribe()),
        LOGOUT_CLEANUP_TIMEOUT_MS,
      ).catch(() => undefined)
      await Promise.allSettled([revoke, unsubscribe])
      console.error(
        'No fue posible pausar Push durante el logout; se aplicó el fallback local',
        cause,
      )
    }
  }
}

export const pushNotificationService = new PushNotificationService()
export { PUBLIC_KEY_ENV_NAME }
