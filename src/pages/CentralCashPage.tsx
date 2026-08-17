import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppModal } from '../components/AppModal'
import {
  FilterChipGroup,
  type FilterChipOption,
} from '../components/filters/FilterChipGroup'
import {
  ALL_STORES,
  StoreScopeSelector,
  type StoreScopeValue,
} from '../components/filters/StoreScopeSelector'
import {
  ArrowIcon,
  CashIcon,
  CheckIcon,
  PlusIcon,
  WifiOffIcon,
} from '../components/icons'
import {
  BILL_DENOMINATIONS,
  EMPTY_CENTRAL_CASH_BILLS,
} from '../domain/constants'
import {
  calculateCentralCashPhysicalTotal,
} from '../domain/centralCash'
import type {
  CentralCashBills,
  CentralCashMovement,
  CentralCashMovementType,
  CentralCashPendingClosing,
  CentralCashSummary,
  Store,
  UserProfile,
} from '../domain/models'
import {
  centralCashService,
  CentralCashDomainError,
} from '../services/centralCashService'
import { formatLongDate, getOperationalDate } from '../utils/date'
import { currencyFormatter } from '../utils/money'

type CentralCashTab = 'movements' | 'pending'

type CentralCashPageProps = {
  networkAvailable: boolean
  stores: Store[]
  user: UserProfile
}

type AdjustmentForm = {
  id: string
  movementType: CentralCashMovementType
  businessDate: string
  concept: string
  notes: string
  bills: CentralCashBills
  coinsAmount: string
}

const TAB_OPTIONS: readonly FilterChipOption<CentralCashTab>[] = [
  { value: 'movements', label: 'Movimientos' },
  { value: 'pending', label: 'Por recibir' },
]

const EMPTY_SUMMARY: CentralCashSummary = {
  id: 'current',
  balance: 0,
  todayInflows: 0,
  todayOutflows: 0,
  todayNet: 0,
  bills: { ...EMPTY_CENTRAL_CASH_BILLS },
  coinsAmount: 0,
  pendingClosingsCount: 0,
  pendingClosingsAmount: 0,
  cachedAt: '',
}

function newAdjustment(): AdjustmentForm {
  return {
    id: crypto.randomUUID(),
    movementType: 'inflow',
    businessDate: getOperationalDate(),
    concept: '',
    notes: '',
    bills: { ...EMPTY_CENTRAL_CASH_BILLS },
    coinsAmount: '0',
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Error desconocido'
}

function compactDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
  })
    .format(new Date(`${value}T12:00:00`))
    .replace('.', '')
}

function auditDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(value))
}

