import { useCallback, useEffect, useState } from 'react'
import { AppShell, type PageId } from './components/AppShell'
import {
  ALL_STORES,
  type StoreScopeValue,
} from './components/filters/StoreScopeSelector'
import type { Store, UserProfile } from './domain/models'
import { AttendancePage } from './pages/AttendancePage'
import { ClosingsPage } from './pages/ClosingsPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { LoginPage } from './pages/LoginPage'
import { SettingsPage } from './pages/SettingsPage'
import { TransfersPage } from './pages/TransfersPage'
import { authService } from './services/authService'
import { bootstrapService } from './services/bootstrapService'
import { referenceDataService } from './services/referenceDataService'
import { syncService } from './services/syncService'

type AppState = 'loading' | 'ready' | 'error'

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Error desconocido'
}

function App() {
  const [state, setState] = useState<AppState>('loading')
  const [startupError, setStartupError] = useState<string>()
  const [startupNotice, setStartupNotice] = useState<string>()
  const [user, setUser] = useState<UserProfile>()
  const [page, setPage] = useState<PageId>('home')
  const [attendanceStoreFilter, setAttendanceStoreFilter] =
    useState<StoreScopeValue>(ALL_STORES)
  const [stores, setStores] = useState<Store[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [revision, setRevision] = useState(0)

  const refreshLocalState = useCallback(async () => {
    const [availableStores, pending] = await Promise.all([
      referenceDataService.listStores(),
      syncService.countPending(),
    ])
    setStores(availableStores)
    setPendingCount(pending)
    setRevision((value) => value + 1)
  }, [])

  const synchronize = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await syncService.process()
      await refreshLocalState()
    } catch (cause: unknown) {
      console.error('No fue posible sincronizar', cause)
    } finally {
      setSyncing(false)
    }
  }, [refreshLocalState, syncing])

  useEffect(() => {
    let active = true

    async function initializeApplication() {
      try {
        await bootstrapService.initialize()
        await refreshLocalState()
      } catch (cause: unknown) {
        console.error('No fue posible preparar el almacenamiento local', cause)
        if (active) {
          setStartupError(errorMessage(cause))
          setState('error')
        }
        return
      }

      let restoredUser: UserProfile | undefined
      try {
        restoredUser = await authService.restore()
      } catch (cause: unknown) {
        console.error('No fue posible restaurar la sesión anterior', cause)
        if (active) {
          setStartupNotice(
            'No se pudo restaurar la sesión anterior. Inicia sesión nuevamente.',
          )
        }
      }

      if (restoredUser && !restoredUser.demo) {
        try {
          await referenceDataService.refresh()
          await refreshLocalState()
        } catch (cause: unknown) {
          console.error('No fue posible actualizar los datos remotos', cause)
          if (active) {
            setStartupNotice(
              'Supabase no respondió correctamente. Se conservaron los datos locales.',
            )
          }
        }
      }

      if (!active) return
      setUser(restoredUser)
      setState('ready')
      void syncService
        .process()
        .then(refreshLocalState)
        .catch((cause: unknown) =>
          console.error('No fue posible actualizar datos remotos', cause),
        )
    }

    void initializeApplication()
    return () => {
      active = false
    }
  }, [refreshLocalState])

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      void synchronize()
    }
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [synchronize])

  async function signedIn(profile: UserProfile) {
    setUser(profile)
    setAttendanceStoreFilter(ALL_STORES)
    setStartupNotice(undefined)
    if (!profile.demo) {
      try {
        await referenceDataService.refresh()
      } catch (cause: unknown) {
        console.error('No fue posible actualizar los datos remotos', cause)
        setStartupNotice(
          'La sesión inició, pero Supabase no devolvió los datos operativos.',
        )
      }
    }
    await refreshLocalState()
    void syncService
      .process()
      .then(refreshLocalState)
      .catch((cause: unknown) =>
        console.error('No fue posible actualizar datos remotos', cause),
      )
  }

  async function signOut() {
    try {
      await authService.signOut()
    } catch (cause: unknown) {
      console.error('No fue posible cerrar la sesión remota', cause)
    } finally {
      setUser(undefined)
      setPage('home')
      setAttendanceStoreFilter(ALL_STORES)
    }
  }

  function navigate(nextPage: PageId) {
    if (nextPage === 'closings' && user?.role !== 'admin') {
      setPage('home')
      return
    }
    setPage(nextPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (state !== 'ready') {
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
          <p className={`mt-5 text-sm font-semibold ${state === 'error' ? 'text-red-700' : 'text-slate-500'}`}>
            {state === 'error' ? 'No fue posible preparar la aplicación.' : 'Preparando la aplicación…'}
          </p>
          {state === 'error' && startupError && (
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">
              {startupError}
            </p>
          )}
          {state === 'error' && (
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
    return (
      <LoginPage
        notice={startupNotice}
        onSignedIn={(profile) => void signedIn(profile)}
      />
    )
  }

  return (
    <AppShell
      currentPage={page}
      online={online}
      pendingCount={pendingCount}
      syncing={syncing}
      user={user}
      onNavigate={navigate}
      onSignOut={() => void signOut()}
      onSync={() => void synchronize()}
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
      {page === 'attendance' && (
        <AttendancePage
          stores={stores}
          storeFilter={attendanceStoreFilter}
          user={user}
          onDataChanged={() => void refreshLocalState()}
          onStoreFilterChange={setAttendanceStoreFilter}
        />
      )}
      {page === 'closings' && user.role === 'admin' && <ClosingsPage stores={stores} user={user} />}
      {page === 'settings' && (
        <SettingsPage stores={stores} user={user} onStoresChanged={() => void refreshLocalState()} />
      )}
    </AppShell>
  )
}

export default App
