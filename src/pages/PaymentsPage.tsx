import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { AppModal } from '../components/AppModal'
import { ListPageSkeleton } from '../components/Skeletons'
import {
  ALL_STORES,
  StoreScopeSelector,
  type StoreScopeValue,
} from '../components/filters/StoreScopeSelector'
import {
  ArrowIcon,
  CashIcon,
  CheckIcon,
  StoreIcon,
  WifiOffIcon,
} from '../components/icons'
import { WEEKDAYS } from '../domain/constants'
import {
  calculatePaymentSelection,
  getCalendarWeekday,
  getDefaultPaymentSelection,
  type CollaboratorPaymentPeriod,
  type CollaboratorPaymentState,
} from '../domain/paymentPolicy'
import type {
  Payment,
  PaymentAttendanceItem,
  PaymentFundingSource,
  Store,
  UserProfile,
} from '../domain/models'
import { isSupabaseConfigured } from '../lib/supabase'
import { connectivityService } from '../services/connectivityService'
import {
  paymentService,
  type ConfirmedPayment,
} from '../services/paymentService'
import { referenceDataService } from '../services/referenceDataService'
import { formatLongDate, getOperationalDate } from '../utils/date'
import { currencyFormatter } from '../utils/money'

type PaymentsTab = 'pending' | 'history'

type PaymentsPageProps = {
  embedded?: boolean
  stores: Store[]
  user: UserProfile
  dataRevision?: number
}

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
})
const PAYMENT_TIME_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
})

function shortDate(value: string): string {
  return SHORT_DATE_FORMATTER.format(new Date(`${value}T12:00:00`))
}

function periodLabel(period: Pick<CollaboratorPaymentPeriod, 'periodStart' | 'periodEnd'>) {
  return `${shortDate(period.periodStart)}–${shortDate(period.periodEnd)}`
}

function countPaymentPeriods(items: PaymentAttendanceItem[]): number {
  return new Set(items.map((item) => `${item.periodStart}:${item.periodEnd}`)).size
}

