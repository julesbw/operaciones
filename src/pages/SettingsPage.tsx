import { useEffect, useState, type FormEvent } from 'react'
import { CheckIcon, PlusIcon, StoreIcon, UsersIcon, XIcon } from '../components/icons'
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
  const [selectedStoreId, setSelectedStoreId] = useState(stores[0]?.id ?? '')
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
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
    if (selectableStores.some((store) => store.id === selectedStoreId)) return
    setSelectedStoreId(selectableStores[0]?.id ?? '')
  }, [stores, selectedStoreId])

  useEffect(() => {
    if (!selectedStoreId) {
      setCollaborators([])
      return
    }
    void referenceDataService
      .listCollaborators(selectedStoreId)
      .then(setCollaborators)
      .catch((cause: unknown) => {
        console.error('No fue posible cargar colaboradores', cause)
        setError('No fue posible cargar el equipo.')
      })
  }, [selectedStoreId])

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
        storeId: selectedStoreId,
        restDay,
        weeklyPay: weeklyPay.trim() ? Number(weeklyPay) : Number.NaN,
      })
      setCollaborators((current) => [...current, collaborator])
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
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold text-slate-950">Equipo activo</h2>
                <p className="mt-1 text-sm text-slate-500">La información de pago sólo está disponible para administración.</p>
              </div>
              <select
                aria-label="Filtrar colaboradores por tienda"
                className="compact-field"
                disabled={activeStores.length === 0}
                value={selectedStoreId}
                onChange={(event) => setSelectedStoreId(event.target.value)}
              >
                {activeStores.length === 0 && <option value="">Sin tiendas activas</option>}
                {activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </div>
            {activeStores.length === 0 ? (
              <div className="panel mt-5 border-dashed text-center">
                <StoreIcon className="mx-auto size-8 text-slate-300" />
                <p className="mt-3 font-bold text-slate-700">Primero crea una tienda activa</p>
                <p className="mt-1 text-sm text-slate-500">Cada colaborador debe pertenecer a una tienda.</p>
              </div>
            ) : collaborators.length === 0 ? (
              <div className="panel mt-5 border-dashed text-center">
                <UsersIcon className="mx-auto size-8 text-slate-300" />
                <p className="mt-3 font-bold text-slate-700">Aún no hay colaboradores</p>
                <p className="mt-1 text-sm text-slate-500">Usa el formulario para añadir el primero.</p>
              </div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {collaborators.map((collaborator) => (
                  <article className="panel" key={collaborator.id}>
                    <div className="flex items-start gap-3">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-black text-teal-700">
                        {collaborator.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-slate-950">{collaborator.name}</h3>
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
                value={selectedStoreId}
                onChange={(event) => setSelectedStoreId(event.target.value)}
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
    </section>
  )
}
