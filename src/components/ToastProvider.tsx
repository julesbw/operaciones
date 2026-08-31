import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { XIcon } from './icons'

export type ToastKind = 'success' | 'info' | 'warning' | 'error'

export type ToastOptions = {
  title?: string
  description?: string
  message?: string
  duration?: number
  dedupeKey?: string
  id?: string
}

export type ToastContent = string | ToastOptions

export const TOAST_DURATIONS: Record<ToastKind, number> = {
  success: 3_000,
  info: 3_600,
  warning: 5_000,
  error: 6_000,
}

type ToastRecord = {
  id: string
  kind: ToastKind
  title?: string
  description: string
  dedupeKey: string
}

type ToastAction = (
  content: ToastContent,
  options?: ToastOptions,
) => string | undefined

export type ToastController = {
  success: ToastAction
  info: ToastAction
  warning: ToastAction
  error: ToastAction
}

type ToastContextValue = {
  toast: ToastController
  toasts: ToastRecord[]
  dismiss: (id: string) => void
}

const MAX_VISIBLE_TOASTS = 4

const noopToastAction: ToastAction = () => undefined
const fallbackToast: ToastController = {
  success: noopToastAction,
  info: noopToastAction,
  warning: noopToastAction,
  error: noopToastAction,
}
const fallbackToastContext: ToastContextValue = {
  toast: fallbackToast,
  toasts: [],
  dismiss: () => undefined,
}

const ToastContext = createContext<ToastContextValue>(fallbackToastContext)

function normalizeContent(
  content: ToastContent,
  options?: ToastOptions,
): ToastOptions {
  return typeof content === 'string'
    ? { description: content, ...options }
    : { ...content, ...options }
}

function toastSymbol(kind: ToastKind): string {
  if (kind === 'success') return '✓'
  if (kind === 'info') return 'i'
  if (kind === 'warning') return '!'
  return '×'
}

export function ToastViewport() {
  const { dismiss, toasts } = useContext(ToastContext)

  return (
    <div aria-label="Mensajes del sistema" className="toast-viewport">
      {toasts.map((toast) => (
        <article
          aria-atomic="true"
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
          className={`toast toast-${toast.kind}`}
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <span aria-hidden="true" className="toast-symbol">
            {toastSymbol(toast.kind)}
          </span>
          <div className="min-w-0 flex-1">
            {toast.title && <p className="toast-title">{toast.title}</p>}
            {toast.description && (
              <p className={toast.title ? 'toast-description' : 'toast-title'}>
                {toast.description}
              </p>
            )}
          </div>
          <button
            aria-label="Cerrar notificación"
            className="toast-close"
            type="button"
            onClick={() => dismiss(toast.id)}
          >
            <XIcon className="size-4" />
          </button>
        </article>
      ))}
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const toastsRef = useRef<ToastRecord[]>([])
  const activeDedupeKeysRef = useRef(new Set<string>())
  const timersRef = useRef(new Map<string, number>())
  const sequenceRef = useRef(0)

  const dismiss = useCallback((id: string) => {
    const removed = toastsRef.current.find((toast) => toast.id === id)
    if (!removed) return

    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
    activeDedupeKeysRef.current.delete(removed.dedupeKey)
    const nextToasts = toastsRef.current.filter((toast) => toast.id !== id)
    toastsRef.current = nextToasts
    setToasts(nextToasts)
  }, [])

  const push = useCallback(
    (
      kind: ToastKind,
      content: ToastContent,
      options?: ToastOptions,
    ): string | undefined => {
      const payload = normalizeContent(content, options)
      const description = payload.description ?? payload.message ?? ''
      const title = payload.title
      if (!description && !title) return undefined

      const dedupeKey = payload.dedupeKey ?? `${kind}:${title ?? ''}:${description}`
      if (activeDedupeKeysRef.current.has(dedupeKey)) return undefined

      const id = payload.id ?? `toast-${++sequenceRef.current}`
      const record: ToastRecord = {
        id,
        kind,
        title,
        description,
        dedupeKey,
      }
      activeDedupeKeysRef.current.add(dedupeKey)

      let nextToasts = [...toastsRef.current, record]
      while (nextToasts.length > MAX_VISIBLE_TOASTS) {
        const oldest = nextToasts.shift()
        if (!oldest) break
        activeDedupeKeysRef.current.delete(oldest.dedupeKey)
        const timer = timersRef.current.get(oldest.id)
        if (timer !== undefined) {
          window.clearTimeout(timer)
          timersRef.current.delete(oldest.id)
        }
      }
      toastsRef.current = nextToasts
      setToasts(nextToasts)

      const duration = Math.max(
        0,
        payload.duration ?? TOAST_DURATIONS[kind],
      )
      if (duration > 0 && typeof window !== 'undefined') {
        const timer = window.setTimeout(() => dismiss(id), duration)
        timersRef.current.set(id, timer)
      }
      return id
    },
    [dismiss],
  )

  const toast = useMemo<ToastController>(
    () => ({
      success: (content, options) => push('success', content, options),
      info: (content, options) => push('info', content, options),
      warning: (content, options) => push('warning', content, options),
      error: (content, options) => push('error', content, options),
    }),
    [push],
  )

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  const contextValue = useMemo<ToastContextValue>(
    () => ({ dismiss, toast, toasts }),
    [dismiss, toast, toasts],
  )

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  )
}

export function useToast(): {
  toast: ToastController
  dismiss: (id: string) => void
} {
  const { dismiss, toast } = useContext(ToastContext)
  return { dismiss, toast }
}
