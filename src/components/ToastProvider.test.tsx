import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  TOAST_DURATIONS,
  ToastProvider,
  ToastViewport,
  useToast,
} from './ToastProvider'

function ToastProbe() {
  const { toast } = useToast()
  return <button type="button" onClick={() => toast.success('Listo')}>Acción</button>
}

describe('ToastProvider', () => {
  it('exposes the shared toast API without changing page layout', () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    )

    expect(markup).toContain('Acción')
    expect(markup).toContain('class="toast-viewport"')
    expect(markup).toContain('aria-label="Mensajes del sistema"')
  })

  it('keeps the intended default durations by severity', () => {
    expect(TOAST_DURATIONS).toEqual({
      success: 3_000,
      info: 3_600,
      warning: 5_000,
      error: 6_000,
    })
  })

  it('can render the viewport safely outside a provider', () => {
    expect(renderToStaticMarkup(<ToastViewport />)).toContain(
      'Mensajes del sistema',
    )
  })
})
