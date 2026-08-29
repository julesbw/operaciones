import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Store } from '../domain/models'
import { OperatorLoginPage } from './OperatorLoginPage'

const store: Store = {
  id: 'store-id',
  name: 'Tienda Centro',
  status: 'active',
  createdAt: '2026-08-13T12:00:00.000Z',
  updatedAt: '2026-08-13T12:00:00.000Z',
}

function render(): string {
  return renderToStaticMarkup(
    <OperatorLoginPage
      networkAvailable
      store={store}
      technicalUserId="technical-user-id"
      onSignedIn={vi.fn()}
      onSignOut={vi.fn()}
    />,
  )
}

describe('OperatorLoginPage', () => {
  it('keeps the operator login compact on desktop and exposes technical logout', () => {
    const markup = render()

    expect(markup).toContain('<div class="w-full max-w-md lg:max-w-[27rem]">')
    expect(markup.indexOf('>Entrar</button>')).toBeLessThan(
      markup.indexOf('>Cerrar sesión</button>'),
    )
    expect(markup).toContain('class="button-secondary w-full"')
  })
})
