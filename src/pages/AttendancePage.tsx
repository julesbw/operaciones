import { useEffect, useMemo, useState } from 'react'
import {
  ALL_STORES,
  StoreScopeSelector,
  type StoreScopeValue,
} from '../components/filters/StoreScopeSelector'
import {
  CheckIcon,
  MoonIcon,
  StoreIcon,
  UsersIcon,
  XIcon,
} from '../components/icons'
import type {
  AttendanceStatus,
  Collaborator,
  Store,
  UserProfile,
} from '../domain/models'
import { attendanceService } from '../services/attendanceService'
import { referenceDataService } from '../services/referenceDataService'
import { syncService } from '../services/syncService'
import { getOperationalDate, getWeekday } from '../utils/date'

type AttendancePageProps = {
  embedded?: boolean
  stores: Store[]
  storeFilter: StoreScopeValue
  user: UserProfile
  onDataChanged: () => void
  onStoreFilterChange: (value: StoreScopeValue) => void
}

const STATUS_OPTIONS: Array<{
  value: AttendanceStatus
  label: string
  icon: typeof CheckIcon
}> = [
  { value: 'present', label: 'Presente', icon: CheckIcon },
  { value: 'absent', label: 'Ausente', icon: XIcon },
  { value: 'rest_day', label: 'Descanso', icon: MoonIcon },
]

function initials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
}