function BillsBreakdown({
  bills,
  coinsAmount,
  compactDesktop = false,
}: {
  bills: CentralCashBills
  coinsAmount: number
  compactDesktop?: boolean
}) {
  const total = calculateCentralCashPhysicalTotal(bills, coinsAmount)

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200 ${
        compactDesktop ? 'lg:rounded-xl' : ''
      }`}
    >
      <div
        className={`grid grid-cols-[minmax(5rem,1fr)_minmax(4rem,0.7fr)_minmax(5.5rem,auto)] gap-2 bg-slate-50 px-3 py-3 text-center text-[10px] font-extrabold uppercase tracking-wider text-slate-400 sm:grid-cols-[minmax(6rem,1fr)_6rem_minmax(7rem,auto)] sm:px-4 ${
          compactDesktop ? 'lg:px-3 lg:py-1.5' : ''
        }`}
      >
        <span className="text-left">Denominación</span>
        <span>Conteo</span>
        <span className="text-right">Subtotal</span>
      </div>
      <dl
        className={`divide-y divide-slate-100 px-3 sm:px-4 ${
          compactDesktop ? 'lg:px-3' : ''
        }`}
      >
        {BILL_DENOMINATIONS.map((denomination) => {
          const isCoins = denomination.key === 'monedas'
          const count = isCoins ? coinsAmount : bills[denomination.key]
          const subtotal = isCoins ? coinsAmount : count * denomination.value
          return (
            <div
              className={`grid min-h-14 grid-cols-[minmax(5rem,1fr)_minmax(4rem,0.7fr)_minmax(5.5rem,auto)] items-center gap-2 text-sm sm:grid-cols-[minmax(6rem,1fr)_6rem_minmax(7rem,auto)] ${
                compactDesktop ? 'lg:min-h-7 lg:text-xs' : ''
              }`}
              key={denomination.key}
            >
              <dt className="font-bold text-slate-700">
                {denomination.label}
              </dt>
              <dd className="text-center font-semibold tabular-nums text-slate-600">
                {isCoins ? currencyFormatter.format(count) : count}
              </dd>
              <dd className="text-right font-extrabold tabular-nums text-slate-950">
                {currencyFormatter.format(subtotal)}
              </dd>
            </div>
          )
        })}
      </dl>
      <div
        className={`flex items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-4 py-4 ${
          compactDesktop ? 'lg:px-3 lg:py-2' : ''
        }`}
      >
        <span className="text-sm font-bold text-slate-700">Efectivo total</span>
        <strong
          className={`text-xl font-black tabular-nums text-slate-950 ${
            compactDesktop ? 'lg:text-base' : ''
          }`}
        >
          {currencyFormatter.format(total)}
        </strong>
      </div>
    </div>
  )
}

function DateFilters({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: {
  dateFrom: string
  dateTo: string
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
}) {
  return (
    <div className="panel grid grid-cols-2 gap-x-2 gap-y-3 p-3 sm:gap-4 sm:p-5 lg:w-auto lg:grid-cols-[auto_auto] lg:gap-3 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
      <label className="field-label min-w-0 lg:flex lg:items-center lg:gap-2">
        Desde
        <span className="expense-date-control lg:mt-0 lg:min-h-10 lg:w-28">
          <span aria-hidden="true">{compactDate(dateFrom)}</span>
          <input
            aria-label="Fecha inicial de Caja Central"
            max={dateTo}
            type="date"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
          />
        </span>
      </label>
      <label className="field-label min-w-0 lg:flex lg:items-center lg:gap-2">
        Hasta
        <span className="expense-date-control lg:mt-0 lg:min-h-10 lg:w-28">
          <span aria-hidden="true">{compactDate(dateTo)}</span>
          <input
            aria-label="Fecha final de Caja Central"
            min={dateFrom}
            type="date"
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
          />
        </span>
      </label>
    </div>
  )
}

function movementTitle(movement: CentralCashMovement): string {
  if (movement.sourceType === 'cash_closing') {
    return `Corte · ${movement.storeNameSnapshot ?? 'Tienda'} · #${movement.sequenceNumberSnapshot ?? '—'}`
  }
  return movement.concept
}

