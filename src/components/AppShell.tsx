import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SVGProps,
} from 'react'
import type { UserProfile } from '../domain/models'
import {
  ArrowIcon,
  CashIcon,
  HomeIcon,
  LogoutIcon,
  ReceiptIcon,
  SettingsIcon,
  SyncIcon,
  TransferIcon,
  UsersIcon,
  WifiOffIcon,
  XIcon,
} from './icons'

export type PageId =
  | 'home'
  | 'expenses'
  | 'transfers'
  | 'attendance'
  | 'closings'
  | 'settings'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

type NavigationItem = {
  id: PageId
  label: string
  mobileLabel?: string
  icon: IconComponent
  adminOnly?: boolean
}

const NAVIGATION: NavigationItem[] = [
  { id: 'home', label: 'Inicio', icon: HomeIcon },
  { id: 'expenses', label: 'Gastos', icon: ReceiptIcon },
  {
    id: 'transfers',
    label: 'Transferencias',
    mobileLabel: 'Transfer.',
    icon: TransferIcon,
  },
  { id: 'attendance', label: 'Asistencias', icon: UsersIcon },
  { id: 'closings', label: 'Cortes', icon: CashIcon, adminOnly: true },
]

type AppShellProps = {
  children: ReactNode
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
  const [profileOpen, setProfileOpen] = useState(false)
  const profileButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const swipeStartRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const restoreScrollRef = useRef(true)
  const items = NAVIGATION.filter(
    (item) => !item.adminOnly || user.role === 'admin',
  )
  const roleLabel = user.role === 'admin' ? 'Administrador' : 'Cashier'

  useEffect(() => {
    if (!profileOpen) return

    const scrollPosition = window.scrollY
    const previousBodyStyles = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    }
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollPosition}px`
    document.body.style.width = '100%'
    document.documentElement.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeProfile()
    }
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousBodyStyles.overflow
      document.body.style.position = previousBodyStyles.position
      document.body.style.top = previousBodyStyles.top
      document.body.style.width = previousBodyStyles.width
      document.documentElement.style.overflow = previousHtmlOverflow
      window.scrollTo(0, restoreScrollRef.current ? scrollPosition : 0)
    }
  }, [profileOpen])

  function closeProfile(restoreFocus = true) {
    setProfileOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => profileButtonRef.current?.focus())
    }
  }

  function navigateToSettings() {
    restoreScrollRef.current = false
    closeProfile(false)
    onNavigate('settings')
  }

  function signOutFromProfile() {
    restoreScrollRef.current = false
    closeProfile(false)
    onSignOut()
  }

  function startSwipe(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse') return
    swipeStartRef.current = { x: event.clientX, y: event.clientY }
  }

  function finishSwipe(event: ReactPointerEvent<HTMLElement>) {
    const start = swipeStartRef.current
    swipeStartRef.current = undefined
    if (!start) return
    const horizontalDistance = event.clientX - start.x
    const verticalDistance = Math.abs(event.clientY - start.y)
    if (horizontalDistance > 64 && verticalDistance < 80) {
      event.preventDefault()
      closeProfile()
    }
  }

  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-hidden lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
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
              aria-controls="profile-drawer"
              aria-expanded={profileOpen}
              aria-label="Abrir menú de perfil"
              className="avatar"
              ref={profileButtonRef}
              title={user.fullName}
              type="button"
              onClick={() => {
                restoreScrollRef.current = true
                setProfileOpen(true)
              }}
            >
              {initials(user.fullName)}
            </button>
          </div>
        </header>

        <main className="mx-auto min-w-0 w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pb-12">
          {children}
        </main>

        <nav className="mobile-nav lg:hidden" aria-label="Navegación principal">
          {items.map((item) => {
            const Icon = item.icon
            const active = item.id === currentPage
            return (
              <button
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={active ? 'mobile-nav-active' : 'mobile-nav-item'}
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
              >
                <Icon className="size-[22px]" />
                <span>{item.mobileLabel ?? item.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      {profileOpen && (
        <div
          className="profile-overlay fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => closeProfile()}
        >
          <aside
            aria-labelledby="profile-drawer-title"
            aria-modal="true"
            className="profile-drawer"
            id="profile-drawer"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
            onPointerCancel={() => { swipeStartRef.current = undefined }}
            onPointerDown={startSwipe}
            onPointerUp={finishSwipe}
          >
            <div className="flex h-full min-w-0 flex-col">
              <div className="flex justify-end">
                <button
                  aria-label="Cerrar menú de perfil"
                  className="icon-button"
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => closeProfile()}
                >
                  <XIcon className="size-5" />
                </button>
              </div>

              <header className="border-b border-slate-200 pb-6">
                <span className="avatar size-14 text-sm">{initials(user.fullName)}</span>
                <h2 className="mt-4 text-xl font-black text-slate-950" id="profile-drawer-title">
                  {user.fullName}
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">{roleLabel}</p>
                {user.storeName && (
                  <p className="mt-1 text-sm text-slate-500">{user.storeName}</p>
                )}
              </header>

              <nav className="py-5" aria-label="Cuenta y administración">
                <button
                  className="profile-menu-item"
                  type="button"
                  onClick={navigateToSettings}
                >
                  <SettingsIcon className="size-5" />
                  <span className="min-w-0 flex-1 text-left">Ajustes</span>
                  <ArrowIcon className="size-4 text-slate-400" />
                </button>
              </nav>

              <footer className="mt-auto border-t border-slate-200 pt-5">
                <button
                  className="profile-menu-item text-red-700 hover:bg-red-50"
                  type="button"
                  onClick={signOutFromProfile}
                >
                  <LogoutIcon className="size-5" />
                  <span>Cerrar sesión</span>
                </button>
                <p className="mt-6 text-xs font-semibold text-slate-400">
                  La Piedad Operaciones · v{import.meta.env.APP_VERSION}
                </p>
              </footer>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
