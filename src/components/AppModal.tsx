import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { XIcon } from './icons'

type AppModalProps = {
  children: ReactNode
  closeDisabled?: boolean
  closeLabel: string
  eyebrow?: string
  headerContent?: ReactNode
  hasUnsavedChanges?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  open: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  scrollableContent?: boolean
  title: string
  cardClassName?: string
  overlayClassName?: string
  onClose: () => void
}

export function AppModal({
  children,
  closeDisabled = false,
  closeLabel,
  eyebrow,
  headerContent,
  hasUnsavedChanges = false,
  initialFocusRef,
  open,
  returnFocusRef,
  title,
  cardClassName,
  overlayClassName,
  onClose,
}: AppModalProps) {
  const titleId = useId()
  const wasOpenRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const closeDisabledRef = useRef(closeDisabled)
  const dirtyRef = useRef(hasUnsavedChanges)
  const initialFocusTargetRef = useRef(initialFocusRef)
  const onCloseRef = useRef(onClose)

  closeDisabledRef.current = closeDisabled
  dirtyRef.current = hasUnsavedChanges
  initialFocusTargetRef.current = initialFocusRef
  onCloseRef.current = onClose

  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) return

    const focusFrame = window.requestAnimationFrame(() => {
      const target = initialFocusTargetRef.current?.current ?? closeButtonRef.current
      target?.focus()
    })
    const handleKeyboard = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !dirtyRef.current &&
        !closeDisabledRef.current
      ) {
        onCloseRef.current()
      }
      if (event.key !== 'Tab') return

      const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyboard)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyboard)
    }
  }, [open])

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      window.requestAnimationFrame(() => returnFocusRef?.current?.focus())
    }
    wasOpenRef.current = open
  }, [open, returnFocusRef])

  function requestClose(force = false) {
    if (closeDisabledRef.current) return
    if (!force && dirtyRef.current) return
    onCloseRef.current()
  }

  if (!open) return null

  const overlayClasses = [
    'app-modal-overlay fixed inset-0 z-[60] flex min-h-dvh items-center justify-center overflow-hidden overscroll-none bg-slate-950/45 p-4 backdrop-blur-[3px]',
    overlayClassName,
  ].filter(Boolean).join(' ')
  const cardClasses = [
    'app-modal-card flex min-h-0 max-h-[calc(100dvh-2rem)] w-full max-w-[440px] flex-col overflow-hidden overscroll-none rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6',
    cardClassName,
  ].filter(Boolean).join(' ')

  return (
    <div
      className={overlayClasses}
      role="presentation"
      onClick={() => requestClose()}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={cardClasses}
        ref={cardRef}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              <h2
                className={`${eyebrow ? 'mt-1' : ''} text-2xl font-black text-slate-950`}
                id={titleId}
              >
                {title}
              </h2>
            </div>
            <button
              aria-label={closeLabel}
              className="icon-button shrink-0"
              disabled={closeDisabled}
              ref={closeButtonRef}
              type="button"
              onClick={() => requestClose(true)}
            >
              <XIcon className="size-5" />
            </button>
          </div>
          {headerContent}
        </div>
        <div className="app-modal-scroll-content min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none touch-pan-y">
          {children}
        </div>
      </div>
    </div>
  )
}