export function CentralCashPage({
  networkAvailable,
  stores,
  user,
}: CentralCashPageProps) {
  const today = getOperationalDate()
  const [tab, setTab] = useState<CentralCashTab>('movements')
  const [storeFilter, setStoreFilter] = useState<StoreScopeValue>(ALL_STORES)
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 8)}01`)
  const [dateTo, setDateTo] = useState(today)
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [movements, setMovements] = useState<CentralCashMovement[]>([])
  const [pendingClosings, setPendingClosings] = useState<
    CentralCashPendingClosing[]
  >([])
  const [selectedMovement, setSelectedMovement] =
    useState<CentralCashMovement>()
  const [selectedClosing, setSelectedClosing] =
    useState<CentralCashPendingClosing>()
  const [receiptId, setReceiptId] = useState('')
  const [receiptNotes, setReceiptNotes] = useState('')
  const [adjustment, setAdjustment] = useState<AdjustmentForm>()
  const [showPhysicalBreakdown, setShowPhysicalBreakdown] = useState(false)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'receiving' | 'adjusting'>()
  const [fromCache, setFromCache] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const queryStoreId = storeFilter === ALL_STORES ? undefined : storeFilter

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [summaryResult, movementResult, pendingResult] = await Promise.all([
        centralCashService.getSummary(),
        centralCashService.listMovements(queryStoreId, dateFrom, dateTo),
        centralCashService.listPendingClosings(
          queryStoreId,
          dateFrom,
          dateTo,
        ),
      ])
      setSummary(summaryResult.data)
      setMovements(movementResult.data)
      setPendingClosings(pendingResult.data)
      setFromCache(
        summaryResult.fromCache ||
          movementResult.fromCache ||
          pendingResult.fromCache,
      )
    } catch (cause: unknown) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, queryStoreId])

  useEffect(() => {
    void load()
  }, [load])

  const movementsByDate = useMemo(() => {
    const groups = new Map<string, CentralCashMovement[]>()
    for (const movement of movements) {
      const entries = groups.get(movement.businessDate) ?? []
      entries.push(movement)
      groups.set(movement.businessDate, entries)
    }
    return [...groups.entries()]
  }, [movements])

  const pendingByDate = useMemo(() => {
    const groups = new Map<string, CentralCashPendingClosing[]>()
    for (const closing of pendingClosings) {
      const entries = groups.get(closing.businessDate) ?? []
      entries.push(closing)
      groups.set(closing.businessDate, entries)
    }
    return [...groups.entries()]
  }, [pendingClosings])

  const adjustmentTotal = adjustment
    ? calculateCentralCashPhysicalTotal(
        adjustment.bills,
        Number(adjustment.coinsAmount || 0),
      )
    : 0
  const adjustmentAmount = adjustmentTotal
  const validAdjustmentCount = Boolean(
    adjustment &&
      adjustmentAmount > 0 &&
      Number(adjustment.coinsAmount || 0) >= 0,
  )
  const validAdjustment = Boolean(
    validAdjustmentCount && adjustment?.concept.trim(),
  )

  function changeDateFrom(value: string) {
    setDateFrom(value)
    if (value > dateTo) setDateTo(value)
  }

  function changeDateTo(value: string) {
    setDateTo(value)
    if (value < dateFrom) setDateFrom(value)
  }

  function openReceipt(closing: CentralCashPendingClosing) {
    setSelectedClosing(closing)
    setReceiptId(crypto.randomUUID())
    setReceiptNotes('')
    setError('')
    setMessage('')
  }

  async function confirmReceipt() {
    if (!selectedClosing || !receiptId) return
    setAction('receiving')
    setError('')
    setMessage('')
    try {
      await centralCashService.receiveClosing(
        selectedClosing.id,
        receiptId,
        receiptNotes,
      )
      setSelectedClosing(undefined)
      setMessage('Recepción confirmada.')
      setTab('movements')
      await load()
    } catch (cause: unknown) {
      if (
        cause instanceof CentralCashDomainError &&
        cause.code === 'CENTRAL_CASH_CLOSING_ALREADY_RECEIVED'
      ) {
        setSelectedClosing(undefined)
        await load()
        setError('Este Corte acaba de ser recibido desde otro dispositivo.')
      } else {
        setError(errorMessage(cause))
      }
    } finally {
      setAction(undefined)
    }
  }

  async function createAdjustment() {
    if (!adjustment || !validAdjustment) return
    setAction('adjusting')
    setError('')
    setMessage('')
    try {
      await centralCashService.createAdjustment({
        id: adjustment.id,
        movementType: adjustment.movementType,
        amount: adjustmentAmount,
        businessDate: adjustment.businessDate,
        concept: adjustment.concept,
        notes: adjustment.notes,
        bills: adjustment.bills,
        coinsAmount: Number(adjustment.coinsAmount || 0),
      })
      setAdjustment(undefined)
      setMessage('Ajuste registrado.')
      setTab('movements')
      await load()
    } catch (cause: unknown) {
      setError(errorMessage(cause))
    } finally {
      setAction(undefined)
    }
  }

  if (user.role !== 'admin') return null

  return (
    <section>
      <div className="flex items-center gap-3">
        <CashIcon className="size-8 text-teal-700" />
        <h1 className="page-title">Caja Central</h1>
      </div>

      <div className="mt-5 grid gap-4 sm:mt-7 lg:mt-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] lg:items-stretch">
        <article className="hero-card min-h-0 lg:h-full lg:p-5">
          <div className="relative z-[1] lg:flex lg:h-full lg:flex-col">
            <p className="eyebrow-light">Saldo actual</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl lg:mt-2 lg:text-4xl">
              {currencyFormatter.format(summary.balance)}
            </p>
            <dl className="mt-7 grid gap-4 text-sm text-white sm:grid-cols-3 lg:mt-auto lg:pt-4">
              <div>
                <dt className="text-teal-100/80">Entradas hoy</dt>
                <dd className="mt-1 text-lg font-black">
                  {currencyFormatter.format(summary.todayInflows)}
                </dd>
              </div>
              <div>
                <dt className="text-teal-100/80">Salidas hoy</dt>
                <dd className="mt-1 text-lg font-black">
                  {currencyFormatter.format(summary.todayOutflows)}
                </dd>
              </div>
              <div>
                <dt className="text-teal-100/80">Neto hoy</dt>
                <dd className="mt-1 text-lg font-black">
                  {currencyFormatter.format(summary.todayNet)}
                </dd>
              </div>
            </dl>
          </div>
        </article>

        <div className="lg:hidden">
          <button
            aria-controls="central-cash-physical-breakdown"
            aria-expanded={showPhysicalBreakdown}
            className="text-action"
            type="button"
            onClick={() => setShowPhysicalBreakdown((visible) => !visible)}
          >
            <CashIcon className="size-4" />
            {showPhysicalBreakdown
              ? 'Ocultar desglose'
              : 'Ver desglose de efectivo'}
          </button>
          {showPhysicalBreakdown && (
            <div className="mt-3" id="central-cash-physical-breakdown">
              <BillsBreakdown
                bills={summary.bills}
                coinsAmount={summary.coinsAmount}
              />
            </div>
          )}
        </div>

        <article className="panel hidden h-full lg:block lg:p-3">
          <p className="stat-label mb-1.5">Efectivo físico central</p>
          <BillsBreakdown
            bills={summary.bills}
            compactDesktop
            coinsAmount={summary.coinsAmount}
          />
        </article>
      </div>

      <button
        className="panel mt-3 flex w-full items-center gap-3 px-4 py-3 text-left transition hover:border-teal-200 hover:bg-teal-50/30 sm:px-5 sm:py-3"
        type="button"
        onClick={() => setTab('pending')}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-slate-600">
          <strong className="text-slate-950">Por recibir</strong>
          <span aria-hidden="true">·</span>
          <span className="font-bold">
            {summary.pendingClosingsCount}{' '}
            {summary.pendingClosingsCount === 1 ? 'corte' : 'cortes'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-black text-amber-800">
            {currencyFormatter.format(summary.pendingClosingsAmount)}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-extrabold text-teal-700">
          Ver
          <ArrowIcon className="size-4" />
        </span>
      </button>

      <div className="mt-4 space-y-4 lg:space-y-3">
        <FilterChipGroup
          ariaLabel="Sección de Caja Central"
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-5">
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500 lg:sr-only">
              Tienda
            </p>
            <StoreScopeSelector
              ariaLabel="Filtrar Caja Central por tienda"
              includeInactive
              role={user.role}
              stores={stores}
              value={storeFilter}
              onChange={setStoreFilter}
            />
          </div>

          <DateFilters
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={changeDateFrom}
            onDateToChange={changeDateTo}
          />
        </div>

        {fromCache && (
          <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">
            <WifiOffIcon className="size-4 shrink-0" />
            Mostrando la última información guardada en este dispositivo.
          </p>
        )}
        {error && <p className="alert-error">{error}</p>}
        {message && <p className="alert-success">{message}</p>}
        {loading && <p className="empty-state">Consultando Caja Central…</p>}

        {!loading && tab === 'movements' && movements.length === 0 && (
          <div className="panel empty-state lg:py-8">
            No hay movimientos en este periodo.
          </div>
        )}

        {!loading && tab === 'movements' && movements.length > 0 && (
          <div className="space-y-6 lg:space-y-4">
            {movementsByDate.map(([date, entries]) => (
              <section key={date}>
                <h2 className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500 lg:mb-2">
                  {formatLongDate(date)}
                </h2>
                <div className="space-y-3 lg:divide-y lg:divide-slate-100 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:shadow-[0_8px_30px_rgba(46,34,31,0.04)] lg:space-y-0">
                  {entries.map((movement) => (
                    <button
                      className="panel flex w-full items-center gap-4 text-left transition hover:border-teal-200 hover:bg-teal-50/30 lg:rounded-none lg:border-0 lg:px-4 lg:py-3 lg:shadow-none"
                      key={movement.id}
                      type="button"
                      onClick={() => setSelectedMovement(movement)}
                    >
                      <span
                        className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xl font-black lg:size-8 lg:text-lg ${
                          movement.movementType === 'inflow'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {movement.movementType === 'inflow' ? '↑' : '↓'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-black text-slate-950">
                          {movementTitle(movement)}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500 lg:mt-0.5">
                          {movement.sourceType === 'manual_adjustment'
                            ? 'Ajuste administrativo'
                            : movement.concept}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 font-black tabular-nums ${
                          movement.movementType === 'inflow'
                            ? 'text-emerald-700'
                            : 'text-red-700'
                        }`}
                      >
                        {movement.movementType === 'inflow' ? '+' : '−'}
                        {currencyFormatter.format(movement.amount)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {!loading && tab === 'pending' && pendingClosings.length === 0 && (
          <div className="panel empty-state lg:py-8">
            <CheckIcon className="mx-auto mb-3 size-8 text-teal-700" />
            <p>No hay Cortes por recibir en este periodo.</p>
          </div>
        )}

        {!loading && tab === 'pending' && pendingClosings.length > 0 && (
          <div className="space-y-6 lg:space-y-4">
            {pendingByDate.map(([date, entries]) => (
              <section key={date}>
                <h2 className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500 lg:mb-2">
                  {formatLongDate(date)}
                </h2>
                <div className="space-y-3 lg:divide-y lg:divide-slate-100 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:shadow-[0_8px_30px_rgba(46,34,31,0.04)] lg:space-y-0">
                  {entries.map((closing) => (
                    <article
                      className="panel flex flex-col gap-4 sm:flex-row sm:items-center lg:rounded-none lg:border-0 lg:px-4 lg:py-3 lg:shadow-none"
                      key={closing.id}
                    >
                      <div className="min-w-0 flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-4">
                        <p className="font-black text-slate-950">
                          {closing.storeName} · Corte #{closing.sequenceNumber}
                        </p>
                        <p className="mt-3 text-xs font-semibold text-slate-500 lg:sr-only">
                          Efectivo a recibir
                        </p>
                        <p className="mt-1 text-2xl font-black text-teal-800 lg:mt-0 lg:text-base">
                          {currencyFormatter.format(closing.cashToWithdraw)}
                        </p>
                      </div>
                      <button
                        className="button-primary shrink-0 lg:min-h-9 lg:px-4 lg:py-1.5"
                        disabled={!networkAvailable}
                        type="button"
                        onClick={() => openReceipt(closing)}
                      >
                        Recibir
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {tab === 'pending' && !networkAvailable && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
            Necesitas conexión para confirmar una recepción en Caja Central.
          </p>
        )}
      </div>

      <button
        aria-label="Nuevo ajuste"
        className="app-fab"
        disabled={!networkAvailable}
        title={
          networkAvailable
            ? 'Nuevo ajuste'
            : 'Los ajustes requieren conexión'
        }
        type="button"
        onClick={() => {
          setAdjustment(newAdjustment())
          setError('')
          setMessage('')
        }}
      >
        <PlusIcon className="size-6" />
      </button>

      <AppModal
        closeDisabled={action === 'receiving'}
        closeLabel="Cancelar recepción"
        eyebrow={
          selectedClosing
            ? `${selectedClosing.storeName} · ${formatLongDate(selectedClosing.businessDate)}`
            : undefined
        }
        open={Boolean(selectedClosing)}
        title="Recibir Corte"
        onClose={() => setSelectedClosing(undefined)}
      >
        {selectedClosing && (
          <div className="mt-5 space-y-5">
            <div className="rounded-2xl bg-teal-50 p-4">
              <p className="text-xs font-bold text-teal-800">Corte #{selectedClosing.sequenceNumber}</p>
              <p className="mt-3 text-sm font-semibold text-slate-600">
                Efectivo esperado
              </p>
              <p className="mt-1 text-3xl font-black text-slate-950">
                {currencyFormatter.format(selectedClosing.cashToWithdraw)}
              </p>
            </div>
            <div>
              <p className="mb-3 text-sm font-black text-slate-950">Desglose</p>
              <BillsBreakdown
                bills={selectedClosing.withdrawBills}
                coinsAmount={selectedClosing.withdrawBills.monedas}
              />
            </div>
            <label className="field-label">
              Notas opcionales
              <textarea
                className="field min-h-20 resize-y"
                maxLength={500}
                value={receiptNotes}
                onChange={(event) => setReceiptNotes(event.target.value)}
              />
            </label>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">
              Se agregarán {currencyFormatter.format(selectedClosing.cashToWithdraw)} a Caja Central.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="button-secondary"
                disabled={action === 'receiving'}
                type="button"
                onClick={() => setSelectedClosing(undefined)}
              >
                Cancelar
              </button>
              <button
                className="button-primary"
                disabled={!networkAvailable || action === 'receiving'}
                type="button"
                onClick={() => void confirmReceipt()}
              >
                {action === 'receiving'
                  ? 'Confirmando…'
                  : 'Confirmar recepción'}
              </button>
            </div>
          </div>
        )}
      </AppModal>

      <AppModal
        closeLabel="Cerrar detalle"
        eyebrow={
          selectedMovement?.movementType === 'inflow'
            ? 'Entrada a Caja Central'
            : 'Salida de Caja Central'
        }
        open={Boolean(selectedMovement)}
        title={selectedMovement ? movementTitle(selectedMovement) : 'Movimiento'}
        onClose={() => setSelectedMovement(undefined)}
      >
        {selectedMovement && (
          <div className="mt-5 space-y-5">
            <dl className="space-y-3 text-sm">
              <div className="summary-row">
                <dt>Monto</dt>
                <dd>{currencyFormatter.format(selectedMovement.amount)}</dd>
              </div>
              <div className="summary-row">
                <dt>Fecha de operación</dt>
                <dd>{formatLongDate(selectedMovement.businessDate)}</dd>
              </div>
              {selectedMovement.sequenceNumberSnapshot && (
                <div className="summary-row">
                  <dt>Origen</dt>
                  <dd>Corte #{selectedMovement.sequenceNumberSnapshot}</dd>
                </div>
              )}
              {selectedMovement.storeNameSnapshot && (
                <div className="summary-row">
                  <dt>Tienda</dt>
                  <dd>{selectedMovement.storeNameSnapshot}</dd>
                </div>
              )}
              <div className="summary-row">
                <dt>Registrado</dt>
                <dd>{auditDate(selectedMovement.createdAt)}</dd>
              </div>
              <div className="summary-row">
                <dt>Registrado por</dt>
                <dd>{selectedMovement.createdByNameSnapshot}</dd>
              </div>
            </dl>
            {selectedMovement.notes && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Notas
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-700">
                  {selectedMovement.notes}
                </p>
              </div>
            )}
            <div>
              <p className="mb-3 text-sm font-black text-slate-950">Billetes</p>
              <BillsBreakdown
                bills={selectedMovement.bills}
                coinsAmount={selectedMovement.coinsAmount}
              />
            </div>
          </div>
        )}
      </AppModal>

      <AppModal
        closeDisabled={action === 'adjusting'}
        closeLabel="Cancelar ajuste"
        eyebrow="Caja Central"
        open={Boolean(adjustment)}
        title="Nuevo ajuste"
        onClose={() => setAdjustment(undefined)}
      >
        {adjustment && (
          <div className="mt-5 space-y-4">
            <fieldset>
              <legend className="field-label">Tipo</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                {(['inflow', 'outflow'] as const).map((movementType) => (
                  <button
                    aria-pressed={adjustment.movementType === movementType}
                    className={
                      adjustment.movementType === movementType
                        ? 'rounded-lg bg-white px-3 py-2.5 text-sm font-black text-teal-800 shadow-sm'
                        : 'rounded-lg px-3 py-2.5 text-sm font-bold text-slate-500'
                    }
                    key={movementType}
                    type="button"
                    onClick={() =>
                      setAdjustment((current) =>
                        current ? { ...current, movementType } : current,
                      )
                    }
                  >
                    {movementType === 'inflow' ? 'Entrada' : 'Salida'}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field-label">
                Fecha
                <input
                  className="field"
                  max={today}
                  type="date"
                  value={adjustment.businessDate}
                  onChange={(event) =>
                    setAdjustment((current) =>
                      current
                        ? {
                            ...current,
                            businessDate: event.target.value,
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label className="field-label">
                Concepto
                <input
                  className="field"
                  maxLength={160}
                  placeholder="Ajuste inicial"
                  value={adjustment.concept}
                  onChange={(event) =>
                    setAdjustment((current) =>
                      current
                        ? { ...current, concept: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
            </div>
            <label className="field-label">
              Notas opcionales
              <textarea
                className="field min-h-16 resize-y"
                maxLength={500}
                rows={2}
                value={adjustment.notes}
                onChange={(event) =>
                  setAdjustment((current) =>
                    current
                      ? { ...current, notes: event.target.value }
                      : current,
                  )
                }
              />
            </label>
            <fieldset>
              <legend className="sr-only">Conteo de efectivo</legend>
              <div className="flex items-end justify-between gap-3">
                <p className="field-label">Conteo de efectivo</p>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700">
                    Monto calculado
                  </p>
                  <strong className="block text-xl font-black text-teal-800">
                    {currencyFormatter.format(adjustmentAmount)}
                  </strong>
                </div>
              </div>
              <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200">
                    <div className="grid grid-cols-[minmax(5rem,1fr)_minmax(4.25rem,0.8fr)_minmax(5.5rem,auto)] gap-2 bg-slate-50 px-3 py-2.5 text-center text-[10px] font-extrabold uppercase tracking-wider text-slate-400 sm:grid-cols-[minmax(6rem,1fr)_7rem_minmax(7rem,auto)] sm:px-4">
                      <span className="text-left">Denominación</span>
                      <span>Conteo</span>
                      <span className="text-right">Subtotal</span>
                    </div>
                    <div className="divide-y divide-slate-100 px-3 sm:px-4">
                      {BILL_DENOMINATIONS.map((denomination) => {
                        const isCoins = denomination.key === 'monedas'
                        const fieldValue = isCoins
                          ? adjustment.coinsAmount
                          : adjustment.bills[denomination.key]
                        const numericValue = Number(fieldValue || 0)
                        const subtotal = isCoins
                          ? numericValue
                          : numericValue * denomination.value

                        return (
                          <label
                            className="grid min-h-14 grid-cols-[minmax(5rem,1fr)_minmax(4.25rem,0.8fr)_minmax(5.5rem,auto)] items-center gap-2 sm:grid-cols-[minmax(6rem,1fr)_7rem_minmax(7rem,auto)]"
                            key={denomination.key}
                          >
                            <span className="text-sm font-bold text-slate-700">
                              {denomination.label}
                            </span>
                            <input
                              aria-label={
                                isCoins
                                  ? 'Monto total en monedas del ajuste'
                                  : `Cantidad de billetes de ${denomination.value} pesos del ajuste`
                              }
                              className="h-10 min-w-0 rounded-lg border border-slate-300 px-2 text-center text-base font-bold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15"
                              inputMode={isCoins ? 'decimal' : 'numeric'}
                              min="0"
                              step={isCoins ? '0.01' : '1'}
                              type="number"
                              value={fieldValue}
                              onChange={(event) => {
                                if (isCoins) {
                                  setAdjustment((current) =>
                                    current
                                      ? {
                                          ...current,
                                          coinsAmount: event.target.value,
                                        }
                                      : current,
                                  )
                                  return
                                }

                                const count = Math.max(
                                  0,
                                  Math.trunc(Number(event.target.value) || 0),
                                )
                                setAdjustment((current) =>
                                  current
                                    ? {
                                        ...current,
                                        bills: {
                                          ...current.bills,
                                          [denomination.key]: count,
                                        },
                                      }
                                    : current,
                                )
                              }}
                            />
                            <span className="text-right text-sm font-extrabold tabular-nums text-slate-900">
                              {currencyFormatter.format(subtotal)}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-4 py-3">
                      <div>
                        <p className="text-sm font-bold text-slate-700">
                          Efectivo total
                        </p>
                        {!validAdjustmentCount && (
                          <p className="mt-1 text-xs font-semibold text-red-700">
                            Captura al menos una denominación
                          </p>
                        )}
                      </div>
                      <strong
                        className={`text-xl font-black tabular-nums ${
                          validAdjustmentCount
                            ? 'text-slate-950'
                            : 'text-red-700'
                        }`}
                      >
                        {currencyFormatter.format(adjustmentTotal)}
                      </strong>
                    </div>
              </div>
            </fieldset>
            {error && <p className="alert-error">{error}</p>}
            <p className="text-xs leading-5 text-slate-500">
              Los movimientos confirmados no se editan ni eliminan.
            </p>
            <button
              className="button-primary w-full"
              disabled={
                !networkAvailable ||
                !validAdjustment ||
                action === 'adjusting'
              }
              type="button"
              onClick={() => void createAdjustment()}
            >
              {action === 'adjusting' ? 'Registrando…' : 'Registrar ajuste'}
            </button>
          </div>
        )}
      </AppModal>
    </section>
  )
}
