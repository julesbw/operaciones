import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AppModal } from '../components/AppModal'
import { AppAccountsSection } from './AppAccountsSection'
import { BellIcon, CheckIcon, PlusIcon, ReceiptIcon, SettingsIcon, StoreIcon, UsersIcon, XIcon } from '../components/icons'
import {
  ALL_STORES,
  StoreFilter,
  type StoreFilterValue,
} from '../components/StoreFilter'
import { hasCapability } from '../domain/capabilities'
import type {
  ClosingReconciliationMode,
  Collaborator,
  OperatorSession,
  Store,
  Supplier,
  UserProfile,
} from '../domain/models'
import { isSupabaseConfigured } from '../lib/supabase'
import { collaboratorService } from '../services/collaboratorService'
import { connectivityService } from '../services/connectivityService'
import { paymentService } from '../services/paymentService'
import { referenceDataService } from '../services/referenceDataService'
import { storeService } from '../services/storeService'
import { supplierService } from '../services/supplierService'
import {
  PushNotificationError,
  pushNotificationService,
  type PushNotificationState,
  type PushNotificationStatus,
} from '../services/pushNotificationService'
import { WEEKDAYS } from '../domain/constants'
import { currencyFormatter } from '../utils/money'

type SettingsTab = 'stores' | 'suppliers' | 'team' | 'users' | 'system'

type SettingsPageProps = {
  operatorSession?: OperatorSession
  stores: Store[]
  user: UserProfile
  dataRevision?: number
  networkAvailable?: boolean
  onStoresChanged: () => void
}

const buildTime = new Date(import.meta.env.BUILD_TIME)
const buildTimeLabel = Number.isNaN(buildTime.getTime())
  ? import.meta.env.BUILD_TIME
  : new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'long',
    }).format(buildTime)

const PUSH_STATE_LABELS: Record<PushNotificationState, string> = {
  unsupported: 'No compatible',
  'ios-install-required': 'Instala la PWA para activar (iPhone/iPad)',
  'permission-default': 'Permiso no solicitado',
  enabled: 'Activadas en este dispositivo',
  'permission-denied': 'Bloqueadas por el navegador',
  disabled: 'Desactivadas en este dispositivo',
  error: 'Error de registro',
}

