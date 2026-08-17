import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ALL_STORES } from '../components/filters/StoreScopeSelector'
import type { Store, UserProfile } from '../domain/models'
import { CollaboratorsPage } from './CollaboratorsPage'

const stores: Store[] = [
  {
    id: 'store-id',
    name: 'Tienda Centro',
    status: 'active',
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
  },
]

function render(user: UserProfile): string {
  return renderToStaticMarkup(
    <CollaboratorsPage
      attendanceStoreFilter={ALL_STORES}
      stores={stores}
      user={user}
      onAttendanceStoreFilterChange={vi.fn()}
      onDataChanged={vi.fn()}
    />,
  )
}

describe('CollaboratorsPage', () => {
  it('defaults administrators to attendance and keeps payments one click away', () => {
    const markup = render({
      id: 'admin-id',
      fullName: 'Administración',
      role: 'admin',
    })

    expect(markup).toContain('Colaboradores')
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Asistencias/)
    expect(markup).toContain('Pagos')
  })

  it('does not expose payments to cashiers', () => {
    const markup = render({
      id: 'cashier-id',
      fullName: 'Caja',
      role: 'cashier',
      storeId: stores[0]!.id,
    })

    expect(markup).toContain('Colaboradores')
    expect(markup).not.toContain('Pagos')
  })
})
