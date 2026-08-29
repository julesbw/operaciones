import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SVGProps,
  type TouchEvent as ReactTouchEvent,
} from 'react'
import {
  hasCapability,
  roleHasCapability,
  type AppCapability,
  type EffectiveRole,
  type PageId,
} from '../domain/capabilities'
import type { OperatorSession, UserProfile } from '../domain/models'
import { getEffectiveDisplayName } from '../domain/runtimeIdentity'
import {
  toUserFacingSyncError,
  type SyncInspectorSnapshot,
} from '../services/syncInspectorService'
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
import {
  NotificationCenter,
  type NotificationNavigation,
} from './NotificationCenter'
import { SyncInspectorModal } from './SyncInspectorModal'

export type { PageId } from '../domain/capabilities'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

type NavigationItem = {
  id: PageId
  label: string
  icon: IconComponent
  capability: AppCapability
  mobilePlacement: 'primary' | 'more'
}

const NAVIGATION: NavigationItem[] = [
  { id: 'home', label: 'Inicio', icon: HomeIcon, capability: 'home', mobilePlacement: 'primary' },
  {
    id: 'expenses',
    label: 'Gastos',
    icon: ReceiptIcon,
    capability: 'expenses',
    mobilePlacement: 'primary',
  },
  {
    id: 'transfers',
    label: 'Transferencias',
    icon: TransferIcon,
    capability: 'transfers',
    mobilePlacement: 'primary',
  },
  {
    id: 'collaborators',
    label: 'Colaboradores',
    icon: UsersIcon,
    capability: 'attendance',
    mobilePlacement: 'more',
  },
  {
    id: 'purchases',
    label: 'Compras',
    icon: ReceiptIcon,
    capability: 'purchases',
    mobilePlacement: 'more',
  },
  {
    id: 'closings',
    label: 'Cortes',
    icon: CashIcon,
    capability: 'cashClosings',
    mobilePlacement: 'more',
  },
  {
    id: 'central-cash',
    label: 'Caja Central',
    icon: WalletIcon,
    capability: 'centralCash',
    mobilePlacement: 'more',
  },
  {
    id: 'exports',
    label: 'Exportación',
    icon: ExportIcon,
    capability: 'exports',
    mobilePlacement: 'more',
  },
]

export function navigationItemsForRole(
  role: EffectiveRole,
): NavigationItem[] {
  return NAVIGATION.filter((item) => roleHasCapability(role, item.capability))
}

type AppShellProps = {
  operatorSession?: OperatorSession
  backendReachable?: boolean
  children: ReactNode
  currentPage: PageId
  networkAvailable: boolean
  pendingCount: number
  sessionRequired?: boolean
  syncError?: string
  syncing: boolean
  user: UserProfile
  onNavigate: (page: PageId) => void
  onSignOut: () => void
  onSwitchOperator?: () => void
  onSync: () => void
  onOpenSyncInspector?: () => void
  onRefreshSyncInspector?: () => void
  syncInspector?: SyncInspectorSnapshot
  syncInspectorError?: string
  syncInspectorLoading?: boolean
  notificationRefreshKey?: number
  onOpenNotification?: (navigation: NotificationNavigation) => void
}

const EMPTY_SYNC_INSPECTOR: SyncInspectorSnapshot = {
  items: [],
  summary: { total: 0, pending: 0, syncing: 0, error: 0 },
}

const PULL_TO_SYNC_THRESHOLD = 72
const PULL_TO_SYNC_MAX = 112

function isPwa(): boolean {
  if (typeof window === 'undefined') return false
  const isStandaloneDisplay =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches)
  const isIosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return isStandaloneDisplay || isIosStandalone
}

