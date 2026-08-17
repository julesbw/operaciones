import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Store, UserProfile } from '../domain/models'
import { CentralCashPage } from './CentralCashPage'

const stores: Store[] = [
  {
    id: 'store-id',
    name: 'Tienda Centro',
    status: 'active',
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
  },
]

const admin: UserProfile = {
  id: 'admin-id',
  fullName: 'Administración',
  role: 'admin',
}

describe('CentralCashPage access and structure', () => {
  it('renders the derived balance, tabs, filters and adjustment action', () => {
    const markup = renderToStaticMarkup(
      <CentralCashPage networkAvailable stores={stores} user={admin} />,
    )

    expect(markup).toContain('Caja Central')
    expect(markup).toContain('Saldo actual')
    expect(markup).toContain('Movimientos')
    expect(markup).toContain('Por recibir')
    expect(markup).toContain('Efectivo físico central')
    expect(markup).toContain('Ver desglose de efectivo')
    expect(markup).toContain('Denominación')
    expect(markup).toContain('Subtotal')
    expect(markup).toContain('Filtrar Caja Central por tienda')
    expect(markup).toContain('aria-label="Nuevo ajuste"')
  })

  it('renders nothing for a cashier even if invoked directly', () => {
    const markup = renderToStaticMarkup(
      <CentralCashPage
        networkAvailable
        stores={stores}
        user={{ ...admin, role: 'cashier', storeId: stores[0]!.id }}
      />,
    )

    expect(markup).toBe('')
  })

  it('disables definitive actions while offline', () => {
    const markup = renderToStaticMarkup(
      <CentralCashPage networkAvailable={false} stores={stores} user={admin} />,
    )

    expect(markup).toContain('Los ajustes requieren conexión')
    expect(markup).toContain('disabled=""')
  })
})