export function SettingsPage({
  operatorSession,
  stores,
  user,
  dataRevision = 0,
  networkAvailable = connectivityService.isNetworkAvailable(),
  onStoresChanged,
}: SettingsPageProps) {
  const isAdmin = user.role === 'admin'
  const canCreateSuppliers = hasCapability(
    { technicalUser: user, operatorSession },
    'supplierCreation',
  )
  const [tab, setTab] = useState<SettingsTab>(
    isAdmin ? 'stores' : canCreateSuppliers ? 'suppliers' : 'system',
  )
  const [storeModalOpen, setStoreModalOpen] = useState(false)
  const [collaboratorModalOpen, setCollaboratorModalOpen] = useState(false)
  const [supplierModalOpen, setSupplierModalOpen] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editingName, setEditingName] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [newSupplierName, setNewSupplierName] = useState('')
  const [editingSupplierId, setEditingSupplierId] = useState<string>()
  const [editingSupplierName, setEditingSupplierName] = useState('')
  const [teamStoreFilter, setTeamStoreFilter] =
    useState<StoreFilterValue>(ALL_STORES)
  const [newCollaboratorStoreId, setNewCollaboratorStoreId] = useState(
    stores.find((store) => store.status === 'active')?.id ?? '',
  )
  const [initialCollaboratorStoreId, setInitialCollaboratorStoreId] = useState(
    stores.find((store) => store.status === 'active')?.id ?? '',
  )
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [collaboratorSearch, setCollaboratorSearch] = useState('')
  const [selectedCollaborator, setSelectedCollaborator] = useState<Collaborator>()
  const [statusChangeCollaborator, setStatusChangeCollaborator] =
    useState<Collaborator>()
  const [editingCollaborator, setEditingCollaborator] = useState<Collaborator>()
  const [newCollaboratorName, setNewCollaboratorName] = useState('')
  const [restDay, setRestDay] = useState(0)
  const [payCycleEndWeekday, setPayCycleEndWeekday] = useState(6)
  const [weeklyPay, setWeeklyPay] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [creationError, setCreationError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [pushStatus, setPushStatus] = useState<PushNotificationStatus>({
    state: 'disabled',
  })
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string>()
  const storeFabRef = useRef<HTMLButtonElement>(null)
  const collaboratorFabRef = useRef<HTMLButtonElement>(null)
  const supplierFabRef = useRef<HTMLButtonElement>(null)
  const storeNameInputRef = useRef<HTMLInputElement>(null)
  const collaboratorNameInputRef = useRef<HTMLInputElement>(null)
  const supplierNameInputRef = useRef<HTMLInputElement>(null)
  const canMutateAdmin =
    isAdmin &&
    (user.demo ||
      (isSupabaseConfigured && connectivityService.isNetworkAvailable()))
  const canCreateSupplier =
    canCreateSuppliers &&
    (user.demo ||
      (isSupabaseConfigured && connectivityService.isNetworkAvailable()))
  const activeStores = stores.filter((store) => store.status === 'active')
  const pushAction =
    pushStatus.state === 'enabled'
      ? 'disable'
      : pushStatus.state === 'permission-default' ||
          pushStatus.state === 'disabled' ||
          pushStatus.state === 'error'
        ? 'enable'
        : undefined
  const pushStatusLabel = pushBusy
    ? 'Registrando / desactivando'
    : PUSH_STATE_LABELS[pushStatus.state]

  useEffect(() => {
    if (!isAdmin) return
    const selectableStores = stores.filter((store) => store.status === 'active')
    if (
      !selectableStores.some(
        (store) => store.id === newCollaboratorStoreId,
      )
    ) {
      const fallbackStoreId = selectableStores[0]?.id ?? ''
      setNewCollaboratorStoreId(fallbackStoreId)
      setInitialCollaboratorStoreId(fallbackStoreId)
    }
    if (
      teamStoreFilter !== ALL_STORES &&
      !selectableStores.some((store) => store.id === teamStoreFilter)
    ) {
      setTeamStoreFilter(ALL_STORES)
    }
  }, [isAdmin, newCollaboratorStoreId, stores, teamStoreFilter])

  useEffect(() => {
    if (!message) return
    const timeout = window.setTimeout(() => setMessage(undefined), 3200)
    return () => window.clearTimeout(timeout)
  }, [message])

  useEffect(() => {
    if (!isAdmin || tab !== 'system') return
    let active = true
    setPushError(undefined)
    void pushNotificationService
      .getStatus()
      .then((status) => {
        if (active) setPushStatus(status)
      })
      .catch((cause: unknown) => {
        if (!active) return
        console.error('No fue posible consultar las notificaciones Push', cause)
        setPushError('No fue posible consultar el estado de Push.')
      })
    return () => {
      active = false
    }
  }, [isAdmin, tab])

  useEffect(() => {
    if (!canCreateSuppliers) {
      setSuppliers([])
      return
    }
    void supplierService
      .list(!isAdmin)
      .then(setSuppliers)
      .catch((cause: unknown) => {
        console.error('No fue posible cargar proveedores', cause)
        setError('No fue posible cargar los proveedores.')
      })
  }, [canCreateSuppliers, dataRevision, isAdmin])

  useEffect(() => {
    if (tab === 'suppliers' && !canCreateSuppliers) setTab('system')
    if (tab !== 'suppliers' && tab !== 'system' && !isAdmin) {
      setTab(canCreateSuppliers ? 'suppliers' : 'system')
    }
  }, [canCreateSuppliers, isAdmin, tab])

  useEffect(() => {
    if (!isAdmin) {
      setCollaborators([])
      return
    }
    const requestedStoreId =
      teamStoreFilter === ALL_STORES ? undefined : teamStoreFilter
    void referenceDataService
      .listCollaborators(requestedStoreId, true)
      .then((people) => {
        const activeStoreIds = new Set(
          stores
            .filter((store) => store.status === 'active')
            .map((store) => store.id),
        )
        setCollaborators(
          people.filter((person) => activeStoreIds.has(person.storeId)),
        )
      })
      .catch((cause: unknown) => {
        console.error('No fue posible cargar colaboradores', cause)
        setError('No fue posible cargar el equipo.')
      })
  }, [dataRevision, isAdmin, stores, teamStoreFilter])

  const storeNames = useMemo(
    () => new Map(stores.map((store) => [store.id, store.name])),
    [stores],
  )
  const filteredCollaborators = useMemo(() => {
    const query = collaboratorSearch.trim().toLocaleLowerCase('es-MX')
    if (!query) return collaborators
    return collaborators.filter((collaborator) =>
      collaborator.name.toLocaleLowerCase('es-MX').includes(query),
    )
  }, [collaboratorSearch, collaborators])

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setCreationError(undefined)
    setMessage(undefined)
    try {
      const store = await storeService.create(newStoreName)
      setNewStoreName('')
      setStoreModalOpen(false)
      setMessage(`${store.name} se creó correctamente.`)
      onStoresChanged()
    } catch (cause: unknown) {
      console.error('No fue posible crear la tienda', cause)
      setCreationError(
        cause instanceof Error ? cause.message : 'No fue posible crear la tienda.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function updatePushSubscription(action: 'enable' | 'disable') {
    if (pushBusy || !networkAvailable) return
    setPushBusy(true)
    setPushError(undefined)
    try {
      const status = action === 'enable'
        ? await pushNotificationService.enable()
        : await pushNotificationService.disable()
      setPushStatus(status)
    } catch (cause: unknown) {
      console.error('No fue posible actualizar las notificaciones Push', cause)
      if (cause instanceof PushNotificationError && cause.state) {
        setPushStatus({ state: cause.state })
      } else {
        const current = await pushNotificationService
          .getStatus()
          .catch(() => undefined)
        setPushStatus(
          action === 'disable' && current
            ? current
            : { state: 'error', detail: current?.detail },
        )
      }
      setPushError(
        cause instanceof PushNotificationError && cause.message
          ? cause.message
          : action === 'enable'
            ? 'No fue posible activar las notificaciones en este dispositivo.'
            : 'No fue posible desactivar las notificaciones en este dispositivo.',
      )
    } finally {
      setPushBusy(false)
    }
  }

  async function saveName(store: Store) {
    setSaving(true)
    setError(undefined)
    setMessage(undefined)
    try {
      await storeService.update(store, { name: editingName })
      setEditingId(undefined)
      onStoresChanged()
    } catch (cause: unknown) {
      console.error('No fue posible actualizar la tienda', cause)
      setError(cause instanceof Error ? cause.message : 'No fue posible actualizar la tienda.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleStore(store: Store) {
    setSaving(true)
    setError(undefined)
    setMessage(undefined)
    try {
      await storeService.update(store, {
        status: store.status === 'active' ? 'inactive' : 'active',
      })
      onStoresChanged()
    } catch (cause: unknown) {
      console.error('No fue posible cambiar el estado de la tienda', cause)
      setError('No fue posible cambiar el estado de la tienda.')
    } finally {
      setSaving(false)
    }
  }

  async function updateClosingReconciliationMode(
    store: Store,
    closingReconciliationMode: ClosingReconciliationMode,
  ) {
    setSaving(true)
    setError(undefined)
    setMessage(undefined)
    try {
      await storeService.update(store, { closingReconciliationMode })
      setMessage(`El modo de corte de ${store.name} se actualizó.`)
      onStoresChanged()
    } catch (cause: unknown) {
      console.error('No fue posible actualizar el modo de corte', cause)
      setError('No fue posible actualizar el modo de corte.')
    } finally {
      setSaving(false)
    }
  }

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setCreationError(undefined)
    try {
      const supplier = await supplierService.create(
        newSupplierName,
        user.id,
        operatorSession?.token ?? null,
      )
      setSuppliers((current) => [...current, supplier])
      setNewSupplierName('')
      setSupplierModalOpen(false)
      setMessage(`${supplier.name} se creó correctamente.`)
    } catch (cause: unknown) {
      setCreationError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible crear el proveedor.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function saveSupplierName(supplier: Supplier) {
    setSaving(true)
    setError(undefined)
    try {
      const updated = await supplierService.update(supplier, {
        name: editingSupplierName,
      })
      setSuppliers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      setEditingSupplierId(undefined)
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible renombrar el proveedor.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function toggleSupplier(supplier: Supplier) {
    setSaving(true)
    setError(undefined)
    try {
      const updated = await supplierService.update(supplier, {
        isActive: !supplier.isActive,
      })
      setSuppliers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible cambiar el estado del proveedor.',
      )
    } finally {
      setSaving(false)
    }
  }

  function openSupplierModal() {
    setNewSupplierName('')
    setCreationError(undefined)
    setSupplierModalOpen(true)
  }

  async function saveCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setCreationError(undefined)
    setMessage(undefined)
    try {
      const input = {
        name: newCollaboratorName,
        storeId: newCollaboratorStoreId,
        restDay,
        payCycleEndWeekday,
        weeklyPay: weeklyPay.trim() ? Number(weeklyPay) : Number.NaN,
      }
      const collaborator = editingCollaborator
        ? await collaboratorService.update(editingCollaborator.id, input)
        : await collaboratorService.create(input)
      await paymentService.refreshRemote()
      if (
        teamStoreFilter === ALL_STORES ||
        teamStoreFilter === collaborator.storeId
      ) {
        setCollaborators((current) =>
          current.some((item) => item.id === collaborator.id)
            ? current.map((item) =>
                item.id === collaborator.id ? collaborator : item,
              )
            : [...current, collaborator],
        )
      } else if (editingCollaborator) {
        setCollaborators((current) =>
          current.filter((item) => item.id !== collaborator.id),
        )
      }
      setNewCollaboratorName('')
      setWeeklyPay('')
      setCollaboratorModalOpen(false)
      setEditingCollaborator(undefined)
      setMessage(
        editingCollaborator
          ? `${collaborator.name} se actualizó correctamente.`
          : `${collaborator.name} se añadió al equipo.`,
      )
    } catch (cause: unknown) {
      console.error('No fue posible crear el colaborador', cause)
      setCreationError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible crear el colaborador.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function changeCollaboratorStatus(collaborator: Collaborator) {
    setSaving(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const updated = await collaboratorService.setStatus(
        collaborator.id,
        collaborator.status === 'active' ? 'inactive' : 'active',
      )
      setCollaborators((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      setSelectedCollaborator((current) =>
        current?.id === updated.id ? updated : current,
      )
      setStatusChangeCollaborator(undefined)
      setMessage(
        updated.status === 'active'
          ? `${updated.name} se activó correctamente.`
          : `${updated.name} se desactivó correctamente.`,
      )
    } catch (cause: unknown) {
      console.error('No fue posible cambiar el estado del colaborador', cause)
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible cambiar el estado del colaborador.',
      )
    } finally {
      setSaving(false)
    }
  }

  function requestCollaboratorStatusChange(collaborator: Collaborator) {
    if (collaborator.status === 'active') {
      setSelectedCollaborator(undefined)
      setStatusChangeCollaborator(collaborator)
      return
    }
    void changeCollaboratorStatus(collaborator)
  }

  function openStoreModal() {
    setNewStoreName('')
    setCreationError(undefined)
    setStoreModalOpen(true)
  }

  function openCollaboratorModal() {
    const selectedStoreId =
      teamStoreFilter !== ALL_STORES &&
      activeStores.some((store) => store.id === teamStoreFilter)
        ? teamStoreFilter
        : activeStores[0]?.id ?? ''
    setNewCollaboratorName('')
    setNewCollaboratorStoreId(selectedStoreId)
    setInitialCollaboratorStoreId(selectedStoreId)
    setRestDay(0)
    setPayCycleEndWeekday(6)
    setWeeklyPay('')
    setEditingCollaborator(undefined)
    setCreationError(undefined)
    setCollaboratorModalOpen(true)
  }

  function editCollaborator(collaborator: Collaborator) {
    setSelectedCollaborator(undefined)
    setEditingCollaborator(collaborator)
    setNewCollaboratorName(collaborator.name)
    setNewCollaboratorStoreId(collaborator.storeId)
    setInitialCollaboratorStoreId(collaborator.storeId)
    setRestDay(collaborator.restDay)
    setPayCycleEndWeekday(collaborator.payCycleEndWeekday ?? 6)
    setWeeklyPay(
      collaborator.weeklyPay === undefined
        ? ''
        : String(collaborator.weeklyPay),
    )
    setCreationError(undefined)
    setCollaboratorModalOpen(true)
  }

  const collaboratorHasUnsavedChanges = editingCollaborator
    ? newCollaboratorName.trim() !== editingCollaborator.name ||
      newCollaboratorStoreId !== editingCollaborator.storeId ||
      restDay !== editingCollaborator.restDay ||
      payCycleEndWeekday !== editingCollaborator.payCycleEndWeekday ||
      Number(weeklyPay) !== editingCollaborator.weeklyPay
    : newCollaboratorName.trim().length > 0 ||
      weeklyPay.trim().length > 0 ||
      restDay !== 0 ||
      payCycleEndWeekday !== 6 ||
      newCollaboratorStoreId !== initialCollaboratorStoreId

  return (
    <section className="mx-auto max-w-5xl">
      <div>
        <h1 className="page-title">Ajustes</h1>
      </div>

      <div className="mt-4 flex max-w-full gap-2 overflow-x-auto overscroll-x-contain border-b border-slate-200">
        {isAdmin && (
          <button className={tab === 'stores' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('stores')}>
            <StoreIcon className="size-4" /> Tiendas
          </button>
        )}
        {canCreateSuppliers && (
          <button className={tab === 'suppliers' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('suppliers')}>
            <ReceiptIcon className="size-4" /> Proveedores
          </button>
        )}
        {isAdmin && (
          <>
            <button className={tab === 'team' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('team')}>
              <UsersIcon className="size-4" /> Colaboradores
            </button>
            <button className={tab === 'users' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('users')}>
              <UsersIcon className="size-4" /> Usuarios
            </button>
          </>
        )}
        <button className={tab === 'system' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('system')}>
          <SettingsIcon className="size-4" /> Sistema
        </button>
      </div>

      {tab !== 'system' && error && <p className="alert-error mt-6">{error}</p>}
      {tab !== 'system' && message && <p className="alert-success mt-6">{message}</p>}
      {tab !== 'system' && (
        (tab === 'suppliers' && !canCreateSupplier) ||
        (tab !== 'suppliers' && isAdmin && !canMutateAdmin)
      ) && (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Los cambios administrativos requieren conexión.
        </p>
      )}

      {isAdmin && tab === 'stores' && (
        <div className="mt-6">
          <article className="panel p-0">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 className="font-extrabold text-slate-950">Tiendas registradas</h2>
              <p className="mt-1 text-xs text-slate-500">Los históricos conservan la relación aunque cambie el nombre.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {stores.length === 0 ? (
                <div className="empty-state">
                  <StoreIcon className="mx-auto size-8 text-slate-300" />
                  <p className="mt-3 font-bold text-slate-700">No hay tiendas configuradas</p>
                  <button
                    className="button-secondary mt-5"
                    disabled={!canMutateAdmin}
                    type="button"
                    onClick={openStoreModal}
                  >
                    <PlusIcon className="size-4" /> Agregar tienda
                  </button>
                </div>
              ) : (
                stores.map((store) => (
                  <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6" key={store.id}>
                    <span className={`flex size-10 items-center justify-center rounded-xl ${store.status === 'active' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-400'}`}>
                      <StoreIcon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1 basis-[180px]">
                      {editingId === store.id ? (
                        <input className="field mt-0" autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                      ) : (
                        <>
                          <p className="font-bold text-slate-900">{store.name}</p>
                          <p className={`mt-0.5 text-xs font-semibold ${store.status === 'active' ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {store.status === 'active' ? 'Activa' : 'Inactiva'}
                          </p>
                          <label className="mt-3 block text-xs font-semibold text-slate-600">
                            Modo de conciliación del corte
                            <select
                              className="field mt-1"
                              disabled={!canMutateAdmin || saving}
                              value={store.closingReconciliationMode ?? 'normal'}
                              onChange={(event) => void updateClosingReconciliationMode(
                                store,
                                event.target.value as ClosingReconciliationMode,
                              )}
                            >
                              <option value="normal">Normal</option>
                              <option value="sicar">Corte de Caja: SICAR</option>
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {editingId === store.id ? (
                        <>
                          <button aria-label="Guardar nombre" className="icon-button text-teal-700" disabled={saving} type="button" onClick={() => void saveName(store)}><CheckIcon className="size-4" /></button>
                          <button aria-label="Cancelar edición" className="icon-button" type="button" onClick={() => setEditingId(undefined)}><XIcon className="size-4" /></button>
                        </>
                      ) : (
                        <>
                          <button className="small-button" disabled={!canMutateAdmin || saving} type="button" onClick={() => { setEditingId(store.id); setEditingName(store.name) }}>Editar</button>
                          <button className="small-button" disabled={!canMutateAdmin || saving} type="button" onClick={() => void toggleStore(store)}>{store.status === 'active' ? 'Desactivar' : 'Activar'}</button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      )}

      {isAdmin && tab === 'team' && (
        <div className="mt-6">
          <div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-950">Colaboradores</h2>
              <p className="mt-1 text-sm text-slate-500">Los inactivos conservan su historial y sus pagos pendientes.</p>
            </div>
            <div className="mt-5 space-y-3">
              <input
                aria-label="Buscar colaborador por nombre"
                className="field mt-0"
                placeholder="Buscar colaborador…"
                type="search"
                value={collaboratorSearch}
                onChange={(event) => setCollaboratorSearch(event.target.value)}
              />
              <StoreFilter
                ariaLabel="Filtrar colaboradores por tienda"
                stores={activeStores}
                value={teamStoreFilter}
                onChange={setTeamStoreFilter}
              />
            </div>
            {activeStores.length === 0 ? (
              <div className="panel mt-5 border-dashed text-center">
                <StoreIcon className="mx-auto size-8 text-slate-300" />
                <p className="mt-3 font-bold text-slate-700">Primero crea una tienda activa</p>
                <p className="mt-1 text-sm text-slate-500">Cada colaborador debe pertenecer a una tienda.</p>
                <button
                  className="button-secondary mt-5"
                  type="button"
                  onClick={() => setTab('stores')}
                >
                  Ir a Tiendas
                </button>
              </div>
            ) : filteredCollaborators.length === 0 ? (
              <div className="panel mt-5 border-dashed text-center">
                <UsersIcon className="mx-auto size-8 text-slate-300" />
                <p className="mt-3 font-bold text-slate-700">
                  {collaboratorSearch.trim()
                    ? 'No encontramos coincidencias'
                    : 'Aún no hay colaboradores'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {collaboratorSearch.trim()
                    ? 'Prueba con otro nombre o cambia el filtro de tienda.'
                    : 'Usa el botón + para añadir el primero.'}
                </p>
                {!collaboratorSearch.trim() && (
                  <button
                    className="button-secondary mt-5"
                    disabled={!canMutateAdmin}
                    type="button"
                    onClick={openCollaboratorModal}
                  >
                    <PlusIcon className="size-4" /> Agregar colaborador
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {filteredCollaborators.map((collaborator) => (
                  <article className="panel" key={collaborator.id}>
                    <div className="flex items-start gap-3">
                      <span className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-black ${collaborator.status === 'active' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-400'}`}>
                        {collaborator.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-slate-950">{collaborator.name}</h3>
                        {teamStoreFilter === ALL_STORES && (
                          <p className="mt-1 text-xs font-bold text-teal-700">
                            {storeNames.get(collaborator.storeId) ?? 'Tienda sin identificar'}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-slate-500">Descanso: {WEEKDAYS[collaborator.restDay]}</p>
                        <p className={`mt-1 text-xs font-semibold ${collaborator.payCycleEndWeekday === undefined ? 'text-amber-700' : 'text-slate-500'}`}>
                          Día de raya: {collaborator.payCycleEndWeekday === undefined
                            ? 'Sin configurar'
                            : WEEKDAYS[collaborator.payCycleEndWeekday]}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${collaborator.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {collaborator.status === 'active' ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    <div className="mt-5 rounded-xl bg-slate-50 p-3.5">
                      <p className="text-xs font-semibold text-slate-500">Pago semanal</p>
                      <p className="mt-1 font-extrabold text-slate-900">
                        {collaborator.weeklyPay === undefined ? 'Protegido en Supabase' : currencyFormatter.format(collaborator.weeklyPay)}
                      </p>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        className="small-button"
                        type="button"
                        onClick={() => setSelectedCollaborator(collaborator)}
                      >
                        Ver perfil
                      </button>
                      <button
                        className="small-button"
                        disabled={!canMutateAdmin || saving}
                        type="button"
                        onClick={() => requestCollaboratorStatusChange(collaborator)}
                      >
                        {collaborator.status === 'active' ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {isAdmin && tab === 'users' && (
        <AppAccountsSection
          canMutate={canMutateAdmin && isSupabaseConfigured}
          collaborators={collaborators}
          stores={stores}
        />
      )}

      {canCreateSuppliers && tab === 'suppliers' && (
        <div className="mt-6">
          <article className="panel p-0">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 className="font-extrabold text-slate-950">Proveedores</h2>
              <p className="mt-1 text-xs text-slate-500">
                Los nombres históricos permanecen congelados en cada Compra.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {suppliers.length === 0 ? (
                <div className="empty-state">
                  <ReceiptIcon className="mx-auto size-8 text-slate-300" />
                  <p className="mt-3 font-bold text-slate-700">
                    No hay proveedores registrados
                  </p>
                  <button
                    className="button-secondary mt-5"
                    disabled={!canCreateSupplier}
                    type="button"
                    onClick={openSupplierModal}
                  >
                    <PlusIcon className="size-4" /> Agregar proveedor
                  </button>
                </div>
              ) : (
                suppliers.map((supplier) => (
                  <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6" key={supplier.id}>
                    <span className={`flex size-10 items-center justify-center rounded-xl ${supplier.isActive ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-400'}`}>
                      <ReceiptIcon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1 basis-[180px]">
                      {editingSupplierId === supplier.id ? (
                        <input
                          autoFocus
                          className="field mt-0"
                          value={editingSupplierName}
                          onChange={(event) => setEditingSupplierName(event.target.value)}
                        />
                      ) : (
                        <>
                          <p className="font-bold text-slate-900">{supplier.name}</p>
                          <p className={`mt-0.5 text-xs font-semibold ${supplier.isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {supplier.isActive ? 'Activo' : 'Inactivo'}
                          </p>
                        </>
                      )}
                    </div>
                    {isAdmin && <div className="flex gap-2">
                      {editingSupplierId === supplier.id ? (
                        <>
                          <button aria-label="Guardar nombre" className="icon-button text-teal-700" disabled={saving} type="button" onClick={() => void saveSupplierName(supplier)}><CheckIcon className="size-4" /></button>
                          <button aria-label="Cancelar edición" className="icon-button" type="button" onClick={() => setEditingSupplierId(undefined)}><XIcon className="size-4" /></button>
                        </>
                      ) : (
                        <>
                          <button className="small-button" disabled={!canMutateAdmin || saving} type="button" onClick={() => { setEditingSupplierId(supplier.id); setEditingSupplierName(supplier.name) }}>Editar</button>
                          <button className="small-button" disabled={!canMutateAdmin || saving} type="button" onClick={() => void toggleSupplier(supplier)}>{supplier.isActive ? 'Desactivar' : 'Activar'}</button>
                        </>
                      )}
                    </div>}
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      )}

      {tab === 'system' && (
        <>
          <article className="panel mt-6">
            <div className="flex items-center gap-3">
              <span className="stat-icon bg-teal-50 text-teal-700">
                <SettingsIcon className="size-5" />
              </span>
              <div>
                <p className="eyebrow">Sistema</p>
                <h2 className="text-xl font-extrabold text-slate-950">Información de la aplicación</h2>
              </div>
            </div>
            <dl className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Versión PWA</dt>
                <dd className="mt-1 font-extrabold text-slate-950">v{import.meta.env.APP_VERSION}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Versión del build</dt>
                <dd className="mt-1 break-all font-mono text-sm font-bold text-slate-950">{import.meta.env.BUILD_VERSION}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Hora del build</dt>
                <dd className="mt-1 text-sm font-bold text-slate-950">
                  <time dateTime={import.meta.env.BUILD_TIME}>{buildTimeLabel}</time>
                </dd>
              </div>
            </dl>
          </article>

          {isAdmin && (
            <article className="panel mt-6">
              <div className="flex items-start gap-3">
                <span className="stat-icon bg-teal-50 text-teal-700">
                  <BellIcon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="eyebrow">Notificaciones Push</p>
                  <h2 className="text-xl font-extrabold text-slate-950">
                    Avisos en este dispositivo
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Recibe avisos de Compras, Transferencias y Cortes cerrados aunque la PWA no esté abierta.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div>
                  <p aria-live="polite" className="font-extrabold text-slate-950">
                    {pushStatusLabel}
                  </p>
                  {pushStatus.detail && (
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {pushStatus.detail}
                    </p>
                  )}
                </div>
                {pushAction && (
                  <button
                    className={pushAction === 'enable' ? 'button-primary' : 'button-secondary'}
                    disabled={pushBusy || !networkAvailable}
                    type="button"
                    onClick={() => void updatePushSubscription(pushAction)}
                  >
                    {pushBusy
                      ? 'Procesando…'
                      : pushAction === 'enable'
                        ? 'Activar notificaciones'
                        : 'Desactivar'}
                  </button>
                )}
              </div>
              {!networkAvailable && pushAction && (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900">
                  Conéctate para cambiar las notificaciones Push.
                </p>
              )}
              {pushError && <p className="alert-error mt-3" role="alert">{pushError}</p>}
            </article>
          )}
        </>
      )}

      {isAdmin && tab === 'stores' && (
        <button
          aria-label="Crear una tienda"
          className="app-fab"
          disabled={!canMutateAdmin || saving}
          ref={storeFabRef}
          title="Nueva tienda"
          type="button"
          onClick={openStoreModal}
        >
          <PlusIcon className="size-7" />
        </button>
      )}

      {isAdmin && tab === 'team' && (
        <button
          aria-label="Crear un colaborador"
          className="app-fab"
          disabled={!canMutateAdmin || saving || activeStores.length === 0}
          ref={collaboratorFabRef}
          title="Nuevo colaborador"
          type="button"
          onClick={openCollaboratorModal}
        >
          <PlusIcon className="size-7" />
        </button>
      )}

      {canCreateSuppliers && tab === 'suppliers' && (
        <button
          aria-label="Crear un proveedor"
          className="app-fab"
          disabled={!canCreateSupplier || saving}
          ref={supplierFabRef}
          title="Nuevo proveedor"
          type="button"
          onClick={openSupplierModal}
        >
          <PlusIcon className="size-7" />
        </button>
      )}

      <AppModal
        closeDisabled={saving}
        closeLabel="Cerrar formulario de proveedor"
        eyebrow="Administración"
        hasUnsavedChanges={newSupplierName.trim().length > 0}
        initialFocusRef={supplierNameInputRef}
        open={supplierModalOpen}
        returnFocusRef={supplierFabRef}
        title="Nuevo proveedor"
        onClose={() => setSupplierModalOpen(false)}
      >
        <form onSubmit={createSupplier}>
          {creationError && <p className="alert-error mt-5">{creationError}</p>}
          <label className="field-label mt-6">
            Nombre
            <input
              className="field"
              maxLength={120}
              placeholder="Ej. Bimbo"
              ref={supplierNameInputRef}
              required
              value={newSupplierName}
              onChange={(event) => setNewSupplierName(event.target.value)}
            />
          </label>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button className="button-secondary" disabled={saving} type="button" onClick={() => setSupplierModalOpen(false)}>
              Cancelar
            </button>
            <button className="button-primary" disabled={saving} type="submit">
              {saving ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </form>
      </AppModal>

      <AppModal
        closeDisabled={saving}
        closeLabel="Cerrar formulario de tienda"
        eyebrow="Administración"
        hasUnsavedChanges={newStoreName.trim().length > 0}
        initialFocusRef={storeNameInputRef}
        open={storeModalOpen}
        returnFocusRef={storeFabRef}
        title="Nueva tienda"
        onClose={() => setStoreModalOpen(false)}
      >
        <form onSubmit={createStore}>
          {creationError && (
            <div className="alert-error mt-5" role="alert">{creationError}</div>
          )}
          <label className="field-label mt-6">
            Nombre
            <input
              className="field"
              maxLength={100}
              placeholder="Ej. Tienda Sur"
              ref={storeNameInputRef}
              required
              value={newStoreName}
              onChange={(event) => setNewStoreName(event.target.value)}
            />
          </label>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            La tienda se creará con estado activo.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              className="button-secondary w-full"
              disabled={saving}
              type="button"
              onClick={() => setStoreModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              className="button-primary w-full"
              disabled={!canMutateAdmin || saving}
              type="submit"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </AppModal>

      <AppModal
        closeDisabled={saving}
        closeLabel="Cerrar formulario de colaborador"
        eyebrow="Administración"
        hasUnsavedChanges={collaboratorHasUnsavedChanges}
        initialFocusRef={collaboratorNameInputRef}
        open={collaboratorModalOpen}
        returnFocusRef={collaboratorFabRef}
        title={editingCollaborator ? 'Editar colaborador' : 'Nuevo colaborador'}
        onClose={() => {
          setCollaboratorModalOpen(false)
          setEditingCollaborator(undefined)
        }}
      >
        <form onSubmit={saveCollaborator}>
          {creationError && (
            <div className="alert-error mt-5" role="alert">{creationError}</div>
          )}
          <div className="mt-6 space-y-4">
            <label className="field-label">
              Nombre completo
              <input
                className="field"
                maxLength={120}
                placeholder="Ej. Ana López"
                ref={collaboratorNameInputRef}
                required
                value={newCollaboratorName}
                onChange={(event) => setNewCollaboratorName(event.target.value)}
              />
            </label>
            <label className="field-label">
              Tienda asignada
              <select
                className="field"
                disabled={activeStores.length === 0}
                required
                value={newCollaboratorStoreId}
                onChange={(event) => setNewCollaboratorStoreId(event.target.value)}
              >
                {activeStores.length === 0 && <option value="">Sin tiendas activas</option>}
                {activeStores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Día de descanso
              <select
                className="field"
                value={restDay}
                onChange={(event) => setRestDay(Number(event.target.value))}
              >
                {WEEKDAYS.map((weekday, index) => (
                  <option key={weekday} value={index}>{weekday}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Día de raya
              <select
                className="field"
                value={payCycleEndWeekday}
                onChange={(event) =>
                  setPayCycleEndWeekday(Number(event.target.value))
                }
              >
                {WEEKDAYS.map((weekday, index) => (
                  <option key={weekday} value={index}>{weekday}</option>
                ))}
              </select>
              <span className="text-xs font-normal leading-5 text-slate-500">
                Define el final del ciclo; el pago puede realizarse cualquier día.
              </span>
            </label>
            <label className="field-label">
              Pago semanal
              <div className="money-field">
                <span>$</span>
                <input
                  inputMode="decimal"
                  min="0"
                  placeholder="0.00"
                  required
                  step="0.01"
                  type="number"
                  value={weeklyPay}
                  onChange={(event) => setWeeklyPay(event.target.value)}
                />
              </div>
            </label>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              className="button-secondary w-full"
              disabled={saving}
              type="button"
              onClick={() => {
                setCollaboratorModalOpen(false)
                setEditingCollaborator(undefined)
              }}
            >
              Cancelar
            </button>
            <button
              className="button-primary w-full"
              disabled={!canMutateAdmin || saving || activeStores.length === 0}
              type="submit"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </AppModal>

      <AppModal
        closeLabel="Cerrar perfil"
        eyebrow="Perfil de colaborador"
        open={isAdmin && Boolean(selectedCollaborator)}
        title={selectedCollaborator?.name ?? ''}
        onClose={() => setSelectedCollaborator(undefined)}
      >
        {selectedCollaborator && (
          <>
            <dl className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4">
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-sm font-semibold text-slate-500">Tienda</dt>
                <dd className="min-w-0 text-right text-sm font-bold text-slate-900">
                  {storeNames.get(selectedCollaborator.storeId) ?? 'Sin identificar'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-sm font-semibold text-slate-500">Descanso</dt>
                <dd className="min-w-0 text-right text-sm font-bold text-slate-900">
                  {WEEKDAYS[selectedCollaborator.restDay]}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-sm font-semibold text-slate-500">Día de raya</dt>
                <dd className={`min-w-0 text-right text-sm font-bold ${selectedCollaborator.payCycleEndWeekday === undefined ? 'text-amber-700' : 'text-slate-900'}`}>
                  {selectedCollaborator.payCycleEndWeekday === undefined
                    ? 'Sin configurar'
                    : WEEKDAYS[selectedCollaborator.payCycleEndWeekday]}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-sm font-semibold text-slate-500">Pago semanal</dt>
                <dd className="min-w-0 text-right text-sm font-bold text-slate-900">
                  {selectedCollaborator.weeklyPay === undefined
                    ? 'Protegido en Supabase'
                    : currencyFormatter.format(selectedCollaborator.weeklyPay)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-sm font-semibold text-slate-500">Estado</dt>
                <dd className={`text-sm font-bold ${selectedCollaborator.status === 'active' ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {selectedCollaborator.status === 'active' ? 'Activo' : 'Inactivo'}
                </dd>
              </div>
            </dl>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                className="button-secondary w-full"
                type="button"
                onClick={() => setSelectedCollaborator(undefined)}
              >
                Cerrar
              </button>
              <button
                className="button-primary w-full"
                disabled={!canMutateAdmin}
                type="button"
                onClick={() => editCollaborator(selectedCollaborator)}
              >
                Editar
              </button>
              <button
                className="button-secondary col-span-2 w-full"
                disabled={!canMutateAdmin || saving}
                type="button"
                onClick={() => requestCollaboratorStatusChange(selectedCollaborator)}
              >
                {selectedCollaborator.status === 'active' ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </>
        )}
      </AppModal>

      <AppModal
        closeDisabled={saving}
        closeLabel="Cerrar confirmación"
        eyebrow="Administración"
        open={Boolean(statusChangeCollaborator)}
        title="Desactivar colaborador"
        onClose={() => setStatusChangeCollaborator(undefined)}
      >
        {statusChangeCollaborator && (
          <>
            <p className="mt-5 text-sm leading-6 text-slate-600">
              Ya no podrá registrar nuevas asistencias ni generar nuevos días por pagar.
              Los días trabajados pendientes sí podrán liquidarse.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                className="button-secondary"
                disabled={saving}
                type="button"
                onClick={() => setStatusChangeCollaborator(undefined)}
              >
                Cancelar
              </button>
              <button
                className="button-primary"
                disabled={!canMutateAdmin || saving}
                type="button"
                onClick={() => void changeCollaboratorStatus(statusChangeCollaborator)}
              >
                {saving ? 'Desactivando…' : 'Desactivar'}
              </button>
            </div>
          </>
        )}
      </AppModal>
    </section>
  )
}
