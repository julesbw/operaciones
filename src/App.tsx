import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell, type PageId } from './components/AppShell'
import {
  ALL_STORES,
  type StoreScopeValue,
} from './components/filters/StoreScopeSelector'
import type { LocalAppContext, Store, UserProfile } from './domain/models'
import { CentralCashPage } from './pages/CentralCashPage'
import { ClosingsPage } from './pages/ClosingsPage'
import { CollaboratorsPage } from './pages/CollaboratorsPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { ExportsPage } from './pages/ExportsPage'
import { LoginPage } from './pages/LoginPage'
import { PurchasesPage } from './pages/PurchasesPage'
import { SettingsPage } from './pages/SettingsPage'
import { TransfersPage } from './pages/TransfersPage'
import { authService } from './services/authService'
import { bootstrapService } from './services/bootstrapService'
import { connectivityService } from './services/connectivityService'
import {
  localContextService,
  profileFromLocalContext,
  UserSwitchBlockedError,
} from './services/localContextService'
import { referenceDataService } from './services/referenceDataService'
import {
  RemoteBootstrapCancelledError,
  remoteBootstrapService,
} from './services/remoteBootstrapService'
import { syncService } from './services/syncService'

type AppBootstrapState =
  | 'loading-local'
  | 'requires-first-login'
  | 'ready-offline'
  | 'ready-online'
  | 'recovering-session'
  | 'fatal-error'

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Error desconocido'
}

function isAuthenticationFailure(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const status = 'status' in cause ? cause.status : undefined
  const message =
    'message' in cause && typeof cause.message === 'string'
      ? cause.message.toLocaleLowerCase('es-MX')
      : ''
  return (
    status === 401 ||
    message.includes('jwt') ||
    message.includes('refresh token') ||
    message.includes('invalid session')
  )
}

