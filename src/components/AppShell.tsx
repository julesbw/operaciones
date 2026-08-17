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
  ChevronRightIcon,
  HomeIcon,
  ExportIcon,
  LogoutIcon,
  MenuIcon,
  ReceiptIcon,
  SettingsIcon,
  SyncIcon,
  TransferIcon,
  UsersIcon,
  WifiOffIcon,
  WalletIcon,
  XIcon,
} from './icons'

export type PageId =
  | 'home'
  | 'expenses'
  | 'transfers'
  | 'collaborators'
  | 'closings'
  | 'central-cash'
  | 'exports'
  | 'settings'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

type NavigationItem = {
  id: PageId
  label: string
  icon: IconComponent
  adminOnly?: boolean
  mobilePlacement: 'primary' | 'more'
}

const NAVIGATION: NavigationItem[] = [
  { id: 'home', label: 'Inicio', icon: HomeIcon, mobilePlacement: 'primary' },
  {
    id: 'expenses',
    label: 'Gastos',
    icon: ReceiptIcon,
    mobilePlacement: 'primary',
  },
  {
    id: 'transfers',
    label: 'Transferencias',
    icon: TransferIcon,
    mobilePlacement: 'primary',
  },
  {
    id: 'collaborators',
    label: 'Colaboradores',
    icon: UsersIcon,
    mobilePlacement: 'more',
  },
  {
    id: 'closings',
    label: 'Cortes',
    icon: CashIcon,
    adminOnly: true,
    mobilePlacement: 'more',
  },
  {
    id: 'central-cash',
    label: 'Caja Central',
    icon: WalletIcon,
    adminOnly: true,
    mobilePlacement: 'more',
  },
  {
    id: 'exports',
    label: 'Exportación',
    icon: ExportIcon,
    adminOnly: true,
    mobilePlacement: 'more',
  },
]

export function navigationItemsForRole(
  role: UserProfile['role'],
): NavigationItem[] {
  return NAVIGATION.filter((item) => !item.adminOnly || role === 'admin')
}

type AppShellProps = {
  backendReachable?: boolean
  children: ReactNode
  currentPage: PageId
  networkAvailable: boolean
  pendingCount: number
  syncError?: string
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
  backendReachable,
  children,
  currentPage,
  networkAvailable,
  pendingCount,
  syncError,
  syncing,
  user,
  onNavigate,
  onSignOut,
  onSync,
}: AppShellProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const profileButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const swipeStartRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const restoreScrollRef = useRef(true)
  const items = navigationItemsForRole(user.role)
  const primaryMobileItems = items.filter(
    (item) => item.mobilePlacement === 'primary',
  )
  const moreMobileItems = items.filter(
    (item) => item.mobilePlacement === 'more',
  )
  const moreActive = moreMobileItems.some((item) => item.id === currentPage)
  const moreMenuState = moreMenuOpen ? 'open' : 'closed'
  const roleLabel = user.role === 'admin' ? 'Administrador' : 'Cashier'

  useEffect(() => {
    setMoreMenuOpen(false)
  }, [currentPage])

  useEffect(() => {
    if (!moreMenuOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMoreMenu()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [moreMenuOpen])

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

  function closeMoreMenu(restoreFocus = true) {
    setMoreMenuOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => moreButtonRef.current?.focus())
    }
  }

  function navigateFromMobile(page: PageId) {
    closeMoreMenu(false)
    onNavigate(page)
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
              aria-label={syncError ?? 'Sincronizar datos'}
              className={`sync-pill ${!networkAvailable || backendReachable === false ? 'sync-pill-offline' : ''}`}
              disabled={syncing || !networkAvailable}
              title={syncError}
              type="button"
              onClick={onSync}
            >
              {!networkAvailable || backendReachable === false ? (
                <WifiOffIcon className="size-4" />
              ) : (
                <SyncIcon className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
              )}
              <span className="hidden sm:inline">
                {!networkAvailable
                  ? 'Sin conexión'
                  : backendReachable === false
                    ? 'Error de sincronización'
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
          {primaryMobileItems.map((item) => {
            const Icon = item.icon
            const active = item.id === currentPage
            return (
              <button
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={active ? 'mobile-nav-active' : 'mobile-nav-item'}
                key={item.id}
                type="button"
                onClick={() => navigateFromMobile(item.id)}
              >
                <Icon className="size-[22px]" />
                <span>{item.label}</span>
              </button>
            )
          })}
          <button
            aria-controls="mobile-more-menu"
            aria-current={moreActive ? 'page' : undefined}
            aria-expanded={moreMenuOpen}
            aria-haspopup="menu"
            aria-label="Más"
            className={
              moreActive || moreMenuOpen
                ? 'mobile-nav-active'
                : 'mobile-nav-item'
            }
            ref={moreButtonRef}
            type="button"
            onClick={() => setMoreMenuOpen((open) => !open)}
          >
            <MenuIcon className="size-[22px]" />
            <span>Más</span>
          </button>
        </nav>

        <div
          aria-hidden="true"
          className="mobile-more-backdrop lg:hidden"
          data-state={moreMenuState}
          onClick={() => closeMoreMenu()}
        />
        <div
          aria-label="Más módulos"
          aria-hidden={!moreMenuOpen}
          className="mobile-more-menu lg:hidden"
          data-state={moreMenuState}
          id="mobile-more-menu"
          inert={!moreMenuOpen ? true : undefined}
          role="menu"
        >
          {moreMobileItems.map((item) => {
            const Icon = item.icon
            const active = item.id === currentPage
            return (
              <button
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'mobile-more-menu-item-active'
                    : 'mobile-more-menu-item'
                }
                key={item.id}
                role="menuitem"
                type="button"
                onClick={() => navigateFromMobile(item.id)}
              >
                <Icon className="size-5" />
                <span className="min-w-0 flex-1 text-left">{item.label}</span>
                <ChevronRightIcon className="size-4 text-slate-400" />
              </button>
            )
          })}
        </div>
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
