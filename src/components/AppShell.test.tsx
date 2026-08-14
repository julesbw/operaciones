import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { UserProfile } from '../domain/models'
import { AppShell, navigationItemsForRole, type PageId } from './AppShell'

const user: UserProfile = {
  id: 'user-id',
  fullName: 'Usuario Local',
  role: 'cashier',
  storeId: 'store-id',
}

function renderStatus(
  overrides: Partial<{
    backendReachable: boolean
    networkAvailable: boolean
    pendingCount: number
    syncError: string
    syncing: boolean
    currentPage: PageId
  }> = {},
) {
  return renderToStaticMarkup(
    <AppShell
      currentPage="home"
      networkAvailable
      pendingCount={0}
      syncing={false}
      user={user}
      onNavigate={vi.fn()}
      onSignOut={vi.fn()}
      onSync={vi.fn()}
      {...overrides}
    >
      <p>Contenido local</p>
    </AppShell>,
  )
}

describe('AppShell sync indicator', () => {
  it('distinguishes an offline device from a reachable backend', () => {
    const markup = renderStatus({
      networkAvailable: false,
      pendingCount: 2,
    })

    expect(markup).toContain('Sin conexión')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Contenido local')
  })

  it('reports backend errors separately from browser connectivity', () => {
    const markup = renderStatus({
      backendReachable: false,
      syncError: 'Supabase no respondió',
    })

    expect(markup).toContain('Error de sincronización')
    expect(markup).toContain('title="Supabase no respondió"')
  })
})

describe('AppShell payments navigation', () => {
  it('shows payments only to administrators', () => {
    const cashierMarkup = renderStatus()
    const adminMarkup = renderToStaticMarkup(
      <AppShell
        currentPage="home"
        networkAvailable
        pendingCount={0}
        syncing={false}
        user={{ ...user, role: 'admin' }}
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onSync={vi.fn()}
      >
        Contenido
      </AppShell>,
    )

    expect(cashierMarkup).not.toContain('Pagos')
    expect(adminMarkup).toContain('Pagos')
  })
})

describe('AppShell mobile navigation', () => {
  it('keeps exactly three primary modules and places the rest under Más', () => {
    const items = navigationItemsForRole('admin')

    expect(
      items
        .filter((item) => item.mobilePlacement === 'primary')
        .map((item) => item.label),
    ).toEqual(['Inicio', 'Gastos', 'Transferencias'])
    expect(
      items
        .filter((item) => item.mobilePlacement === 'more')
        .map((item) => item.label),
    ).toEqual(['Asistencias', 'Pagos', 'Cortes', 'Exportación'])
  })

  it('limits the cashier Más menu to attendance', () => {
    expect(
      navigationItemsForRole('cashier')
        .filter((item) => item.mobilePlacement === 'more')
        .map((item) => item.label),
    ).toEqual(['Asistencias'])
  })

  it('renders four mobile controls and exposes the Más menu state', () => {
    const markup = renderStatus({ currentPage: 'payments' })
    const mobileNav = markup.match(
      /<nav class="mobile-nav lg:hidden"[^>]*>([\s\S]*?)<\/nav>/,
    )?.[1]

    expect(mobileNav?.match(/<button/g)).toHaveLength(4)
    expect(mobileNav).toContain('aria-label="Más"')
    expect(mobileNav).toContain('aria-expanded="false"')
    expect(mobileNav).toContain('aria-haspopup="menu"')
    expect(markup.match(/data-state="closed"/g)).toHaveLength(2)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('inert=""')
  })

  it('marks Más as current on a secondary module', () => {
    const markup = renderToStaticMarkup(
      <AppShell
        currentPage="payments"
        networkAvailable
        pendingCount={0}
        syncing={false}
        user={{ ...user, role: 'admin' }}
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        onSync={vi.fn()}
      >
        Contenido
      </AppShell>,
    )
    const moreButton = markup.match(
      /<button[^>]*aria-label="Más"[^>]*>/,
    )?.[0]

    expect(moreButton).toContain('aria-current="page"')
  })
})