function App() {
  const [state, setState] =
    useState<AppBootstrapState>('loading-local')
  const [startupError, setStartupError] = useState<string>()
  const [startupNotice, setStartupNotice] = useState<string>()
  const [localContext, setLocalContext] = useState<LocalAppContext>()
  const [user, setUser] = useState<UserProfile>()
  const userRef = useRef<UserProfile | undefined>(undefined)
  const [page, setPage] = useState<PageId>('home')
  const [attendanceStoreFilter, setAttendanceStoreFilter] =
    useState<StoreScopeValue>(ALL_STORES)
  const [stores, setStores] = useState<Store[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string>()
  const [networkAvailable, setNetworkAvailable] = useState(
    connectivityService.isNetworkAvailable(),
  )
  const [backendReachable, setBackendReachable] = useState<boolean>()
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    userRef.current = user
  }, [user])

  const refreshLocalState = useCallback(async () => {
    const [availableStores, pending] = await Promise.all([
      referenceDataService.listStores(),
      syncService.countPending(),
    ])
    setStores(availableStores)
    setPendingCount(pending)
    setRevision((value) => value + 1)
  }, [])

  const restoreLocalFallback = useCallback(async () => {
    const context = await localContextService.load()
    setLocalContext(context)
    if (context?.accessState === 'enabled') {
      const profile = profileFromLocalContext(context)
      setUser(profile)
      setState('ready-offline')
      return profile
    }

    setUser(undefined)
    setState('requires-first-login')
    return undefined
  }, [])

  const runRemoteBootstrap = useCallback(
    async (profile?: UserProfile, forceRetry = false) => {
      if (!connectivityService.isNetworkAvailable()) {
        setNetworkAvailable(false)
        setBackendReachable(undefined)
        await restoreLocalFallback()
        return
      }

      setNetworkAvailable(true)
      setBackendReachable(undefined)
      setSyncing(true)
      setSyncError(undefined)
      setState('recovering-session')

      try {
        const result = await remoteBootstrapService.process({
          forceRetry,
          profile,
          onIdentityResolved: (remoteUserId) => {
            setUser((current) =>
              remoteUserId && current?.id === remoteUserId
                ? current
                : undefined,
            )
          },
        })

        if (result.status === 'requires-login') {
          const context = await localContextService.load()
          setLocalContext(context)
          setUser(undefined)
          setBackendReachable(true)
          setStartupNotice(
            context
              ? 'Tu sesión necesita validarse nuevamente. Los cambios pendientes siguen guardados en este dispositivo.'
              : undefined,
          )
          setState('requires-first-login')
          return
        }

        setLocalContext(result.context)
        setUser(result.profile)
        setBackendReachable(true)
        setStartupNotice(undefined)
        setSyncError(
          result.sync.failed > 0
            ? result.sync.errors?.join(' · ') ||
              `${result.sync.failed} cambio${result.sync.failed === 1 ? '' : 's'} no se pudo sincronizar.`
            : undefined,
        )
        await refreshLocalState()
        setState(
          connectivityService.isNetworkAvailable()
            ? 'ready-online'
            : 'ready-offline',
        )
      } catch (cause: unknown) {
        if (cause instanceof RemoteBootstrapCancelledError) return

        console.error('No fue posible completar el arranque remoto', cause)

        if (cause instanceof UserSwitchBlockedError) {
          try {
            await authService.signOut()
          } catch (signOutCause: unknown) {
            console.error(
              'No fue posible cerrar la sesión que no corresponde al contexto local',
              signOutCause,
            )
          }
          setBackendReachable(true)
          setStartupNotice(cause.message)
          setSyncError(cause.message)
          await restoreLocalFallback()
          return
        }

        if (isAuthenticationFailure(cause)) {
          await localContextService.setAccessState(
            'reauthentication-required',
          )
          setUser(undefined)
          setBackendReachable(true)
          setStartupNotice(
            'La sesión expiró. Inicia sesión nuevamente; tus cambios locales no se eliminaron.',
          )
          setState('requires-first-login')
          return
        }

        setBackendReachable(false)
        setSyncError(
          'No fue posible contactar a Supabase. Se conservaron los datos locales.',
        )
        setStartupNotice(
          'Supabase no respondió. Puedes reintentar cuando tengas conexión.',
        )
        await restoreLocalFallback()
      } finally {
        setSyncing(false)
      }
    },
    [refreshLocalState, restoreLocalFallback],
  )

  useEffect(() => {
    let active = true

    async function initializeApplication() {
      let context: LocalAppContext | undefined
      try {
        context = await bootstrapService.initializeLocal()
        await refreshLocalState()
      } catch (cause: unknown) {
        console.error('No fue posible preparar el almacenamiento local', cause)
        if (active) {
          setStartupError(errorMessage(cause))
          setState('fatal-error')
        }
        return
      }

      if (!active) return
      setLocalContext(context)
      if (context?.accessState === 'enabled') {
        setUser(profileFromLocalContext(context))
        setState(
          connectivityService.isNetworkAvailable()
            ? 'recovering-session'
            : 'ready-offline',
        )
      } else {
        setUser(undefined)
        setState('requires-first-login')
      }

      if (connectivityService.isNetworkAvailable()) {
        void runRemoteBootstrap()
      }
    }

    void initializeApplication()
    return () => {
      active = false
    }
  }, [refreshLocalState, runRemoteBootstrap])

  useEffect(() => {
    return connectivityService.subscribe((available) => {
      setNetworkAvailable(available)
      if (available) {
        void runRemoteBootstrap()
        return
      }

      setBackendReachable(undefined)
      setSyncing(false)
      setState(
        userRef.current ? 'ready-offline' : 'requires-first-login',
      )
    })
  }, [runRemoteBootstrap])

  async function signedIn(profile: UserProfile) {
    setAttendanceStoreFilter(ALL_STORES)
    setStartupNotice(undefined)
    await runRemoteBootstrap(profile)
  }

  async function signOut() {
    const remoteStopped = remoteBootstrapService.cancelForSignOut()
    setUser(undefined)
    setPage('home')
    setAttendanceStoreFilter(ALL_STORES)
    setState('requires-first-login')
    const [, remoteSignOut] = await Promise.allSettled([
      localContextService.setAccessState('signed-out'),
      authService.signOut(),
      remoteStopped,
    ])
    await localContextService.setAccessState('signed-out')
    setLocalContext(await localContextService.load())
    if (remoteSignOut.status === 'rejected') {
      console.error(
        'No fue posible cerrar la sesión remota',
        remoteSignOut.reason,
      )
      setStartupNotice(
        'La sesión local se cerró. La sesión remota se validará al volver a conectarte.',
      )
    }
  }

  function navigate(nextPage: PageId) {
    if (
      (nextPage === 'closings' ||
        nextPage === 'central-cash' ||
        nextPage === 'purchases' ||
        nextPage === 'exports') &&
      user?.role !== 'admin'
    ) {
      setPage('home')
      return
    }
    setPage(nextPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (state === 'loading-local' || state === 'fatal-error') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-6">
        <div className="text-center">
          <img
            alt="La Piedad Operaciones"
            className="mx-auto size-24 animate-pulse rounded-full border border-slate-200 object-cover shadow-lg"
            src="/la-piedad-operaciones-ui.png"
          />
          <p className="brand-display mt-4 text-2xl font-bold text-slate-950">La Piedad</p>
          <p className="brand-kicker mt-1">Operaciones</p>
          <p className={`mt-5 text-sm font-semibold ${state === 'fatal-error' ? 'text-red-700' : 'text-slate-500'}`}>
            {state === 'fatal-error' ? 'No fue posible abrir los datos locales.' : 'Preparando Operaciones…'}
          </p>
          {state === 'fatal-error' && startupError && (
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">
              {startupError}
            </p>
          )}
          {state === 'fatal-error' && (
            <button
              className="button-secondary mt-5"
              type="button"
              onClick={() => window.location.reload()}
            >
              Reintentar
            </button>
          )}
        </div>
      </main>
    )
  }

  if (!user) {
    if (!networkAvailable) {
      const wasInitialized = Boolean(localContext)
      return (
        <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-6">
          <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
            <img
              alt="La Piedad Operaciones"
              className="mx-auto size-24 rounded-full border border-slate-200 object-cover shadow-lg"
              src="/la-piedad-operaciones-ui.png"
            />
            <p className="brand-kicker mt-5">Sin conexión</p>
            <h1 className="brand-display mt-3 text-3xl font-bold text-slate-950">
              {wasInitialized
                ? 'Necesitas iniciar sesión nuevamente'
                : 'Configura este dispositivo primero'}
            </h1>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              {wasInitialized
                ? 'Los datos y cambios pendientes siguen guardados. Conéctate e inicia sesión con la cuenta correspondiente para continuar.'
                : 'Este dispositivo todavía no ha sido configurado para trabajar sin conexión. Conéctate a internet e inicia sesión una vez.'}
            </p>
            <button
              className="button-secondary mt-6"
              type="button"
              onClick={() => void runRemoteBootstrap()}
            >
              Reintentar
            </button>
          </section>
        </main>
      )
    }

    return (
      <LoginPage
        notice={startupNotice}
        onSignedIn={(profile) => void signedIn(profile)}
      />
    )
  }

  return (
    <AppShell
      backendReachable={backendReachable}
      currentPage={page}
      networkAvailable={networkAvailable}
      pendingCount={pendingCount}
      syncError={syncError}
      syncing={syncing || state === 'recovering-session'}
      user={user}
      onNavigate={navigate}
      onSignOut={() => void signOut()}
      onSync={() => void runRemoteBootstrap(undefined, true)}
    >
      {page === 'home' && (
        <DashboardPage pendingCount={pendingCount} revision={revision} stores={stores} user={user} onNavigate={navigate} />
      )}
      {page === 'expenses' && (
        <ExpensesPage stores={stores} user={user} onDataChanged={() => void refreshLocalState()} />
      )}
      {page === 'transfers' && (
        <TransfersPage stores={stores} user={user} onDataChanged={() => void refreshLocalState()} />
      )}
      {page === 'collaborators' && (
        <CollaboratorsPage
          attendanceStoreFilter={attendanceStoreFilter}
          stores={stores}
          user={user}
          onDataChanged={() => void refreshLocalState()}
          onAttendanceStoreFilterChange={setAttendanceStoreFilter}
        />
      )}
      {page === 'purchases' && user.role === 'admin' && (
        <PurchasesPage
          networkAvailable={networkAvailable}
          stores={stores}
          user={user}
          onDataChanged={() => void refreshLocalState()}
        />
      )}
      {page === 'closings' && user.role === 'admin' && <ClosingsPage stores={stores} user={user} />}
      {page === 'central-cash' && user.role === 'admin' && (
        <CentralCashPage
          networkAvailable={networkAvailable}
          stores={stores}
          user={user}
        />
      )}
      {page === 'exports' && user.role === 'admin' && (
        <ExportsPage
          networkAvailable={networkAvailable}
          stores={stores}
          user={user}
        />
      )}
      {page === 'settings' && (
        <SettingsPage stores={stores} user={user} onStoresChanged={() => void refreshLocalState()} />
      )}
    </AppShell>
  )
}

export default App
