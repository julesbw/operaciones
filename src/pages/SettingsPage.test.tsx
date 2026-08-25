import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { OperatorSession, Store, UserProfile } from '../domain/models'
import { SettingsPage } from './SettingsPage'

const stores: Store[] = [{
  id: 'store-id',
  name: 'Tienda Centro',
  status: 'active',
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z',
}]

function operator(role: 'cashier' | 'store_manager'): OperatorSession {
  return {
    token: 'operator-token',
    expiresAt: '2999-01-01T00:00:00.000Z',
    account: {
      id: `${role}-id`,
      username: role,
      displayName: role,
      role,
      storeId: 'store-id',
    },
  }
}

function render(user: UserProfile, operatorSession?: OperatorSession): string {
  return renderToStaticMarkup(
    <SettingsPage
      operatorSession={operatorSession}
      stores={stores}
      user={user}
      onStoresChanged={vi.fn()}
    />,
  )
}

describe('SettingsPage operational users', () => {
  it('shows Usuarios only to the existing Supabase admin role', () => {
    expect(render({ id: 'admin', fullName: 'Admin', role: 'admin' })).toContain('Usuarios')
  })

  it('does not expose Usuarios to cashiers', () => {
    expect(render({ id: 'cashier', fullName: 'Caja', role: 'cashier', storeId: 'store-id' })).not.toContain('Usuarios')
  })

  it('lets store managers open supplier creation without exposing admin settings', () => {
    const markup = render(
      { id: 'cashier', fullName: 'Terminal', role: 'cashier', storeId: 'store-id' },
      operator('store_manager'),
    )

    expect(markup).toContain('Proveedores')
    expect(markup).toContain('Agregar proveedor')
    expect(markup).not.toContain('Usuarios')
    expect(markup).not.toContain('Tiendas registradas')
  })
})
