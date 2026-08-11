import type { ComponentType, SVGProps } from 'react'
import type { UserProfile } from '../domain/models'
import {
  CashIcon,
  HomeIcon,
  LogoutIcon,
  ReceiptIcon,
  SettingsIcon,
  SyncIcon,
  UsersIcon,
  WifiOffIcon,
} from './icons'

export type PageId = 'home' | 'expenses' | 'attendance' | 'closings' | 'settings'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

type NavigationItem = {
  id: PageId
  label: string
  icon: IconComponent
  adminOnly?: boolean
}

const NAVIGATION: NavigationItem[] = [
  { id: 'home', label: 'Inicio', icon: HomeIcon },
  { id: 'expenses', label: 'Gastos', icon: ReceiptIcon },
  { id: 'attendance', label: 'Asistencias', icon: UsersIcon },
  { id: 'closings', label: 'Cortes', icon: CashIcon, adminOnly: true },
  { id: 'settings', label: 'Ajustes', icon: SettingsIcon, adminOnly: true },
]

type AppShellProps = {
  children: React.ReactNode
  currentPage: PageId
  online: boolean
  pendingCount: number
  syncing: boolean
  user: UserProfile
  onNavigate: (page: PageId) => void
  onSignOut: () => void
  onSync: () => void
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function AppShell({
  children,
  currentPage,
  online,
  pendingCount,
  syncing,
  user,
  onNavigate,
  onSignOut,
  onSync,
}: AppShellProps) {
  const items = NAVIGATION.filter(
    (item) => !item.adminOnly || user.role === 'admin',
  )

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sidebar hidden lg:flex">
        <button
          className="flex items-center gap-3 text-left"
          type="button"
          onClick={() => onNavigate('home')}
        >
          <img
            alt=""
            className="brand-mark"
            src="/la-piedad-operaciones-ui.png"
          />
          <span>
            <span className="brand-name">La Piedad</span>
            <span className="brand-kicker">Operaciones</span>
          </span>
        </button>

        <nav className="mt-10 flex-1 space-y-1.5" aria-label="Navegación principal">
          {items.map((item) => {
            const Icon = item.icon
            const active = item.id === currentPage
            return (
              <button
                aria-current={active ? 'page' : undefined}
                className={active ? 'side-nav-active' : 'side-nav-item'}
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
              >
                <Icon className="size-5" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex items-center gap-3">
            <span className="avatar">{initials(user.fullName)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-slate-900">
                {user.fullName}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {user.role === 'admin' ? 'Administración' : user.storeName}
              </span>
            </span>
            <button
              aria-label="Cerrar sesión"
              className="icon-button"
              type="button"
              onClick={onSignOut}
            >
              <LogoutIcon className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="topbar">
          <div className="flex items-center gap-3 lg:hidden">
            <img
              alt=""
              className="brand-mark size-12"
              src="/la-piedad-operaciones-ui.png"
            />
            <div>
              <p className="brand-name text-lg">La Piedad</p>
              <p className="brand-kicker text-[9px]">Operaciones</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              className={`sync-pill ${!online ? 'sync-pill-offline' : ''}`}
              disabled={syncing}
              type="button"
              onClick={onSync}
            >
              {!online ? (
                <WifiOffIcon className="size-4" />
              ) : (
                <SyncIcon className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
              )}
              <span className="hidden sm:inline">
                {!online
                  ? 'Sin conexión'
                  : syncing
                    ? 'Sincronizando'
                    : pendingCount > 0
                      ? `${pendingCount} pendiente${pendingCount === 1 ? '' : 's'}`
                      : 'Al día'}
              </span>
              {pendingCount > 0 && <span className="sm:hidden">{pendingCount}</span>}
            </button>
            <button
              aria-label="Cerrar sesión"
              className="avatar lg:hidden"
              title={user.fullName}
              type="button"
              onClick={onSignOut}
            >
              {initials(user.fullName)}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pb-12">
          {children}
        </main>

        <nav className="mobile-nav lg:hidden" aria-label="Navegación principal">
          {items.map((item) => {
            const Icon = item.icon
            const active = item.id === currentPage
            return (
              <button
                aria-current={active ? 'page' : undefined}
                className={active ? 'mobile-nav-active' : 'mobile-nav-item'}
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
              >
                <Icon className="size-[22px]" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
