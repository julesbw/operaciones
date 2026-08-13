import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ALL_STORES } from '../components/filters/StoreScopeSelector'
import type { Store, UserProfile } from '../domain/models'
import {
  resolveTransferOriginStoreId,
  TransfersPage,
} from './TransfersPage'

const stores: Store[] = [
  {
    id: 'origin-store',
    name: 'Antigua Casa Piedad',
    status: 'active',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  },
  {
    id: 'destination-store',
    name: 'GV La Piedad',
    status: 'active',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  },
]

const admin: UserProfile = {
  id: 'admin-id',
  fullName: 'Administración',
  role: 'admin',
}

const cashier: UserProfile = {
  id: 'cashier-id',
  fullName: 'Cajera',
  role: 'cashier',
  storeId: 'origin-store',
  storeName: 'Antigua Casa Piedad',
}

describe('TransfersPage store scope', () => {
  it('lets admins query all stores or one selected origin', () => {
    expect(resolveTransferOriginStoreId(admin, ALL_STORES)).toBeUndefined()
    expect(resolveTransferOriginStoreId(admin, 'origin-store')).toBe(
      'origin-store',
    )
  })

  it('always derives a cashier query from the assigned store', () => {
    expect(resolveTransferOriginStoreId(cashier, ALL_STORES)).toBe(
      'origin-store',
    )
    expect(resolveTransferOriginStoreId(cashier, 'destination-store')).toBe(
      'origin-store',
    )
  })

  it('opens on the list without rendering a form or dialog', () => {
    const markup = renderToStaticMarkup(
      <TransfersPage
        stores={stores}
        user={admin}
        onDataChanged={vi.fn()}
      />,
    )

    expect(markup).toContain('Transferencias')
    expect(markup).toContain('Todas')
    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('role="dialog"')
  })

  it('does not expose an editable store scope to cashiers', () => {
    const markup = renderToStaticMarkup(
      <TransfersPage
        stores={stores}
        user={cashier}
        onDataChanged={vi.fn()}
      />,
    )

    expect(markup).not.toContain('Todas')
    expect(markup).not.toContain('Tienda origen')
  })
})
