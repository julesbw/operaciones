import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { OperatorSession, Store, UserProfile } from '../domain/models'
import { PurchasesPage } from './PurchasesPage'

const stores: Store[] = [
  {
    id: 'store-id',
    name: 'Tienda Centro',
    status: 'active',
    createdAt: '2026-08-17T12:00:00.000Z',
    updatedAt: '2026-08-17T12:00:00.000Z',
  },
]

const admin: UserProfile = {
  id: 'admin-id',
  fullName: 'Administración',
  role: 'admin',
}

const storeManagerSession: OperatorSession = {
  token: 'operator-token',
  expiresAt: '2999-01-01T00:00:00.000Z',
  account: {
    id: 'manager-id',
    username: 'manager',
    displayName: 'Encargada',
    role: 'store_manager',
    storeId: stores[0]!.id,
  },
}

describe('PurchasesPage access and structure', () => {
  it('renders the admin history filters and creation action', () => {
    const markup = renderToStaticMarkup(
      <PurchasesPage
        networkAvailable
        stores={stores}
        user={admin}
        onDataChanged={vi.fn()}
      />,
    )

    expect(markup).toContain('<h1 class="page-title">Compras</h1>')
    expect(markup).toContain('Filtrar Compras por origen')
    expect(markup).toContain('Filtrar Compras por tienda')
    expect(markup).toContain('aria-label="Registrar nueva Compra"')
  })

  it('renders nothing for a cashier even if invoked directly', () => {
    const markup = renderToStaticMarkup(
      <PurchasesPage
        networkAvailable
        stores={stores}
        user={{ ...admin, role: 'cashier', storeId: stores[0]!.id }}
        onDataChanged={vi.fn()}
      />,
    )

    expect(markup).toBe('')
  })

  it('locks a store manager to store cash in the assigned store', () => {
    const markup = renderToStaticMarkup(
      <PurchasesPage
        networkAvailable
        operatorSession={storeManagerSession}
        stores={stores}
        user={{ ...admin, role: 'cashier', storeId: stores[0]!.id }}
        onDataChanged={vi.fn()}
      />,
    )

    expect(markup).toContain('<h1 class="page-title">Compras</h1>')
    expect(markup).toContain('Filtrar Compras por tienda')
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('Filtrar Compras por origen')
    expect(markup).not.toContain('Caja Central')
  })
})
