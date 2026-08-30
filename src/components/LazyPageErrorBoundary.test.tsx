import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LazyPageErrorBoundary } from './LazyPageErrorBoundary'

describe('LazyPageErrorBoundary', () => {
  it('keeps chunk recovery in a loading state while the automatic reload is pending', () => {
    const state = LazyPageErrorBoundary.getDerivedStateFromError(
      new TypeError('Failed to fetch dynamically imported module'),
    )
    const boundary = new LazyPageErrorBoundary({
      children: null,
      resetKey: 'expenses',
    })
    boundary.state = {
      error: new TypeError('Failed to fetch dynamically imported module'),
      recovering: state.recovering,
    }

    const markup = renderToStaticMarkup(boundary.render())
    expect(markup).toContain('Actualizando la aplicación…')
  })

  it('shows a manual update action after chunk recovery is exhausted', () => {
    const boundary = new LazyPageErrorBoundary({
      children: null,
      resetKey: 'expenses',
    })
    boundary.state = {
      error: new TypeError('Loading chunk 4 failed'),
      recovering: false,
    }

    const markup = renderToStaticMarkup(boundary.render())
    expect(markup).toContain('No fue posible cargar esta sección')
    expect(markup).toContain('Actualizar')
  })

  it('does not classify a normal render failure as a chunk recovery', () => {
    const state = LazyPageErrorBoundary.getDerivedStateFromError(
      new Error('No fue posible calcular el resumen'),
    )

    expect(state.recovering).toBe(false)
  })
})
