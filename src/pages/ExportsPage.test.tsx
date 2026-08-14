import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Store, UserProfile } from '../domain/models'
import { ExportsPage } from './ExportsPage'

const stores: Store[] = [
  {
    id: 'store-id',
    name: 'Tienda Centro',
    status: 'active',
    createdAt: '2026-08-14T12:00:00.000Z',
    updatedAt: '2026-08-14T12:00:00.000Z',
  },
]
const admin: UserProfile = {
  id: 'admin-id',
  fullName: 'Administración',
  role: 'admin',
}

describe('ExportsPage access and structure', () => {
  it('renders the admin tabs, scope and date filters', () => {
    const markup = renderToStaticMarkup(
      <ExportsPage networkAvailable stores={stores} user={admin} />,
    )

    expect(markup).toContain('Exportación')
    expect(markup).toContain('Pendientes')
    expect(markup).toContain('Historial')
    expect(markup).toContain('Filtrar exportaciones por tienda')
    expect(markup).toContain('Fecha inicial de exportación')
    expect(markup).toContain('Fecha final de exportación')
  })

  it('renders nothing for a cashier even if invoked directly', () => {
    const markup = renderToStaticMarkup(
      <ExportsPage
        networkAvailable
        stores={stores}
        user={{ ...admin, role: 'cashier', storeId: stores[0]!.id }}
      />,
    )

    expect(markup).toBe('')
  })
})
