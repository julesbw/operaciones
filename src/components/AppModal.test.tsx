import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppModal } from './AppModal'

describe('AppModal scrollable layout', () => {
  it('keeps the panel stable and the custom header outside the scroll area', () => {
    const markup = renderToStaticMarkup(
      <AppModal
        cardClassName="notification-modal-card"
        closeLabel="Cerrar"
        headerContent={<p>Actividad reciente</p>}
        open
        overlayClassName="notification-modal-overlay"
        scrollableContent
        title="Notificaciones"
        onClose={vi.fn()}
      >
        <ul>
          <li>Compra registrada</li>
        </ul>
      </AppModal>,
    )

    expect(markup).toContain('notification-modal-card')
    expect(markup).toContain('overflow-hidden overscroll-none')
    expect(markup).toContain(
      'app-modal-scroll-content min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none touch-pan-y',
    )
    expect(markup.indexOf('Actividad reciente')).toBeLessThan(
      markup.indexOf('app-modal-scroll-content min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none touch-pan-y'),
    )
  })

  it('uses the same inner scroll container for regular form modals', () => {
    const markup = renderToStaticMarkup(
      <AppModal
        closeLabel="Cerrar"
        open
        title="Nuevo gasto"
        onClose={vi.fn()}
      >
        <form>
          <input aria-label="Monto" />
        </form>
      </AppModal>,
    )

    expect(markup).toContain(
      'app-modal-card flex min-h-0 max-h-[calc(100dvh-2rem)] w-full max-w-[440px] flex-col overflow-hidden overscroll-none',
    )
    expect(markup).toContain(
      'app-modal-scroll-content min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none touch-pan-y',
    )
  })
})
