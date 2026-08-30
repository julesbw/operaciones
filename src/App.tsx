import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell, type PageId } from './components/AppShell'
import { canAccessPage, hasCapability } from './domain/capabilities'
import {
  ALL_STORES,
  type StoreScopeValue,
} from './components/filters/StoreScopeSelector'
import type {
  LocalAppContext,
  OperatorSession,
  Store,
  UserProfile,
} from './domain/models'
import { CentralCashPage } from './pages/CentralCashPage'
import { ClosingsPage } from './pages/ClosingsPage'
import { CollaboratorsPage } from './pages/CollaboratorsPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { ExportsPage } from './pages/ExportsPage'
import { LoginPage } from './pages/LoginPage'
import { OperatorLoginPage } from './pages/OperatorLoginPage'
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
import { operatorSessionService } from './services/operatorSessionService'
import { OperatorAuthorizationError } from './services/operatorAuthorization'
import { operationsRepository } from './repositories/operationsRepository'
import {
  RemoteBootstrapCancelledError,
  remoteBootstrapService,
} from './services/remoteBootstrapService'
import {
  isSyncAuthenticationFailure,
} from './services/syncService'
import {
  syncInspectorService,
  type SyncInspectorSnapshot,
} from './services/syncInspectorService'
import { notificationService } from './services/notificationService'
import type { NotificationNavigation } from './services/pushNotificationNavigation'
import {
  clearNotificationQuery,
  navigationFromLocation,
  navigationFromWorkerMessage,
} from './services/pushNotificationNavigation'

type AppBootstrapState =
  | 'loading-local'
  | 'requires-first-login'
  | 'ready-offline'
  | 'ready-online'
  | 'recovering-session'
  | 'awaiting-operator'
  | 'validating-operator'
  | 'fatal-error'

const EMPTY_SYNC_INSPECTOR: SyncInspectorSnapshot = {
  items: [],
  summary: { total: 0, pending: 0, syncing: 0, error: 0 },
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Error desconocido'
}

async function clearOperatorSession(): Promise<void> {
  try {
    await operatorSessionService.logout()
  } catch (cause: unknown) {
    console.error('No fue posible revocar la sesión operativa inválida', cause)
  }
}

async function clearTechnicalSession(): Promise<void> {
  const results = await Promise.allSettled([
    clearOperatorSession(),
    authService.signOut(),
    localContextService.setAccessState('reauthentication-required'),
  ])
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('No fue posible limpiar el estado de sesión inválido', result.reason)
    }
  }
}

