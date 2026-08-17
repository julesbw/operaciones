import { useEffect, useState } from 'react'
import type { Store, UserProfile } from '../domain/models'
import { ArrowIcon, CashIcon, ReceiptIcon, UsersIcon } from '../components/icons'
import type { PageId } from '../components/AppShell'
import { attendanceService } from '../services/attendanceService'
import { expenseService } from '../services/expenseService'
import { getLocalDate } from '../utils/date'
import { currencyFormatter } from '../utils/money'

const HOME_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

type DashboardPageProps = {
  pendingCount: number
  revision: number
  stores: Store[]
  user: UserProfile
  onNavigate: (page: PageId) => void
}

export function DashboardPage({
  pendingCount,
  revision,
  stores,
  user,
  onNavigate,
}: DashboardPageProps) {
  const [todayExpenses, setTodayExpenses] = useState(0)
  const [attendanceCount, setAttendanceCount] = useState(0)
  const today = getLocalDate()
  const firstName = user.fullName.trim().split(/\s+/)[0] || 'bienvenido'

  useEffect(() => {
    const storeIds = user.storeId
      ? [user.storeId]
      : stores.filter((store) => store.status === 'active').map((store) => store.id)
    void Promise.all(
      storeIds.map(async (storeId) => {
        const [expenseTotal, attendance] = await Promise.all([
          expenseService.totalForDay(storeId, today),
          attendanceService.list(storeId, today),
        ])
        return { expenseTotal, attendanceCount: attendance.length }
      }),
    ).then((summaries) => {
      setTodayExpenses(
        summaries.reduce((total, summary) => total + summary.expenseTotal, 0),
      )
      setAttendanceCount(
        summaries.reduce((total, summary) => total + summary.attendanceCount, 0),
      )
    })
  }, [revision, stores, today, user.storeId])

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.16em] text-teal-700 sm:text-xs">
            {HOME_DATE_FORMATTER.format(new Date(`${today}T12:00:00`))}
          </p>
          <h1 className="page-title">Hola, {firstName}</h1>
        </div>
        {user.demo && <span className="demo-badge">Vista de demostración</span>}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <article className="stat-card">
          <span className="stat-icon bg-teal-50 text-teal-700">
            <ReceiptIcon className="size-5" />
          </span>
          <div>
            <p className="stat-label">Gastos de hoy</p>
            <p className="stat-value">{currencyFormatter.format(todayExpenses)}</p>
          </div>
        </article>
        <article className="stat-card">
          <span className="stat-icon bg-amber-50 text-amber-700">
            <UsersIcon className="size-5" />
          </span>
          <div>
            <p className="stat-label">Asistencias</p>
            <p className="stat-value">{attendanceCount || 'Pendiente'}</p>
          </div>
        </article>
        <article className="stat-card">
          <span className="stat-icon bg-slate-100 text-slate-700">
            <ArrowIcon className="size-5 -rotate-45" />
          </span>
          <div>
            <p className="stat-label">Por sincronizar</p>
            <p className="stat-value">{pendingCount}</p>
          </div>
        </article>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <article className="hero-card">
          <div className="relative z-[1] max-w-lg">
            <span className="eyebrow-light">Acción rápida</span>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-white">
              Registra un gasto en menos de un minuto.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-teal-50/75">
              Sólo necesitamos el monto, el concepto y cómo se pagó. La tienda y la fecha ya están listas.
            </p>
            <button
              className="button-light mt-7"
              type="button"
              onClick={() => onNavigate('expenses')}
            >
              Nuevo gasto
              <ArrowIcon className="size-4" />
            </button>
          </div>
          <div className="hero-receipt" aria-hidden="true">
            <ReceiptIcon className="size-24" />
          </div>
        </article>

        <article className="panel flex flex-col">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Siguiente paso</p>
              <h2 className="mt-2 text-xl font-extrabold text-slate-950">
                Asistencia del día
              </h2>
            </div>
            <span className="stat-icon bg-amber-50 text-amber-700">
              <UsersIcon className="size-5" />
            </span>
          </div>
          <p className="mt-4 flex-1 text-sm leading-6 text-slate-500">
            Marca quién llegó hoy. Los días de descanso se identifican automáticamente.
          </p>
          <button
            className="text-action mt-6"
            type="button"
            onClick={() => onNavigate('collaborators')}
          >
            {attendanceCount > 0 ? 'Revisar registro' : 'Tomar asistencia'}
            <ArrowIcon className="size-4" />
          </button>
        </article>
      </div>

      {user.role === 'admin' && (
        <button
          className="mt-5 flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          type="button"
          onClick={() => onNavigate('closings')}
        >
          <span className="stat-icon bg-slate-900 text-white">
            <CashIcon className="size-5" />
          </span>
          <span className="flex-1">
            <span className="block font-extrabold text-slate-950">Preparar corte de caja</span>
            <span className="mt-1 block text-sm text-slate-500">
              Importa los gastos del día y cuenta el efectivo.
            </span>
          </span>
          <ArrowIcon className="size-5 text-slate-400" />
        </button>
      )}
    </section>
  )
}
