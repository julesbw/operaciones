import { useEffect, useMemo, useState } from 'react'
import { CheckIcon, MoonIcon, UsersIcon, XIcon } from '../components/icons'
import type {
  AttendanceStatus,
  Collaborator,
  Store,
  UserProfile,
} from '../domain/models'
import { attendanceService } from '../services/attendanceService'
import { referenceDataService } from '../services/referenceDataService'
import { syncService } from '../services/syncService'
import { formatLongDate, getLocalDate, getWeekday } from '../utils/date'

type AttendancePageProps = {
  stores: Store[]
  user: UserProfile
  onDataChanged: () => void
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

export function AttendancePage({ stores, user, onDataChanged }: AttendancePageProps) {
  const [storeId, setStoreId] = useState(
    user.storeId ?? stores.find((store) => store.status === 'active')?.id ?? '',
  )
  const [date, setDate] = useState(getLocalDate())
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!storeId) return
    let active = true
    setLoading(true)
    setSaved(false)

    void Promise.all([
      referenceDataService.listCollaborators(storeId),
      attendanceService.list(storeId, date),
    ])
      .then(([people, records]) => {
        if (!active) return
        const existing = new Map(records.map((record) => [record.collaboratorId, record.status]))
        const weekday = getWeekday(date)
        setCollaborators(people)
        setStatuses(
          Object.fromEntries(
            people.map((person) => [
              person.id,
              existing.get(person.id) ?? (person.restDay === weekday ? 'rest_day' : 'present'),
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
  }, [date, storeId])

  const presentCount = useMemo(
    () => Object.values(statuses).filter((status) => status === 'present').length,
    [statuses],
  )

  async function save() {
    setSaving(true)
    setError(undefined)
    try {
      await attendanceService.save(
        collaborators.map((collaborator) => ({
          collaboratorId: collaborator.id,
          storeId,
          attendanceDate: date,
          status: statuses[collaborator.id] ?? 'present',
        })),
        user.id,
      )
      setSaved(true)
      onDataChanged()
      void syncService.process().then(onDataChanged)
    } catch (cause: unknown) {
      console.error('No fue posible guardar la asistencia', cause)
      setError('No fue posible guardar la asistencia en este dispositivo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Equipo de tienda</p>
          <h1 className="page-title mt-2">Asistencias</h1>
          <p className="page-subtitle">{formatLongDate(date)}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {user.role === 'admin' && (
            <select className="compact-field" aria-label="Tienda" value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              {stores.filter((store) => store.status === 'active').map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          )}
          <input className="compact-field" aria-label="Fecha" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_250px]">
        <div className="panel p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-extrabold text-slate-950">Lista del día</h2>
              <p className="mt-1 text-xs text-slate-500">Toca un estado para cambiarlo.</p>
            </div>
            <span className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700">
              {presentCount} presentes
            </span>
          </div>

          {error && <p className="alert-error m-5">{error}</p>}
          {loading && <p className="empty-state">Preparando la lista…</p>}
          {!loading && collaborators.length === 0 && (
            <p className="empty-state">No hay colaboradores activos en esta tienda.</p>
          )}

          <div className="divide-y divide-slate-100">
            {collaborators.map((collaborator) => (
              <article className="px-5 py-4 sm:flex sm:items-center sm:justify-between sm:gap-5 sm:px-6" key={collaborator.id}>
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-600">
                    {collaborator.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}
                  </span>
                  <div>
                    <p className="font-bold text-slate-900">{collaborator.name}</p>
                    {collaborator.restDay === getWeekday(date) && (
                      <p className="mt-0.5 text-xs font-semibold text-amber-700">Día de descanso</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 sm:mt-0 sm:w-[295px]">
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
                          setStatuses({ ...statuses, [collaborator.id]: option.value })
                        }}
                      >
                        <Icon className="size-4" />
                        <span className="hidden min-[420px]:inline">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </article>
            ))}
          </div>
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
          <button className="button-primary w-full" disabled={saving || loading || collaborators.length === 0} type="button" onClick={() => void save()}>
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
