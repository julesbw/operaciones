import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckIcon, PlusIcon, StoreIcon, UsersIcon, XIcon } from '../components/icons'
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

type SettingsTab = 'stores' | 'team'

type SettingsPageProps = {
  stores: Store[]
  user: UserProfile
  onStoresChanged: () => void
}

export function SettingsPage({ stores, user, onStoresChanged }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>('stores')
  const [newStoreName, setNewStoreName] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editingName, setEditingName] = useState('')
  const [teamStoreFilter, setTeamStoreFilter] =
    useState<StoreFilterValue>(ALL_STORES)
  const [newCollaboratorStoreId, setNewCollaboratorStoreId] = useState(
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
  const [message, setMessage] = useState<string>()
  const canMutate = user.demo || (!isSupabaseConfigured ? false : navigator.onLine)
  const activeStores = stores.filter((store) => store.status === 'active')

  useEffect(() => {
    const selectableStores = stores.filter((store) => store.status === 'active')
    if (
      !selectableStores.some(
        (store) => store.id === newCollaboratorStoreId,
      )
    ) {
      setNewCollaboratorStoreId(selectableStores[0]?.id ?? '')
    }
    if (
      teamStoreFilter !== ALL_STORES &&
      !selectableStores.some((store) => store.id === teamStoreFilter)
    ) {
      setTeamStoreFilter(ALL_STORES)
    }
  }, [newCollaboratorStoreId, stores, teamStoreFilter])

  useEffect(() => {
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
  }, [stores, teamStoreFilter])

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
    setError(undefined)
    setMessage(undefined)
    try {
      await storeService.create(newStoreName)
      setNewStoreName('')
      onStoresChanged()
    } catch (cause: unknown) {
      console.error('No fue posible crear la tienda', cause)
      setError(cause instanceof Error ? cause.message : 'No fue posible crear la tienda.')
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
    setError(undefined)
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
      setMessage(`${collaborator.name} se añadió al equipo.`)
    } catch (cause: unknown) {
      console.error('No fue posible crear el colaborador', cause)
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible crear el colaborador.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto max-w-5xl">
      <div>
        <p className="eyebrow">Administración</p>
        <h1 className="page-title mt-2">Ajustes</h1>
        <p className="page-subtitle">Tiendas y equipo de trabajo.</p>
      </div>

      <div className="mt-7 flex gap-2 border-b border-slate-200">
        <button className={tab === 'stores' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('stores')}>
          <StoreIcon className="size-4" /> Tiendas
        </button>
        <button className={tab === 'team' ? 'tab-active' : 'tab-item'} type="button" onClick={() => setTab('team')}>
          <UsersIcon className="size-4" /> Colaboradores
        </button>
      </div>

      {error && <p className="alert-error mt-6">{error}</p>}
      {message && <p className="alert-success mt-6">{message}</p>}
      {!canMutate && (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Los cambios administrativos requieren conexión.
        </p>
      )}

      {tab === 'stores' && (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_320px]">
          <article className="panel p-0">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 className="font-extrabold text-slate-950">Tiendas registradas</h2>
              <p className="mt-1 text-xs text-slate-500">Los históricos conservan la relación aunque cambie el nombre.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {stores.map((store) => (
                <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6" key={store.id}>
                  <span className={`flex size-10 items-center justify-center rounded-xl ${store.status === 'active' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-400'}`}>
                    <StoreIcon className="size-5" />
                  </span>
                  <div className="min-w-[180px] flex-1">
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
              ))}
            </div>
          </article>

          <form className="panel" onSubmit={createStore}>
            <span className="stat-icon bg-teal-50 text-teal-700"><PlusIcon className="size-5" /></span>
            <h2 className="mt-4 text-xl font-extrabold text-slate-950">Nueva tienda</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Crea la entidad una vez y úsala en todos los formularios.</p>
            <label className="field-label mt-5">Nombre
              <input className="field" maxLength={100} placeholder="Ej. Tienda Sur" required value={newStoreName} onChange={(event) => setNewStoreName(event.target.value)} />
            </label>
            <button className="button-primary mt-5 w-full" disabled={!canMutate || saving} type="submit">
              <PlusIcon className="size-4" /> Crear tienda
            </button>
          </form>
        </div>
      )}

      {tab === 'team' && (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_320px]">
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
                    : 'Usa el formulario para añadir el primero.'}
                </p>
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

          <form className="panel" onSubmit={createCollaborator}>
            <span className="stat-icon bg-teal-50 text-teal-700"><PlusIcon className="size-5" /></span>
            <h2 className="mt-4 text-xl font-extrabold text-slate-950">Nuevo colaborador</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Registra su asignación y condiciones actuales.</p>

            <label className="field-label mt-5">Nombre completo
              <input
                className="field"
                maxLength={120}
                placeholder="Ej. Ana López"
                required
                value={newCollaboratorName}
                onChange={(event) => setNewCollaboratorName(event.target.value)}
              />
            </label>
            <label className="field-label mt-4">Tienda asignada
              <select
                className="field"
                disabled={activeStores.length === 0}
                required
                value={newCollaboratorStoreId}
                onChange={(event) => setNewCollaboratorStoreId(event.target.value)}
              >
                {activeStores.length === 0 && <option value="">Sin tiendas activas</option>}
                {activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            <label className="field-label mt-4">Día de descanso
              <select className="field" value={restDay} onChange={(event) => setRestDay(Number(event.target.value))}>
                {WEEKDAYS.map((weekday, index) => <option key={weekday} value={index}>{weekday}</option>)}
              </select>
            </label>
            <label className="field-label mt-4">Pago semanal
              <input
                className="field"
                inputMode="decimal"
                min="0"
                placeholder="0.00"
                required
                step="0.01"
                type="number"
                value={weeklyPay}
                onChange={(event) => setWeeklyPay(event.target.value)}
              />
            </label>
            <button
              className="button-primary mt-5 w-full"
              disabled={!canMutate || saving || activeStores.length === 0}
              type="submit"
            >
              <PlusIcon className="size-4" /> {saving ? 'Guardando…' : 'Añadir colaborador'}
            </button>
          </form>
        </div>
      )}

      {selectedCollaborator && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setSelectedCollaborator(undefined)}
        >
          <section
            aria-labelledby="collaborator-profile-title"
            aria-modal="true"
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Perfil de colaborador</p>
                <h2 className="mt-2 text-2xl font-black text-slate-950" id="collaborator-profile-title">
                  {selectedCollaborator.name}
                </h2>
              </div>
              <button
                aria-label="Cerrar perfil"
                className="icon-button"
                type="button"
                onClick={() => setSelectedCollaborator(undefined)}
              >
                <XIcon className="size-4" />
              </button>
            </div>
            <dl className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4">
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-sm font-semibold text-slate-500">Tienda</dt>
                <dd className="text-sm font-bold text-slate-900">
                  {storeNames.get(selectedCollaborator.storeId) ?? 'Sin identificar'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-sm font-semibold text-slate-500">Descanso</dt>
                <dd className="text-sm font-bold text-slate-900">
                  {WEEKDAYS[selectedCollaborator.restDay]}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-sm font-semibold text-slate-500">Pago semanal</dt>
                <dd className="text-sm font-bold text-slate-900">
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
          </section>
        </div>
      )}
    </section>
  )
}
