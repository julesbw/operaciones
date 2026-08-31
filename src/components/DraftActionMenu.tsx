import { useEffect, useRef } from 'react'

type DraftActionMenuProps = {
  open: boolean
  onContinue: () => void
  onNew: () => void
  onClose: () => void
}

export function DraftActionMenu({
  open,
  onContinue,
  onNew,
  onClose,
}: DraftActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus()
    })
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyboard)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyboard)
    }
  }, [onClose, open])

  if (!open) return null

  return (
    <div
      aria-label="Acciones del borrador"
      className="draft-action-menu"
      ref={menuRef}
      role="menu"
    >
      <p className="px-3 pb-2 pt-2 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">
        Borrador sin guardar
      </p>
      <button
        className="draft-action-menu-item"
        role="menuitem"
        type="button"
        onClick={onContinue}
      >
        Continuar borrador
      </button>
      <button
        className="draft-action-menu-item"
        role="menuitem"
        type="button"
        onClick={onNew}
      >
        Nuevo
      </button>
    </div>
  )
}