export function AttendancePage({
  embedded = false,
  stores,
  storeFilter,
  user,
  onDataChanged,
  onStoreFilterChange,
}: AttendancePageProps) {
  const operationalDate = getOperationalDate()
  const [date, setDate] = useState(operationalDate)
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  const activeStores = useMemo(
    () => stores.filter((store) => store.status === 'active'),
    [stores],
  )
  const assignedStore = stores.find((store) => store.id === user.storeId)
  const isGlobalView = user.role === 'admin' && storeFilter === ALL_STORES
  const effectiveStoreId =
    user.role === 'cashier'
      ? user.storeId
      : storeFilter === ALL_STORES
        ? undefined
        : storeFilter

  useEffect(() => {
    if (
      user.role === 'admin' &&
      storeFilter !== ALL_STORES &&
      !stores.some(
        (store) => store.id === storeFilter && store.status === 'active',
      )
    ) {
      onStoreFilterChange(ALL_STORES)
    }
  }, [onStoreFilterChange, storeFilter, stores, user.role])

  useEffect(() => {
    if (user.role === 'cashier' && !effectiveStoreId) {
      setCollaborators([])
      setStatuses({})
      setError('Tu perfil no tiene una tienda asignada.')
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setSaved(false)
    setError(undefined)

    void Promise.all([
      referenceDataService.listCollaborators(effectiveStoreId),
      attendanceService.list(effectiveStoreId, date),
    ])
      .then(([people, records]) => {
        if (!active) return

        const allowedStoreIds = new Set(
          user.role === 'cashier'
            ? user.storeId
              ? [user.storeId]
              : []
            : activeStores.map((store) => store.id),
        )
        const visiblePeople = people.filter((person) =>
          allowedStoreIds.has(person.storeId) && person.status === 'active',
        )
        const existing = new Map(
          records.map((record) => [record.collaboratorId, record.status]),
        )
        const weekday = getWeekday(date)
        setCollaborators(visiblePeople)
        setStatuses(
          Object.fromEntries(
            visiblePeople.map((person) => [
              person.id,
              existing.get(person.id) ??
                (person.restDay === weekday ? 'rest_day' : 'present'),
            ]),
          ),
        )
      })
      .catch((cause: unknown) => {
        console.error('No fue posible cargar la asistencia', cause)
        if (active) setError('No fue posible cargar la lista de colaboradores.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [activeStores, date, effectiveStoreId, user.role, user.storeId])

  const presentCount = useMemo(
    () => Object.values(statuses).filter((status) => status === 'present').length,
    [statuses],
  )

  const groups = useMemo(() => {
    if (isGlobalView) {
      return activeStores
        .map((store) => ({
          store,
          people: collaborators.filter(
            (collaborator) => collaborator.storeId === store.id,
          ),
        }))
        .filter((group) => group.people.length > 0)
    }

    const store = stores.find((candidate) => candidate.id === effectiveStoreId)
    return [{ store, people: collaborators }]
  }, [activeStores, collaborators, effectiveStoreId, isGlobalView, stores])

  async function save() {
    setSaving(true)
    setError(undefined)
    try {
      await attendanceService.save(
        collaborators.map((collaborator) => ({
          collaboratorId: collaborator.id,
          storeId: collaborator.storeId,
          attendanceDate: date,
          status: statuses[collaborator.id] ?? 'present',
        })),
        user.id,
      )
      setSaved(true)
      onDataChanged()
      void syncService
        .process()
        .then(onDataChanged)
        .catch((cause: unknown) => {
          console.error('No fue posible sincronizar la asistencia', cause)
        })
    } catch (cause: unknown) {
      console.error('No fue posible guardar la asistencia', cause)
      setError(
        cause instanceof Error &&
          cause.message.includes('FUTURE_ATTENDANCE_NOT_ALLOWED')
          ? 'No se pueden registrar asistencias futuras.'
          : cause instanceof Error &&
              cause.message.includes('COLLABORATOR_INACTIVE')
            ? 'El colaborador está inactivo y no puede generar nuevas asistencias.'
          : 'No fue posible guardar la asistencia en este dispositivo.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          {!embedded && <h1 className="page-title">Asistencias</h1>}
          {user.role === 'cashier' && (
            <p className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800">
              <StoreIcon className="size-4 shrink-0" />
              {assignedStore?.name ?? user.storeName ?? 'Tienda sin asignar'}
            </p>
          )}
        </div>
        {user.role !== 'admin' && (
          <input
            aria-label="Fecha"
            className="compact-field"
            max={operationalDate}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </div>

      {user.role === 'admin' && (
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">
              Vista
            </p>
            <StoreScopeSelector
              ariaLabel="Filtrar asistencia por tienda"
              assignedStoreId={user.storeId}
              role={user.role}
              stores={stores}
              value={storeFilter}
              onChange={onStoreFilterChange}
            />
          </div>
          <input
            aria-label="Fecha"
            className="compact-field shrink-0"
            max={operationalDate}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_250px]">
        <div className="panel p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-extrabold text-slate-950">
                {isGlobalView ? 'Todas las tiendas' : 'Lista del día'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">Toca un estado para cambiarlo.</p>
            </div>
            <span className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700">
              {presentCount} presentes
            </span>
          </div>

          {error && <p className="alert-error m-5">{error}</p>}
          {loading && <p className="empty-state">Preparando la lista…</p>}
          {!loading && collaborators.length === 0 && !error && (
            <p className="empty-state">
              {isGlobalView
                ? 'No hay colaboradores activos en las tiendas disponibles.'
                : 'No hay colaboradores activos en esta tienda.'}
            </p>
          )}

          {!loading && groups.map((group) => (
            <div key={group.store?.id ?? 'current-store'}>
              {isGlobalView && group.store && (
                <div className="flex items-center justify-between border-y border-slate-100 bg-slate-50 px-5 py-3 first:border-t-0 sm:px-6">
                  <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.1em] text-slate-600">
                    <StoreIcon className="size-4 text-teal-700" />
                    {group.store.name}
                  </p>
                  <span className="text-xs font-semibold text-slate-400">
                    {group.people.length}
                  </span>
                </div>
              )}
              <div className="divide-y divide-slate-100">
                {group.people.map((collaborator) => (
                  <article
                    className="px-5 py-4 sm:px-6 xl:flex xl:items-center xl:justify-between xl:gap-5"
                    key={collaborator.id}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-600">
                        {initials(collaborator.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900">{collaborator.name}</p>
                        {collaborator.restDay === getWeekday(date) && (
                          <p className="mt-0.5 text-xs font-semibold text-amber-700">Día de descanso</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid w-full grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 xl:mt-0 xl:w-[348px] xl:shrink-0">
                      {STATUS_OPTIONS.map((option) => {
                        const Icon = option.icon
                        const active = statuses[collaborator.id] === option.value
                        return (
                          <button
                            aria-pressed={active}
                            className={active ? `attendance-${option.value}` : 'attendance-option'}
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setSaved(false)
                              setStatuses((current) => ({
                                ...current,
                                [collaborator.id]: option.value,
                              }))
                            }}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span className="hidden min-[420px]:inline">{option.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>

        <aside className="space-y-4">
          <article className="panel">
            <span className="stat-icon bg-amber-50 text-amber-700">
              <UsersIcon className="size-5" />
            </span>
            <p className="mt-4 text-sm font-semibold text-slate-500">Avance</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-slate-950">
              {collaborators.length}/{collaborators.length}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Todos tienen un estado asignado automáticamente.
            </p>
          </article>
          <button
            className="button-primary w-full"
            disabled={saving || loading || collaborators.length === 0}
            type="button"
            onClick={() => void save()}
          >
            <CheckIcon className="size-4" />
            {saving ? 'Guardando…' : saved ? 'Asistencia guardada' : 'Guardar asistencia'}
          </button>
          {saved && (
            <p className="alert-success justify-center text-center">Guardado en este dispositivo.</p>
          )}
        </aside>
      </div>
    </section>
  )
}
