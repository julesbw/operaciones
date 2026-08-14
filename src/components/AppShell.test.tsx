import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { UserProfile } from '../domain/models'
import { AppShell } from './AppShell'

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
