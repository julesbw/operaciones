import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Store, UserProfile } from '../domain/models'
import { PaymentsPage } from './PaymentsPage'

const stores: Store[] = [
  {
    id: 'store-id',
    name: 'Tienda Centro',
    status: 'active',
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
  },
]
const admin: UserProfile = {
  id: 'admin-id',
  fullName: 'Administración',
  role: 'admin',
}

describe('PaymentsPage access', () => {
  it('renders the independent admin payments module', () => {
    const markup = renderToStaticMarkup(
      <PaymentsPage stores={stores} user={admin} />,
    )

    expect(markup).toContain('Pagos')
    expect(markup).toContain('Pendientes')
    expect(markup).toContain('Historial')
    expect(markup).toContain('Filtrar pagos por tienda asignada')
    expect(markup).not.toContain('Actualizar')
    expect(markup).not.toContain(
      'Liquida días trabajados y conserva su evidencia histórica.',
    )
  })

  it('renders nothing for a cashier even if invoked directly', () => {
    const markup = renderToStaticMarkup(
      <PaymentsPage
        stores={stores}
        user={{ ...admin, role: 'cashier', storeId: stores[0]!.id }}
      />,
    )
    expect(markup).toBe('')
  })
})
