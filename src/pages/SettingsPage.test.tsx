import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Store, UserProfile } from '../domain/models'
import { SettingsPage } from './SettingsPage'

const stores: Store[] = [{
  id: 'store-id',
  name: 'Tienda Centro',
  status: 'active',
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z',
}]

function render(user: UserProfile): string {
  return renderToStaticMarkup(
    <SettingsPage stores={stores} user={user} onStoresChanged={vi.fn()} />,
  )
}

describe('SettingsPage operational users', () => {
  it('shows Usuarios only to the existing Supabase admin role', () => {
    expect(render({ id: 'admin', fullName: 'Admin', role: 'admin' })).toContain('Usuarios')
  })

  it('does not expose Usuarios to cashiers', () => {
    expect(render({ id: 'cashier', fullName: 'Caja', role: 'cashier', storeId: 'store-id' })).not.toContain('Usuarios')
  })
})
