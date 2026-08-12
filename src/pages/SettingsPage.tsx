import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AppModal } from '../components/AppModal'
import { CheckIcon, PlusIcon, SettingsIcon, StoreIcon, UsersIcon, XIcon } from '../components/icons'
import {
  ALL_STORES,
  StoreFilter,
  type StoreFilterValue,
} from '../components/StoreFilter'
import type { Collaborator, Store, UserProfile } from '../domain/models'
import { isSupabaseConfigured } from '../lib/supabase'
import { collaboratorService } from '../services/collaboratorService'
import { referenceDataService } from '../services/referenceDataService'
import { storeService } from '../services/storeService'
import { WEEKDAYS } from '../domain/constants'
import { currencyFormatter } from '../utils/money'

type SettingsTab = 'stores' | 'team' | 'system'

type SettingsPageProps = {
  stores: Store[]
  user: UserProfile
  onStoresChanged: () => void
}

const buildTime = new Date(import.meta.env.BUILD_TIME)
const buildTimeLabel = Number.isNaN(buildTime.getTime())
  ? import.meta.env.BUILD_TIME
  : new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'long',
    }).format(buildTime)

export function SettingsPage({ stores, user, onStoresChanged }: SettingsPageProps) {
  const isAdmin = user.role === 'admin'
  const [tab, setTab] = useState<SettingsTab>(isAdmin ? 'stores' : 'system')
  const [storeModalOpen, setStoreModalOpen] = useState(false)
  const [collaboratorModalOpen, setCollaboratorModalOpen] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editingName, setEditingName] = useState('')
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
  const [newCollaboratorName, setNewCollaboratorName] = useState('')
  const [restDay, setRestDay] = useState(0)
  const [weeklyPay, setWeeklyPay] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [creationError, setCreationError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const storeFabRef = useRef<HTMLButtonElement>(null)
  const collaboratorFabRef = useRef<HTMLButtonElement>(null)
  const storeNameInputRef = useRef<HTMLInputElement>(null)
  const collaboratorNameInputRef = useRef<HTMLInputElement>(null)
  const canMutate = isAdmin && (user.demo || (!isSupabaseConfigured ? false : navigator.onLine))
  const activeStores = stores.filter((store) => store.status === 'active')

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
    if (!isAdmin) {
      setCollaborators([])
      return
    }
    const requestedStoreId =
      teamStoreFilter === ALL_STORES ? undefined : teamStoreFilter
    void referenceDataService
      .listCollaborators(requestedStoreId)
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
  }, [isAdmin, stores, teamStoreFilter])

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

  async function createCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setCreationError(undefined)
    setMessage(undefined)
    try {
      const collaborator = await collaboratorService.create({
        name: newCollaboratorName,
        storeId: newCollaboratorStoreId,
        restDay,
        weeklyPay: weeklyPay.trim() ? Number(weeklyPay) : Number.NaN,
      })
      if (
        teamStoreFilter === ALL_STORES ||
        teamStoreFilter === collaborator.storeId
      ) {
        setCollaborators((current) => [...current, collaborator])
      }
      setNewCollaboratorName('')
      setWeeklyPay('')
      setCollaboratorModalOpen(false)
      setMessage(`${collaborator.name} se añadió al equipo.`)
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
    setWeeklyPay('')
    setCreationError(undefined)
    setCollaboratorModalOpen(true)
  }

  return (
    <section className="mx-auto max-w-5xl">
      <div>
        <p className="eyebrow">{isAdmin ? 'Administración' : 'Cuenta'}</p>
        <h1 className="page-title mt-2">Ajustes</h1>
        <p className="page-subtitle">
          {isAdmin ? 'Tiendas, equipo e información de la aplicación.' : 'Información de la aplicación.'}
        </p>
      </div>

      <div className="mt-7 flex max-w-full gap-2 overflow-x-auto overscroll-x-contain border-b border-slate-200">
        {isAdmin && (
          <>
            <button className={tab === 'stores' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('stores')}>
              <StoreIcon className="size-4" /> Tiendas
            </button>
            <button className={tab === 'team' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('team')}>
              <UsersIcon className="size-4" /> Colaboradores
            </button>
          </>
        )}
        <button className={tab === 'system' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('system')}>
          <SettingsIcon className="size-4" /> Sistema
        </button>
      </div>

      {isAdmin && tab !== 'system' && error && <p className="alert-error mt-6">{error}</p>}
      {isAdmin && tab !== 'system' && message && <p className="alert-success mt-6">{message}</p>}
      {isAdmin && tab !== 'system' && !canMutate && (
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
                    disabled={!canMutate}
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
                          <button className="small-button" disabled={!canMutate || saving} type="button" onClick={() => { setEditingId(store.id); setEditingName(store.name) }}>Editar</button>
                          <button className="small-button" disabled={!canMutate || saving} type="button" onClick={() => void toggleStore(store)}>{store.status === 'active' ? 'Desactivar' : 'Activar'}</button>
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
              <h2 className="text-xl font-extrabold text-slate-950">Equipo activo</h2>
              <p className="mt-1 text-sm text-slate-500">Busca perfiles y cambia de tienda sin salir de esta vista.</p>
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
                    disabled={!canMutate}
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
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-black text-teal-700">
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
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Activo</span>
                    </div>
                    <div className="mt-5 rounded-xl bg-slate-50 p-3.5">
                      <p className="text-xs font-semibold text-slate-500">Pago semanal</p>
                      <p className="mt-1 font-extrabold text-slate-900">
                        {collaborator.weeklyPay === undefined ? 'Protegido en Supabase' : currencyFormatter.format(collaborator.weeklyPay)}
                      </p>
                    </div>
                    <button
                      className="small-button mt-4 w-full"
                      type="button"
                      onClick={() => setSelectedCollaborator(collaborator)}
                    >
                      Ver perfil
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'system' && (
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
      )}

      {isAdmin && tab === 'stores' && (
        <button
          aria-label="Crear una tienda"
          className="app-fab"
          disabled={!canMutate || saving}
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
          disabled={!canMutate || saving || activeStores.length === 0}
          ref={collaboratorFabRef}
          title="Nuevo colaborador"
          type="button"
          onClick={openCollaboratorModal}
        >
          <PlusIcon className="size-7" />
        </button>
      )}

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
              disabled={!canMutate || saving}
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
        hasUnsavedChanges={
          newCollaboratorName.trim().length > 0 ||
          weeklyPay.trim().length > 0 ||
          restDay !== 0 ||
          newCollaboratorStoreId !== initialCollaboratorStoreId
        }
        initialFocusRef={collaboratorNameInputRef}
        open={collaboratorModalOpen}
        returnFocusRef={collaboratorFabRef}
        title="Nuevo colaborador"
        onClose={() => setCollaboratorModalOpen(false)}
      >
        <form onSubmit={createCollaborator}>
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
              onClick={() => setCollaboratorModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              className="button-primary w-full"
              disabled={!canMutate || saving || activeStores.length === 0}
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
                <dt className="text-sm font-semibold text-slate-500">Pago semanal</dt>
                <dd className="min-w-0 text-right text-sm font-bold text-slate-900">
                  {selectedCollaborator.weeklyPay === undefined
                    ? 'Protegido en Supabase'
                    : currencyFormatter.format(selectedCollaborator.weeklyPay)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-sm font-semibold text-slate-500">Estado</dt>
                <dd className="text-sm font-bold text-emerald-700">Activo</dd>
              </div>
            </dl>
            <button
              className="button-secondary mt-6 w-full"
              type="button"
              onClick={() => setSelectedCollaborator(undefined)}
            >
              Cerrar
            </button>
          </>
        )}
      </AppModal>
    </section>
  )
}
