import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppModal } from './AppModal'

describe('AppModal scrollable layout', () => {
  it('keeps the custom header outside the only scrollable content area', () => {
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
    expect(markup).toContain('overflow-hidden')
    expect(markup).toContain('min-h-0 flex-1 overflow-y-auto')
    expect(markup.indexOf('Actividad reciente')).toBeLessThan(
      markup.indexOf('min-h-0 flex-1 overflow-y-auto'),
    )
  })
})