function isAtTop(): boolean {
  return (
    (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0
  )
}

export function shouldTriggerPullToSync(
  distance: number,
  syncing: boolean,
  networkAvailable: boolean,
): boolean {
  return (
    distance >= PULL_TO_SYNC_THRESHOLD &&
    !syncing &&
    networkAvailable
  )
}

function syncIndicatorLabel(
  pendingCount: number,
  errorCount: number,
  waitingCount: number,
): string {
  if (pendingCount === 0) return 'Al día'
  if (errorCount === 0) {
    return `${pendingCount} pendiente${pendingCount === 1 ? '' : 's'}`
  }
  return `${waitingCount} pendiente${waitingCount === 1 ? '' : 's'} · ${errorCount} con error`
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
  operatorSession,
  backendReachable,
  children,
  currentPage,
  networkAvailable,
  pendingCount,
  sessionRequired = false,
  syncError,
  syncing,
  user,
  onNavigate,
  onSignOut,
  onSwitchOperator,
  onSync,
  onOpenSyncInspector,
  onRefreshSyncInspector,
  syncInspector = EMPTY_SYNC_INSPECTOR,
  syncInspectorError,
  syncInspectorLoading = false,
  notificationRefreshKey = 0,
  onOpenNotification,
}: AppShellProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [syncInspectorOpen, setSyncInspectorOpen] = useState(false)
  const profileButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const syncButtonRef = useRef<HTMLButtonElement>(null)
  const swipeStartRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const pullStartRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const pullDistanceRef = useRef(0)
  const pullFrameRef = useRef<number | undefined>(undefined)
  const pendingPullDistanceRef = useRef<number | undefined>(undefined)
  const restoreScrollRef = useRef(true)
  const [pullDistance, setPullDistance] = useState(0)
  const [pullReady, setPullReady] = useState(false)
  const identity = { technicalUser: user, operatorSession }
  const items = NAVIGATION.filter((item) =>
    hasCapability(identity, item.capability),
  )
  const primaryMobileItems = items.filter(
    (item) => item.mobilePlacement === 'primary',
  )
  const moreMobileItems = items.filter(
    (item) => item.mobilePlacement === 'more',
  )
  const moreActive = moreMobileItems.some((item) => item.id === currentPage)
  const moreMenuState = moreMenuOpen ? 'open' : 'closed'
  const effectiveRole = user.role === 'admin'
    ? 'admin'
    : operatorSession?.account.role ?? 'cashier'
  const roleLabel = effectiveRole === 'admin'
    ? 'Administrador'
    : effectiveRole === 'store_manager'
      ? 'Encargado'
      : 'Cajero'
  const activeName = getEffectiveDisplayName(user, operatorSession ?? null)
  const waitingSyncCount = syncInspector.summary.pending + syncInspector.summary.syncing
  const syncLabel =
    !networkAvailable
      ? 'Sin conexión'
      : syncing
        ? 'Sincronizando…'
        : sessionRequired
          ? 'Sesión requerida'
        : pendingCount > 0
          ? syncIndicatorLabel(pendingCount, syncInspector.summary.error, waitingSyncCount)
          : backendReachable === false || syncError
            ? 'Error de sincronización'
            : 'Sincronizado'
  const syncTitle =
    toUserFacingSyncError(syncError) ?? syncLabel
  const pullProgress = Math.min(1, pullDistance / PULL_TO_SYNC_THRESHOLD)

  useEffect(() => {
    setMoreMenuOpen(false)
  }, [currentPage])

  useEffect(() => {
    return () => {
      if (pullFrameRef.current !== undefined) {
        window.cancelAnimationFrame(pullFrameRef.current)
      }
    }
  }, [])

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

  function switchOperatorFromProfile() {
    restoreScrollRef.current = false
    closeProfile(false)
    onSwitchOperator?.()
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

  function cancelPullFrame() {
    if (pullFrameRef.current !== undefined) {
      window.cancelAnimationFrame(pullFrameRef.current)
      pullFrameRef.current = undefined
    }
    pendingPullDistanceRef.current = undefined
  }

  function resetPull() {
    cancelPullFrame()
    pullStartRef.current = undefined
    pullDistanceRef.current = 0
    setPullDistance(0)
    setPullReady(false)
  }

  function schedulePullUpdate(distance: number) {
    pendingPullDistanceRef.current = distance
    if (pullFrameRef.current !== undefined) return

    pullFrameRef.current = window.requestAnimationFrame(() => {
      pullFrameRef.current = undefined
      const nextDistance = pendingPullDistanceRef.current
      pendingPullDistanceRef.current = undefined
      if (nextDistance === undefined) return
      setPullDistance(nextDistance)
      setPullReady(nextDistance >= PULL_TO_SYNC_THRESHOLD)
    })
  }

  function startPull(event: ReactTouchEvent<HTMLElement>) {
    if (
      !isPwa() ||
      syncing ||
      !networkAvailable ||
      !isAtTop() ||
      pullStartRef.current
    ) {
      return
    }
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button, a, input, select, textarea, [role="button"]')
    ) {
      return
    }
    const touch = event.touches[0]
    if (!touch) return
    pullStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  function movePull(event: ReactTouchEvent<HTMLElement>) {
    const start = pullStartRef.current
    const touch = event.touches[0]
    if (!start || !touch || !isAtTop()) return

    const distanceY = touch.clientY - start.y
    const distanceX = Math.abs(touch.clientX - start.x)
    if (distanceY <= 0 || distanceX > distanceY) {
      resetPull()
      return
    }

    const distance = Math.min(PULL_TO_SYNC_MAX, distanceY)
    pullDistanceRef.current = distance
    schedulePullUpdate(distance)
  }

  function finishPull() {
    const distance = pullDistanceRef.current
    const shouldSync = shouldTriggerPullToSync(
      distance,
      syncing,
      networkAvailable,
    )
    resetPull()
    if (shouldSync) onSync()
  }

  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-clip lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
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
            <NotificationCenter
              activePage={currentPage}
              enabled={user.role === 'admin'}
              networkAvailable={networkAvailable}
              onOpenEntity={onOpenNotification ?? (() => undefined)}
              refreshKey={notificationRefreshKey}
            />
            <button
              aria-label="Abrir detalle de sincronización"
              className={`sync-pill ${!networkAvailable || backendReachable === false ? 'sync-pill-offline' : ''}`}
              ref={syncButtonRef}
              aria-busy={syncing}
              title={syncTitle}
              type="button"
              onClick={() => {
                setSyncInspectorOpen(true)
                onOpenSyncInspector?.()
              }}
            >
              {!networkAvailable || backendReachable === false ? (
                <WifiOffIcon className="size-4" />
              ) : (
                <SyncIcon className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
              )}
              <span className="hidden sm:inline">
                {syncLabel}
              </span>
              {pendingCount > 0 && <span className="sm:hidden">{pendingCount}</span>}
            </button>
            <button
              aria-controls="profile-drawer"
              aria-expanded={profileOpen}
              aria-label="Abrir menú de perfil"
              className="avatar"
              ref={profileButtonRef}
              title={activeName}
              type="button"
              onClick={() => {
                restoreScrollRef.current = true
                setProfileOpen(true)
              }}
            >
              {initials(activeName)}
            </button>
          </div>
        </header>

        <main
          className="mx-auto min-w-0 w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pb-12"
          onTouchCancel={resetPull}
          onTouchEnd={finishPull}
          onTouchMove={movePull}
          onTouchStart={startPull}
        >
          {(pullDistance > 0 || syncing) && (
            <div
              aria-live="polite"
              className="pull-sync-indicator lg:hidden"
              data-pulling={!syncing && pullDistance > 0}
              data-ready={pullReady}
              data-syncing={syncing}
              style={{
                height: `${syncing ? 48 : pullDistance}px`,
                '--pull-progress-opacity': `${0.6 + pullProgress * 0.4}`,
                '--pull-progress-offset': `${(1 - pullProgress) * -4}px`,
                '--pull-progress-scale': `${0.96 + pullProgress * 0.04}`,
              } as CSSProperties}
            >
              <div className="pull-sync-indicator-content">
                <SyncIcon
                  className={`pull-sync-indicator-icon size-4 ${syncing ? 'animate-spin' : ''}`}
                />
                <span>
                  {syncing
                    ? 'Sincronizando…'
                    : pullReady
                      ? 'Suelta para sincronizar'
                      : 'Jala para sincronizar'}
                </span>
              </div>
            </div>
          )}
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

      <SyncInspectorModal
        error={syncInspectorError}
        loading={syncInspectorLoading}
        networkAvailable={networkAvailable}
        onClose={() => setSyncInspectorOpen(false)}
        onRefresh={onRefreshSyncInspector ?? (() => undefined)}
        onSync={onSync}
        open={syncInspectorOpen}
        operatorSession={operatorSession}
        returnFocusRef={syncButtonRef}
        snapshot={syncInspector}
        syncing={syncing}
        user={user}
      />

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
                <span className="avatar size-14 text-sm">{initials(activeName)}</span>
                <h2 className="mt-4 text-xl font-black text-slate-950" id="profile-drawer-title">
                  {activeName}
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {operatorSession ? 'Operador activo' : roleLabel}
                </p>
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
                {onSwitchOperator && (
                  <button
                    className="profile-menu-item"
                    disabled={!networkAvailable}
                    type="button"
                    onClick={switchOperatorFromProfile}
                  >
                    <ArrowIcon className="size-5" />
                    <span>Cambiar usuario</span>
                  </button>
                )}
                <button
                  className="profile-menu-item text-red-700 hover:bg-red-50"
                  type="button"
                  onClick={signOutFromProfile}
                >
                  <LogoutIcon className="size-5" />
                  <span>{operatorSession ? 'Cerrar sesión del dispositivo' : 'Cerrar sesión'}</span>
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
