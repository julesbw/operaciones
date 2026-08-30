import { isSupabaseConfigured, supabase } from '../lib/supabase'

export const PUSH_NOTIFICATION_STATES = [
  'unsupported',
  'ios-install-required',
  'permission-default',
  'enabled',
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
const LOCAL_PUSH_DISABLED_KEY = 'operaciones-push-disabled'
const LOGOUT_CLEANUP_TIMEOUT_MS = 5_000

function publicVapidKey(): string {
  return import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? ''
}

function isLocallyDisabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(LOCAL_PUSH_DISABLED_KEY) === '1'
  } catch {
    return false
  }
}

function markLocallyDisabled(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LOCAL_PUSH_DISABLED_KEY, '1')
  } catch {
    // La suscripción remota y la del navegador siguen siendo la fuente principal.
  }
}

function clearLocallyDisabled(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(LOCAL_PUSH_DISABLED_KEY)
  } catch {
    // La activación remota ya quedó registrada aunque no se pueda limpiar la marca.
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
): { endpoint: string; p256dh: string; auth: string } {
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
  async getStatus(): Promise<PushNotificationStatus> {
    const initial = unsupportedStatus()
    if (initial.state !== 'disabled') return initial

    const permission = Notification.permission
    if (permission === 'denied') return { state: 'permission-denied' }
    if (permission === 'default') return { state: 'permission-default' }
    if (isLocallyDisabled()) return { state: 'disabled' }

    try {
      const registration = await readyRegistration()
      const subscription = await registration.pushManager.getSubscription()
      return subscription ? { state: 'enabled' } : { state: 'disabled' }
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

  async enable(): Promise<PushNotificationStatus> {
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
    const renewAfterLogout = isLocallyDisabled()
    let subscription = await registration.pushManager.getSubscription()
    let createdLocally = false

    if (subscription && renewAfterLogout) {
      try {
        const unsubscribed = await subscription.unsubscribe()
        if (!unsubscribed) {
          throw new Error('El navegador no confirmó la renovación.')
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

    let serialized: { endpoint: string; p256dh: string; auth: string }
    try {
      serialized = subscriptionJSON(subscription as PushSubscriptionWithJSON)
    } catch (cause: unknown) {
      if (createdLocally) {
        await subscription.unsubscribe().catch(() => undefined)
      }
      throw cause
    }
    try {
      const { error } = await supabase.rpc('register_push_subscription', {
        p_endpoint: serialized.endpoint,
        p_p256dh: serialized.p256dh,
        p_auth: serialized.auth,
      })
      if (error) throw error
    } catch {
      if (createdLocally) {
        await subscription.unsubscribe().catch(() => undefined)
      }
      throw new PushNotificationError(
        'No fue posible registrar este dispositivo.',
      )
    }

    clearLocallyDisabled()
    return { state: 'enabled' }
  }

  async disable(): Promise<PushNotificationStatus> {
    const initial = unsupportedStatus()
    if (initial.state === 'unsupported' || initial.state === 'ios-install-required') {
      throw new PushNotificationError(
        initial.detail ?? 'Web Push no está disponible.',
        initial.state,
      )
    }
    if (!supabase) throw new PushNotificationError('Supabase no está configurado.')

    markLocallyDisabled()
    const registration = await readyRegistration()
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return { state: 'disabled' }

    let revokeFailed = false
    try {
      const { error } = await supabase.rpc('revoke_push_subscription', {
        p_endpoint: subscription.endpoint,
      })
      if (error) revokeFailed = true
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

  async disableForLogout(): Promise<void> {
    const initial = unsupportedStatus()
    if (initial.state !== 'disabled') return

    markLocallyDisabled()
    try {
      await withTimeout(this.disable(), LOGOUT_CLEANUP_TIMEOUT_MS)
    } catch (cause: unknown) {
      const detail = cause instanceof PushNotificationError
        ? cause.message
        : 'No fue posible limpiar la suscripción Push.'
      console.error('No fue posible limpiar Push durante el logout', detail)
    }
  }
}

export const pushNotificationService = new PushNotificationService()
export { PUBLIC_KEY_ENV_NAME }