export function PaymentsPage({
  embedded = false,
  stores,
  user,
  dataRevision = 0,
}: PaymentsPageProps) {
  const [tab, setTab] = useState<PaymentsTab>('pending')
  const [storeFilter, setStoreFilter] =
    useState<StoreScopeValue>(ALL_STORES)
  const [states, setStates] = useState<CollaboratorPaymentState[]>([])
  const [history, setHistory] = useState<Payment[]>([])
  const [historyItems, setHistoryItems] = useState<PaymentAttendanceItem[]>([])
  const [selectedState, setSelectedState] =
    useState<CollaboratorPaymentState>()
  const [selectedHistory, setSelectedHistory] = useState<ConfirmedPayment>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [networkAvailable, setNetworkAvailable] = useState(
    connectivityService.isNetworkAvailable(),
  )

  const loadLocal = useCallback(async () => {
    const collaborators = await referenceDataService.listCollaborators(
      undefined,
      true,
    )
    const [nextStates, nextHistory] = await Promise.all([
      paymentService.listCollaboratorStates(collaborators),
      paymentService.listHistory(),
    ])
    const items = await Promise.all(
      nextHistory.map((payment) =>
        paymentService.getHistoryDetail(payment.id),
      ),
    )
    setStates(nextStates)
    setHistory(nextHistory)
    setHistoryItems(
      items.flatMap((detail) => detail?.items ?? []),
    )
  }, [dataRevision])

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      await paymentService.refreshRemote()
      await loadLocal()
    } catch (cause: unknown) {
      console.error('No fue posible actualizar pagos', cause)
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible actualizar los pagos.',
      )
    }
  }, [loadLocal])

  useEffect(() => {
    let active = true
    setLoading(true)
    void loadLocal()
      .catch((cause: unknown) => {
        if (!active) return
        console.error('No fue posible abrir pagos', cause)
        setError('No fue posible abrir los datos locales de pagos.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadLocal])

  useEffect(
    () =>
      connectivityService.subscribe((available) => {
        setNetworkAvailable(available)
        if (available) void refresh()
      }),
    [refresh],
  )

  const visibleStates = useMemo(
    () =>
      states.filter(
        (state) =>
          (storeFilter === ALL_STORES ||
            state.collaborator.storeId === storeFilter) &&
          state.pendingDays > 0 ||
          (state.collaborator.status === 'active' &&
            state.collaborator.payCycleEndWeekday === undefined),
      ),
    [states, storeFilter],
  )
  const visibleHistory = useMemo(
    () =>
      history.filter(
        (payment) =>
          storeFilter === ALL_STORES ||
          payment.collaboratorStoreIdSnapshot === storeFilter,
      ),
    [history, storeFilter],
  )
  const itemsByPayment = useMemo(() => {
    const grouped = new Map<string, PaymentAttendanceItem[]>()
    for (const item of historyItems) {
      const items = grouped.get(item.paymentId) ?? []
      items.push(item)
      grouped.set(item.paymentId, items)
    }
    return grouped
  }, [historyItems])

  async function openHistory(payment: Payment) {
    const detail = await paymentService.getHistoryDetail(payment.id)
    if (detail) setSelectedHistory(detail)
  }

  async function paymentConfirmed(confirmed: ConfirmedPayment) {
    setSelectedState(undefined)
    setMessage(
      `Pago de ${confirmed.payment.collaboratorNameSnapshot} confirmado.`,
    )
    await loadLocal()
  }

  if (user.role !== 'admin') return null

  return (
    <section className="mx-auto max-w-5xl">
      {!embedded && <h1 className="page-title">Pagos</h1>}

      {!networkAvailable && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <WifiOffIcon className="mt-0.5 size-5 shrink-0" />
          <p>
            Vista offline: puedes consultar y preparar el pago con los datos de
            este dispositivo. La información podría no incluir cambios de otros
            equipos y confirmar requiere conexión.
          </p>
        </div>
      )}
      {error && <p className="alert-error mt-5">{error}</p>}
      {message && <p className="alert-success mt-5">{message}</p>}

      <div className="mt-6 flex gap-2 border-b border-slate-200">
        <button
          className={tab === 'pending' ? 'tab-active' : 'tab-item'}
          type="button"
          onClick={() => setTab('pending')}
        >
          Pendientes
        </button>
        <button
          className={tab === 'history' ? 'tab-active' : 'tab-item'}
          type="button"
          onClick={() => setTab('history')}
        >
          Historial
        </button>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">
          Tienda asignada
        </p>
        <StoreScopeSelector
          ariaLabel="Filtrar pagos por tienda asignada"
          scope={{ kind: 'global' }}
          stores={stores}
          value={storeFilter}
          onChange={setStoreFilter}
        />
      </div>

      {loading && !error ? (
        <div className="panel mt-6 overflow-hidden p-0">
          <ListPageSkeleton rowsOnly rows={5} />
        </div>
      ) : tab === 'pending' ? (
        visibleStates.length === 0 ? (
          <div className="panel mt-6 border-dashed text-center">
            <CheckIcon className="mx-auto size-9 text-emerald-600" />
            <p className="mt-3 font-extrabold text-slate-800">
              No hay días trabajados pendientes
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {visibleStates.map((state) => {
              const collaborator = state.collaborator
              const unconfigured =
                collaborator.payCycleEndWeekday === undefined
              return (
                <article className="panel" key={collaborator.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-black text-slate-950">
                        {collaborator.name}
                      </h2>
                      <p
                        className={`mt-1 text-xs font-bold ${unconfigured ? 'text-amber-700' : 'text-slate-500'}`}
                      >
                        Día de raya:{' '}
                        {unconfigured
                          ? 'Sin configurar'
                          : WEEKDAYS[collaborator.payCycleEndWeekday!]}
                      </p>
                      {collaborator.status !== 'active' && (
                        <p className="mt-1 text-xs font-bold text-slate-400">
                          Inactivo · sólo días pendientes
                        </p>
                      )}
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                      {stores.find((store) => store.id === collaborator.storeId)
                        ?.name ?? 'Sin tienda'}
                    </span>
                  </div>
                  {unconfigured ? (
                    <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm leading-5 text-amber-900">
                      Configura su día de raya en Ajustes antes de registrar un
                      pago.
                    </p>
                  ) : (
                    <dl className="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
                      <div>
                        <dt className="text-[10px] font-bold uppercase text-slate-400">
                          Días
                        </dt>
                        <dd className="mt-1 font-black text-slate-900">
                          {state.pendingDays}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase text-slate-400">
                          Periodos
                        </dt>
                        <dd className="mt-1 font-black text-slate-900">
                          {state.pendingPeriods}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase text-slate-400">
                          Sugerido
                        </dt>
                        <dd className="mt-1 font-black text-teal-800">
                          {state.suggestedPending === undefined
                            ? '—'
                            : currencyFormatter.format(state.suggestedPending)}
                        </dd>
                      </div>
                    </dl>
                  )}
                  <button
                    className="button-primary mt-5 w-full"
                    disabled={
                      unconfigured ||
                      state.pendingDays === 0 ||
                      state.salaryHistoryMissing
                    }
                    type="button"
                    onClick={() => setSelectedState(state)}
                  >
                    Pagar
                  </button>
                  {state.salaryHistoryMissing && (
                    <p className="mt-2 text-xs text-red-700">
                      Falta historial salarial aplicable.
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )
      ) : visibleHistory.length === 0 ? (
        <p className="empty-state mt-6">Todavía no hay pagos confirmados.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {visibleHistory.map((payment) => {
            const items = itemsByPayment.get(payment.id) ?? []
            const sourceStore = stores.find(
              (store) => store.id === payment.sourceStoreId,
            )
            return (
              <button
                className="panel flex w-full items-center gap-4 text-left"
                key={payment.id}
                type="button"
                onClick={() => void openHistory(payment)}
              >
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">{shortDate(payment.businessDate)}</p>
                  <h2 className="mt-1 truncate font-black text-slate-950">
                    {payment.collaboratorNameSnapshot}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {items.length} días · {countPaymentPeriods(items)} periodos ·{' '}
                    {payment.fundingSource === 'central_cash'
                      ? 'Caja central'
                      : sourceStore?.name ?? 'Caja de tienda'}
                  </p>
                  <div className="mt-3 flex gap-5 text-sm">
                    <span>
                      <span className="block text-xs text-slate-400">Sugerido</span>
                      <strong>{currencyFormatter.format(payment.suggestedAmount)}</strong>
                    </span>
                    <span>
                      <span className="block text-xs text-slate-400">Pagado</span>
                      <strong>{currencyFormatter.format(payment.paidAmount)}</strong>
                    </span>
                  </div>
                </div>
                <ArrowIcon className="size-5 shrink-0 text-slate-400" />
              </button>
            )
          })}
        </div>
      )}

      <PaymentFormModal
        key={selectedState?.collaborator.id ?? 'closed-payment-form'}
        onlineConfirmationAvailable={
          networkAvailable && isSupabaseConfigured
        }
        openState={selectedState}
        stores={stores}
        onClose={() => setSelectedState(undefined)}
        onConfirmed={(confirmed) => void paymentConfirmed(confirmed)}
      />
      <PaymentHistoryModal
        detail={selectedHistory}
        stores={stores}
        onClose={() => setSelectedHistory(undefined)}
      />
    </section>
  )
}

function PaymentFormModal({
  onlineConfirmationAvailable,
  openState,
  stores,
  onClose,
  onConfirmed,
}: {
  onlineConfirmationAvailable: boolean
  openState?: CollaboratorPaymentState
  stores: Store[]
  onClose: () => void
  onConfirmed: (payment: ConfirmedPayment) => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set())
  const [paidAmount, setPaidAmount] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const [fundingSource, setFundingSource] =
    useState<PaymentFundingSource>('store_cash')
  const [sourceStoreId, setSourceStoreId] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentId, setPaymentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const today = getOperationalDate()

  useEffect(() => {
    if (!openState) return
    setSelectedIds(new Set(getDefaultPaymentSelection(openState.periods)))
    setExpandedPeriods(new Set())
    setPaidAmount('')
    setAmountTouched(false)
    setFundingSource('store_cash')
    setSourceStoreId(openState.collaborator.storeId)
    setNotes('')
    setPaymentId(crypto.randomUUID())
    setError(undefined)
  }, [openState])

  const pendingPeriods = useMemo(
    () => openState?.periods.filter((period) => period.pendingDays > 0) ?? [],
    [openState],
  )
  const selection = useMemo(
    () => calculatePaymentSelection(pendingPeriods, selectedIds),
    [pendingPeriods, selectedIds],
  )

  useEffect(() => {
    if (!amountTouched) {
      setPaidAmount(
        selection.suggestedAmount === undefined
          ? ''
          : String(selection.suggestedAmount),
      )
    }
  }, [amountTouched, selection.suggestedAmount])

  if (!openState) return null
  const collaborator = openState.collaborator
  const paydayMismatch =
    collaborator.payCycleEndWeekday !== undefined &&
    getCalendarWeekday(today) !== collaborator.payCycleEndWeekday
  const selectedOpenPeriod = pendingPeriods.some(
    (period) =>
      period.open &&
      period.attendance.some(
        (record) => !record.paid && selectedIds.has(record.id),
      ),
  )
  const amount = Number(paidAmount)
  const canConfirm =
    onlineConfirmationAvailable &&
    selection.selectedDays > 0 &&
    Number.isFinite(amount) &&
    amount > 0 &&
    (fundingSource === 'central_cash' || Boolean(sourceStoreId))

  function toggleAttendance(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePeriod(period: CollaboratorPaymentPeriod) {
    const pendingIds = period.attendance
      .filter((record) => !record.paid)
      .map((record) => record.id)
    const allSelected = pendingIds.every((id) => selectedIds.has(id))
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const id of pendingIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  async function confirm() {
    setSaving(true)
    setError(undefined)
    try {
      const confirmed = await paymentService.confirm({
        paymentId,
        collaboratorId: collaborator.id,
        attendanceIds: selection.attendanceIds,
        paidAmount: amount,
        fundingSource,
        sourceStoreId:
          fundingSource === 'store_cash' ? sourceStoreId : undefined,
        notes,
      })
      onConfirmed(confirmed)
    } catch (cause: unknown) {
      console.error('No fue posible confirmar el pago', cause)
      setError(
        cause instanceof Error ? cause.message : 'No fue posible confirmar el pago.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppModal
      closeDisabled={saving}
      closeLabel="Cerrar pago"
      eyebrow="Nuevo pago"
      hasUnsavedChanges={selection.selectedDays > 0 || notes.length > 0}
      open
      title={collaborator.name}
      onClose={onClose}
    >
      <div className="mt-5 space-y-3">
        <p className="text-sm font-semibold text-slate-600">
          Día de raya: {WEEKDAYS[collaborator.payCycleEndWeekday!]}
        </p>
        {paydayMismatch && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
            Hoy no es el día habitual de raya de este colaborador. El pago está
            permitido y esta advertencia no bloquea la confirmación.
          </p>
        )}
        {selectedOpenPeriod && (
          <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-5 text-blue-950">
            Estás incluyendo un periodo incompleto. Si se registra trabajo
            adicional antes de su cierre, quedará pendiente para otro pago.
          </p>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {pendingPeriods.map((period) => {
          const pending = period.attendance.filter((record) => !record.paid)
          const selectedCount = pending.filter((record) =>
            selectedIds.has(record.id),
          ).length
          const expanded = expandedPeriods.has(period.key)
          const periodSelection = calculatePaymentSelection(
            [period],
            selectedIds,
          )
          return (
            <article className="rounded-2xl border border-slate-200 p-4" key={period.key}>
              <div className="flex items-start gap-3">
                <input
                  aria-label={`Seleccionar periodo ${periodLabel(period)}`}
                  checked={selectedCount === pending.length}
                  className="mt-1 size-5 accent-teal-700"
                  type="checkbox"
                  onChange={() => togglePeriod(period)}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-black text-slate-900">
                    Periodo {periodLabel(period)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {period.workedDays} trabajados · {period.pendingDays} pendientes ·{' '}
                    {selectedCount} seleccionados
                  </p>
                  {period.open && (
                    <p className="mt-1 text-xs font-bold text-amber-700">
                      Periodo abierto hasta {WEEKDAYS[collaborator.payCycleEndWeekday!]}
                    </p>
                  )}
                  {period.missingAttendanceDates.length > 0 && (
                    <p className="mt-1 text-xs text-amber-700">
                      Hay {period.missingAttendanceDates.length} días transcurridos sin asistencia registrada.
                    </p>
                  )}
                </div>
                <strong className="text-sm text-teal-800">
                  {periodSelection.suggestedAmount === undefined
                    ? '—'
                    : currencyFormatter.format(periodSelection.suggestedAmount)}
                </strong>
              </div>
              <button
                className="text-action mt-3 text-xs"
                type="button"
                onClick={() =>
                  setExpandedPeriods((current) => {
                    const next = new Set(current)
                    if (next.has(period.key)) next.delete(period.key)
                    else next.add(period.key)
                    return next
                  })
                }
              >
                {expanded ? 'Ocultar días' : 'Ver días'}
              </button>
              {expanded && (
                <div className="mt-3 divide-y divide-slate-100 rounded-xl bg-slate-50 px-3">
                  {pending.map((record) => (
                    <label className="flex cursor-pointer items-center gap-3 py-3" key={record.id}>
                      <input
                        checked={selectedIds.has(record.id)}
                        className="size-5 accent-teal-700"
                        type="checkbox"
                        onChange={() => toggleAttendance(record.id)}
                      />
                      <span className="flex-1 text-sm font-semibold capitalize text-slate-700">
                        {formatLongDate(record.attendanceDate)}
                      </span>
                      <span className="text-xs font-bold text-slate-500">
                        Presente
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>

      <div className="mt-5 rounded-2xl bg-teal-50 p-4 text-teal-950">
        <p className="text-xs font-bold uppercase tracking-wider">Total sugerido</p>
        <p className="mt-1 text-3xl font-black">
          {selection.suggestedAmount === undefined
            ? '—'
            : currencyFormatter.format(selection.suggestedAmount)}
        </p>
        <p className="mt-1 text-xs">
          {selection.selectedDays} días · {selection.selectedPeriods} periodos
        </p>
      </div>

      <div className="mt-5 space-y-4">
        <label className="field-label">
          Monto real pagado
          <div className="money-field">
            <span>$</span>
            <input
              inputMode="decimal"
              min="0.01"
              required
              step="0.01"
              type="number"
              value={paidAmount}
              onChange={(event) => {
                setAmountTouched(true)
                setPaidAmount(event.target.value)
              }}
            />
          </div>
          <span className="text-xs font-normal text-slate-500">
            Puede ser distinto del sugerido; ambos valores se conservarán.
          </span>
        </label>

        <fieldset>
          <legend className="field-label">Origen del dinero</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              aria-pressed={fundingSource === 'store_cash'}
              className={fundingSource === 'store_cash' ? 'filter-chip-active' : 'filter-chip-item'}
              type="button"
              onClick={() => setFundingSource('store_cash')}
            >
              Caja de tienda
            </button>
            <button
              aria-pressed={fundingSource === 'central_cash'}
              className={fundingSource === 'central_cash' ? 'filter-chip-active' : 'filter-chip-item'}
              type="button"
              onClick={() => setFundingSource('central_cash')}
            >
              Caja central
            </button>
          </div>
        </fieldset>

        {fundingSource === 'store_cash' && (
          <label className="field-label">
            Caja de origen
            <select
              className="field"
              required
              value={sourceStoreId}
              onChange={(event) => setSourceStoreId(event.target.value)}
            >
              {stores
                .filter((store) => store.status === 'active')
                .map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
            </select>
          </label>
        )}

        <label className="field-label">
          Notas opcionales
          <textarea
            className="field min-h-24 resize-y"
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      </div>

      {error && <p className="alert-error mt-5">{error}</p>}
      {!onlineConfirmationAvailable && (
        <p className="mt-4 text-center text-xs leading-5 text-slate-500">
          La selección permanece disponible, pero confirmar requiere conexión
          con Supabase.
        </p>
      )}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button className="button-secondary" disabled={saving} type="button" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="button-primary"
          disabled={!canConfirm || saving}
          type="button"
          onClick={() => void confirm()}
        >
          <CheckIcon className="size-4" />
          {saving ? 'Confirmando…' : 'Confirmar pago'}
        </button>
      </div>
    </AppModal>
  )
}

function PaymentHistoryModal({
  detail,
  stores,
  onClose,
}: {
  detail?: ConfirmedPayment
  stores: Store[]
  onClose: () => void
}) {
  if (!detail) return null
  const { payment, items } = detail
  const periods = new Map<string, PaymentAttendanceItem[]>()
  for (const item of items) {
    const key = `${item.periodStart}:${item.periodEnd}`
    const grouped = periods.get(key) ?? []
    grouped.push(item)
    periods.set(key, grouped)
  }
  const sourceStore = stores.find((store) => store.id === payment.sourceStoreId)

  return (
    <AppModal
      closeLabel="Cerrar detalle del pago"
      eyebrow="Pago confirmado"
      open
      title={payment.collaboratorNameSnapshot}
      onClose={onClose}
    >
      <p className="mt-2 text-sm text-slate-500">
        {PAYMENT_TIME_FORMATTER.format(new Date(payment.paidAt))}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="text-xs font-bold text-slate-500">Sugerido</dt>
          <dd className="mt-1 text-xl font-black">
            {currencyFormatter.format(payment.suggestedAmount)}
          </dd>
        </div>
        <div className="rounded-xl bg-teal-50 p-4 text-teal-950">
          <dt className="text-xs font-bold">Pagado</dt>
          <dd className="mt-1 text-xl font-black">
            {currencyFormatter.format(payment.paidAmount)}
          </dd>
        </div>
      </dl>
      <div className="mt-4 rounded-xl border border-slate-200 p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
          {payment.fundingSource === 'store_cash' ? (
            <StoreIcon className="size-4" />
          ) : (
            <CashIcon className="size-4" />
          )}
          {payment.fundingSource === 'central_cash'
            ? 'Caja central'
            : `Caja de ${sourceStore?.name ?? 'tienda'}`}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Fecha operativa: {shortDate(payment.businessDate)}
        </p>
      </div>

      <div className="mt-5 space-y-3">
        {[...periods.values()].map((periodItems) => {
          const first = periodItems[0]!
          const suggested = periodItems.reduce(
            (total, item) => total + item.suggestedAllocation,
            0,
          )
          return (
            <article className="rounded-xl border border-slate-200 p-4" key={first.periodStart}>
              <p className="eyebrow">
                Periodo {shortDate(first.periodStart)}–{shortDate(first.periodEnd)}
              </p>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span>{periodItems.length} días cubiertos</span>
                <strong>{currencyFormatter.format(suggested)}</strong>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {periodItems.map((item) => (
                  <li className="flex justify-between gap-3" key={item.attendanceId}>
                    <span className="capitalize">{formatLongDate(item.workDateSnapshot)}</span>
                    <span>{currencyFormatter.format(item.suggestedAllocation)}</span>
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
      {payment.notes && (
        <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          {payment.notes}
        </div>
      )}
      <p className="mt-5 text-xs text-slate-500">
        Registrado por Administración · ID {payment.paidBy.slice(0, 8)}
      </p>
      <button className="button-secondary mt-6 w-full" type="button" onClick={onClose}>
        Cerrar
      </button>
    </AppModal>
  )
}