function App() {
  const [state, setState] =
    useState<AppBootstrapState>('loading-local')
  const [startupError, setStartupError] = useState<string>()
  const [startupNotice, setStartupNotice] = useState<string>()
  const [localContext, setLocalContext] = useState<LocalAppContext>()
  const [user, setUser] = useState<UserProfile>()
  const [operatorSession, setOperatorSession] = useState<OperatorSession>()
  const userRef = useRef<UserProfile | undefined>(undefined)
  const [page, setPage] = useState<PageId>('home')
  const [notificationTarget, setNotificationTarget] = useState<NotificationNavigation | undefined>(
    () =>
      typeof window === 'undefined'
        ? undefined
        : navigationFromLocation(window.location),
  )
  const notificationNavigationRef = useRef<
    (target: NotificationNavigation) => void
  >(() => undefined)
  const handledNotificationKeyRef = useRef<string | undefined>(undefined)
  const [pendingPushReadId, setPendingPushReadId] = useState<string>()
  const [attendanceStoreFilter, setAttendanceStoreFilter] =
    useState<StoreScopeValue>(ALL_STORES)
  const [stores, setStores] = useState<Store[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [syncInspector, setSyncInspector] =
    useState<SyncInspectorSnapshot>(EMPTY_SYNC_INSPECTOR)
  const [syncInspectorLoading, setSyncInspectorLoading] = useState(false)
  const [syncInspectorLoadError, setSyncInspectorLoadError] = useState<string>()
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

  useEffect(() => {
    if (typeof window !== 'undefined' && navigationFromLocation(window.location)) {
      clearNotificationQuery()
    }
  }, [])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }
    const onServiceWorkerMessage = (event: MessageEvent<unknown>) => {
      const target = navigationFromWorkerMessage(event.data)
      if (!target) return
      clearNotificationQuery()
      notificationNavigationRef.current(target)
    }
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage)
    return () => {
      navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage)
    }
  }, [])

  const refreshLocalState = useCallback(async () => {
    const [availableStores, inspector] = await Promise.all([
      referenceDataService.listStores(),
      syncInspectorService.getSnapshot(),
    ])
    setStores(availableStores)
    setSyncInspector(inspector)
    setPendingCount(inspector.summary.total)
    setRevision((value) => value + 1)
  }, [])

  const refreshSyncInspector = useCallback(async () => {
    setSyncInspectorLoading(true)
    setSyncInspectorLoadError(undefined)
    try {
      const inspector = await syncInspectorService.getSnapshot()
      setSyncInspector(inspector)
      setPendingCount(inspector.summary.total)
    } catch (cause: unknown) {
      console.error('No fue posible cargar el detalle de sincronización', cause)
      setSyncInspectorLoadError(
        'No fue posible cargar el detalle de sincronización.',
      )
    } finally {
      setSyncInspectorLoading(false)
    }
  }, [])

  const openSyncInspector = useCallback(() => {
    void refreshSyncInspector()
  }, [refreshSyncInspector])

  const restoreLocalFallback = useCallback(async () => {
    const context = await localContextService.load()
    setLocalContext(context)
    if (context?.accessState === 'enabled') {
      const profile = profileFromLocalContext(context)
      setUser(profile)
      const storedOperator = profile.role === 'admin'
        ? undefined
        : operatorSessionService.restoreOffline(profile.id)
      setOperatorSession(storedOperator)
      setState(profile.role === 'admin' || storedOperator ? 'ready-offline' : 'awaiting-operator')
      return profile
    }

    setUser(undefined)
    setOperatorSession(undefined)
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
          await clearTechnicalSession()
          const context = await localContextService.load()
          setLocalContext(context)
          setUser(undefined)
          setOperatorSession(undefined)
          setBackendReachable(true)
          setStartupNotice(
            context
              ? 'Tu sesión necesita validarse nuevamente. Los cambios pendientes siguen guardados en este dispositivo.'
              : undefined,
          )
          await refreshLocalState()
          setState('requires-first-login')
          return
        }

        if (result.status === 'requires-operator-login') {
          setLocalContext(result.context)
          setUser(result.profile)
          setOperatorSession(undefined)
          setBackendReachable(true)
          setStartupNotice('Inicia sesión como operador para sincronizar.')
          setSyncError(undefined)
          await refreshLocalState()
          setState('awaiting-operator')
          return
        }

        setLocalContext(result.context)
        setUser(result.profile)
        setOperatorSession(result.operatorSession)
        setBackendReachable(true)
        setStartupNotice(undefined)
        const sync = result.sync
        setSyncError(
          sync.failed > 0
            ? sync.errors?.join(' · ') ||
              `${sync.failed} cambio${sync.failed === 1 ? '' : 's'} no se pudo sincronizar.`
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

        if (cause instanceof OperatorAuthorizationError) {
          await clearOperatorSession()
          setOperatorSession(undefined)
          setBackendReachable(true)
          setStartupNotice(cause.message)
          setSyncError(cause.message)
          setState('awaiting-operator')
          await refreshLocalState()
          return
        }

        if (isSyncAuthenticationFailure(cause)) {
          await clearTechnicalSession()
          const context = await localContextService.load()
          setLocalContext(context)
          setUser(undefined)
          setOperatorSession(undefined)
          setBackendReachable(true)
          setStartupNotice(
            'La sesión expiró. Inicia sesión nuevamente; tus cambios locales no se eliminaron.',
          )
          await refreshLocalState()
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
        await refreshLocalState()
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
        const profile = profileFromLocalContext(context)
        const storedOperator = profile.role === 'admin'
          ? undefined
          : operatorSessionService.restoreOffline(profile.id)
        setUser(profile)
        setOperatorSession(storedOperator)
        setState(
          connectivityService.isNetworkAvailable()
            ? 'recovering-session'
            : profile.role === 'admin' || storedOperator
              ? 'ready-offline'
              : 'awaiting-operator',
        )
      } else {
        setUser(undefined)
        setOperatorSession(undefined)
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
      const profile = userRef.current
      const storedOperator = profile?.role === 'admin'
        ? undefined
        : profile
          ? operatorSessionService.restoreOffline(profile.id)
          : undefined
      setOperatorSession(storedOperator)
      setState(profile ? profile.role === 'admin' || storedOperator ? 'ready-offline' : 'awaiting-operator' : 'requires-first-login')
    })
  }, [runRemoteBootstrap])

  async function signedIn(profile: UserProfile) {
    setAttendanceStoreFilter(ALL_STORES)
    setStartupNotice(undefined)
    await runRemoteBootstrap(profile)
  }

  async function operatorSignedIn() {
    if (!user) return
    try {
      const validatedOperator = await operatorSessionService.validate(user.id)
      if (!validatedOperator) {
        setOperatorSession(undefined)
        setState('awaiting-operator')
        return
      }
      if (
        await operationsRepository.hasPendingWorkForAnotherOperator(
          validatedOperator.account.id,
        )
      ) {
        await operatorSessionService.logout()
        setOperatorSession(undefined)
        setStartupNotice(
          'Hay operaciones pendientes de otro usuario. Ese usuario debe iniciar sesión y sincronizarlas antes de cambiar.',
        )
        setState('awaiting-operator')
        return
      }
      setOperatorSession(validatedOperator)
      setState('ready-online')
      await runRemoteBootstrap(user, true)
    } catch (cause: unknown) {
      setOperatorSession(undefined)
      setStartupNotice(errorMessage(cause))
      setState('awaiting-operator')
    }
  }

  async function syncCurrentSession(forceRetry = false) {
    if (!user) return
    if (!connectivityService.isNetworkAvailable()) return
    if (syncing) return
    await runRemoteBootstrap(user, forceRetry)
  }

  async function switchOperator() {
    if (!user || !operatorSession) return
    if (!connectivityService.isNetworkAvailable()) {
      setStartupNotice('Cambiar usuario requiere conexión.')
      return
    }
    if (await operationsRepository.hasPendingWorkForOperator(operatorSession.account.id)) {
      setStartupNotice(
        'Hay operaciones pendientes de sincronizar. Sincronízalas antes de cambiar de usuario.',
      )
      return
    }
    await operatorSessionService.logout()
    setOperatorSession(undefined)
    setPage('home')
    setState('awaiting-operator')
  }

  async function signOut() {
    if (
      operatorSession &&
      !window.confirm('Se cerrará la sesión del dispositivo. ¿Deseas continuar?')
    ) {
      return
    }
    const remoteStopped = remoteBootstrapService.cancelForSignOut()
    setUser(undefined)
    setOperatorSession(undefined)
    setStartupNotice(undefined)
    setPage('home')
    setNotificationTarget(undefined)
    handledNotificationKeyRef.current = undefined
    setPendingPushReadId(undefined)
    setAttendanceStoreFilter(ALL_STORES)
    setState('requires-first-login')
    const [, remoteSignOut] = await Promise.allSettled([
      localContextService.setAccessState('signed-out'),
      authService.signOut(),
      remoteStopped,
      operatorSessionService.logout(),
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
    setNotificationTarget(undefined)
    if (
      !user ||
      !canAccessPage(
        { technicalUser: user, operatorSession },
        nextPage,
      )
    ) {
      setPage('home')
      return
    }
    setPage(nextPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function navigateFromNotification(target: NotificationNavigation) {
    if (!user) {
      setNotificationTarget(target)
      return
    }
    const nextPage: PageId = target.entityType === 'purchase'
      ? 'purchases'
      : target.entityType === 'merchandise_transfer'
        ? 'transfers'
        : 'closings'
    if (!canAccessPage({ technicalUser: user, operatorSession }, nextPage)) {
      return
    }
    const targetKey = `${target.notificationId}:${target.entityType}:${target.entityId}`
    const alreadyHandled = handledNotificationKeyRef.current === targetKey
    handledNotificationKeyRef.current = targetKey
    setNotificationTarget(target)
    setPage(nextPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (
      !alreadyHandled &&
      target.source === 'push' &&
      user.role === 'admin' &&
      networkAvailable
    ) {
      void notificationService.markRead(target.notificationId).catch((cause: unknown) => {
        console.error(
          'No fue posible marcar la notificación Push como leída',
          cause,
        )
      })
    } else if (
      target.source === 'push' &&
      user.role === 'admin' &&
      !networkAvailable
    ) {
      setPendingPushReadId(target.notificationId)
    }
  }

  notificationNavigationRef.current = navigateFromNotification

  useEffect(() => {
    if (!user || !notificationTarget) return
    navigateFromNotification(notificationTarget)
  }, [user?.id, notificationTarget])

  useEffect(() => {
    if (
      !pendingPushReadId ||
      !networkAvailable ||
      !user ||
      user.role !== 'admin'
    ) {
      return
    }
    const notificationId = pendingPushReadId
    setPendingPushReadId(undefined)
    void notificationService.markRead(notificationId).catch((cause: unknown) => {
      console.error(
        'No fue posible marcar la notificación Push pendiente como leída',
        cause,
      )
    })
  }, [networkAvailable, pendingPushReadId, user?.id, user?.role])

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

  if (user.role !== 'admin' && !operatorSession) {
    if (state === 'recovering-session' || state === 'validating-operator') {
      return (
        <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-6">
          <p className="text-sm font-semibold text-slate-500">Validando sesión de operador…</p>
        </main>
      )
    }
    return (
      <OperatorLoginPage
        networkAvailable={networkAvailable}
        notice={startupNotice}
        store={stores.find((store) => store.id === user.storeId)}
        technicalUserId={user.id}
        onSignedIn={() => operatorSignedIn()}
        onSignOut={() => void signOut()}
      />
    )
  }

  return (
    <AppShell
      operatorSession={operatorSession}
      backendReachable={backendReachable}
      currentPage={page}
      networkAvailable={networkAvailable}
      notificationRefreshKey={revision}
      pendingCount={pendingCount}
      sessionRequired={state === 'awaiting-operator'}
      syncError={syncError}
      syncInspector={syncInspector}
      syncInspectorError={syncInspectorLoadError}
      syncInspectorLoading={syncInspectorLoading}
      syncing={syncing || state === 'recovering-session'}
      user={user}
      onNavigate={navigate}
      onOpenNotification={navigateFromNotification}
      onOpenSyncInspector={openSyncInspector}
      onRefreshSyncInspector={() => void refreshSyncInspector()}
      onSignOut={() => void signOut()}
      onSwitchOperator={operatorSession ? () => void switchOperator() : undefined}
      onSync={() => void syncCurrentSession(true)}
    >
      {page === 'home' && (
        <DashboardPage
          operatorSession={operatorSession}
          pendingCount={pendingCount}
          revision={revision}
          stores={stores}
          user={user}
          onNavigate={navigate}
        />
      )}
      {page === 'expenses' && (
        <ExpensesPage
          dataRevision={revision}
          networkAvailable={networkAvailable}
          operatorAccountId={operatorSession?.account.id ?? null}
          operatorSession={operatorSession}
          stores={stores}
          user={user}
          onDataChanged={() => void refreshLocalState()}
          onSync={() => syncCurrentSession()}
        />
      )}
      {page === 'transfers' && (
        <TransfersPage
          dataRevision={revision}
          initialTransferId={notificationTarget?.entityType === 'merchandise_transfer' ? notificationTarget.entityId : undefined}
          networkAvailable={networkAvailable}
          operatorAccountId={operatorSession?.account.id ?? null}
          operatorSession={operatorSession}
          stores={stores}
          user={user}
          onDataChanged={() => void refreshLocalState()}
          onSync={() => syncCurrentSession()}
        />
      )}
      {page === 'collaborators' && (
        <CollaboratorsPage
          attendanceStoreFilter={attendanceStoreFilter}
          dataRevision={revision}
          operatorAccountId={operatorSession?.account.id ?? null}
          operatorSession={operatorSession}
          stores={stores}
          user={user}
          onDataChanged={() => void refreshLocalState()}
          onAttendanceStoreFilterChange={setAttendanceStoreFilter}
          onSync={() => syncCurrentSession()}
        />
      )}
      {page === 'purchases' && hasCapability(
        { technicalUser: user, operatorSession },
        'purchases',
      ) && (
        <PurchasesPage
          dataRevision={revision}
          initialPurchaseId={notificationTarget?.entityType === 'purchase' ? notificationTarget.entityId : undefined}
          networkAvailable={networkAvailable}
          operatorSession={operatorSession}
          stores={stores}
          user={user}
          onDataChanged={() => void refreshLocalState()}
        />
      )}
      {page === 'closings' && hasCapability(
        { technicalUser: user, operatorSession },
        'cashClosings',
      ) && (
        <ClosingsPage
          dataRevision={revision}
          initialClosingId={notificationTarget?.entityType === 'cash_closing' ? notificationTarget.entityId : undefined}
          networkAvailable={networkAvailable}
          stores={stores}
          user={user}
          operatorSession={operatorSession}
        />
      )}
      {page === 'central-cash' && user.role === 'admin' && (
        <CentralCashPage
          dataRevision={revision}
          networkAvailable={networkAvailable}
          stores={stores}
          user={user}
        />
      )}
      {page === 'exports' && user.role === 'admin' && (
        <ExportsPage
          dataRevision={revision}
          networkAvailable={networkAvailable}
          stores={stores}
          user={user}
        />
      )}
      {page === 'settings' && (
        <SettingsPage
          dataRevision={revision}
          networkAvailable={networkAvailable}
          operatorSession={operatorSession}
          stores={stores}
          user={user}
          onStoresChanged={() => void refreshLocalState()}
        />
      )}
    </AppShell>
  )
}

export default App
