import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Store } from '../../domain/models'
import { ALL_STORES, StoreScopeSelector } from './StoreScopeSelector'

const stores: Store[] = [
  {
    id: 'store-active',
    name: 'Tienda activa',
    status: 'active',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  },
  {
    id: 'store-inactive',
    name: 'Tienda inactiva',
    status: 'inactive',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  },
]

describe('StoreScopeSelector', () => {
  it('shows all and active stores to admins', () => {
    const markup = renderToStaticMarkup(
      <StoreScopeSelector
        ariaLabel="Filtrar por tienda"
        role="admin"
        stores={stores}
        value={ALL_STORES}
        onChange={() => undefined}
      />,
    )

    expect(markup).toContain('Todas')
    expect(markup).toContain('Tienda activa')
    expect(markup).not.toContain('Tienda inactiva')
  })

  it('lets admins select an available store', () => {
    const onChange = vi.fn()
    const selector = StoreScopeSelector({
      ariaLabel: 'Filtrar por tienda',
      role: 'admin',
      stores,
      value: ALL_STORES,
      onChange,
    })

    if (!selector || typeof selector.type === 'string') {
      throw new Error('Se esperaba un FilterChipGroup')
    }
    selector.props.onChange('store-active')

    expect(onChange).toHaveBeenCalledWith('store-active')
  })

  it('hides the selector from cashiers by default', () => {
    expect(
      StoreScopeSelector({
        ariaLabel: 'Tienda asignada',
        assignedStoreId: 'store-active',
        role: 'cashier',
        stores,
        value: 'store-active',
        onChange: vi.fn(),
      }),
    ).toBeNull()
  })

  it('can show only the assigned store as a locked chip', () => {
    const markup = renderToStaticMarkup(
      <StoreScopeSelector
        ariaLabel="Tienda asignada"
        assignedStoreId="store-active"
        cashierPresentation="locked"
        role="cashier"
        stores={stores}
        value="store-inactive"
        onChange={vi.fn()}
      />,
    )

    expect(markup).toContain('Tienda activa')
    expect(markup).not.toContain('Todas')
    expect(markup).not.toContain('Tienda inactiva')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('aria-pressed="true"')
  })
})
