import { useCallback, useEffect, useState } from 'react'
import { AppShell, type PageId } from './components/AppShell'
import type { Store, UserProfile } from './domain/models'
import { AttendancePage } from './pages/AttendancePage'
import { ClosingsPage } from './pages/ClosingsPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { LoginPage } from './pages/LoginPage'
import { SettingsPage } from './pages/SettingsPage'
import { authService } from './services/authService'
import { bootstrapService } from './services/bootstrapService'
import { referenceDataService } from './services/referenceDataService'
import { syncService } from './services/syncService'

type AppState = 'loading' | 'ready' | 'error'

function App() {
  const [state, setState] = useState<AppState>('loading')
  const [user, setUser] = useState<UserProfile>()
  const [page, setPage] = useState<PageId>('home')
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
    void bootstrapService
      .initialize()
      .then(async () => {
        const restoredUser = await authService.restore()
        if (restoredUser && !restoredUser.demo) {
          await referenceDataService.refresh()
        }
        if (!active) return
        setUser(restoredUser)
        await refreshLocalState()
        if (active) {
          setState('ready')
          void syncService
            .process()
            .then(refreshLocalState)
            .catch((cause: unknown) =>
              console.error('No fue posible actualizar datos remotos', cause),
            )
        }
      })
      .catch((cause: unknown) => {
        console.error('No fue posible iniciar Operaciones', cause)
        if (active) setState('error')
      })
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
    if (!profile.demo) await referenceDataService.refresh()
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
    }
  }

  function navigate(nextPage: PageId) {
    if ((nextPage === 'closings' || nextPage === 'settings') && user?.role !== 'admin') {
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
          <span className="mx-auto flex size-14 animate-pulse items-center justify-center rounded-2xl bg-teal-700 text-2xl font-black text-white">O</span>
          <p className={`mt-5 text-sm font-semibold ${state === 'error' ? 'text-red-700' : 'text-slate-500'}`}>
            {state === 'error' ? 'No fue posible preparar la aplicación.' : 'Preparando Operaciones…'}
          </p>
        </div>
      </main>
    )
  }

  if (!user) return <LoginPage onSignedIn={(profile) => void signedIn(profile)} />

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
      {page === 'attendance' && (
        <AttendancePage stores={stores} user={user} onDataChanged={() => void refreshLocalState()} />
      )}
      {page === 'closings' && user.role === 'admin' && <ClosingsPage stores={stores} user={user} />}
      {page === 'settings' && user.role === 'admin' && (
        <SettingsPage stores={stores} user={user} onStoresChanged={() => void refreshLocalState()} />
      )}
    </AppShell>
  )
}

export default App
