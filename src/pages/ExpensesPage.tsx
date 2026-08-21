import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { AppModal } from '../components/AppModal'
import { CashBreakdownControl } from '../components/CashBreakdownControl'
import { DatePickerButton } from '../components/DatePickerButton'
import { FilterChipGroup } from '../components/filters/FilterChipGroup'
import {
  CheckIcon,
  PlusIcon,
  ReceiptIcon,
  SyncIcon,
} from '../components/icons'
import {
  ALL_STORES,
  StoreScopeSelector,
  type StoreScopeValue,
} from '../components/filters/StoreScopeSelector'
import {
  getRuntimeStoreScope,
  hasCapability,
} from '../domain/capabilities'
import {
  EMPTY_CENTRAL_CASH_BILLS,
} from '../domain/constants'
import {
  cashBreakdownMatchesAmount,
  hasCapturedCashBreakdown,
} from '../domain/purchasePolicy'
import {
  PAYMENT_METHODS,
  type CentralCashBills,
  type Expense,
  type OperatorSession,
  type PaymentMethod,
  type PaymentFundingSource,
  type Store,
  type UserProfile,
} from '../domain/models'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  expenseService,
  ExpenseValidationError,
} from '../services/expenseService'
import { formatLongDate, getLocalDate } from '../utils/date'
import {
  currencyFormatter,
} from '../utils/money'

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
}

const TIME_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit',
  minute: '2-digit',
})

const COMPACT_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

type PaymentFilter = PaymentMethod | 'all'

type ExpensesPageProps = {
  stores: Store[]
  user: UserProfile
  operatorSession?: OperatorSession
  networkAvailable: boolean
  operatorAccountId?: string | null
  onDataChanged: () => void
  onSync?: () => Promise<void>
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function groupDateLabel(value: string, today: string): string {
  const yesterday = new Date(`${today}T12:00:00`)
  yesterday.setDate(yesterday.getDate() - 1)

  if (value === today) return 'Hoy'
  if (value === getLocalDate(yesterday)) return 'Ayer'
  return capitalize(formatLongDate(value))
}

function expenseTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : TIME_FORMATTER.format(date)
}

function compactDate(value: string): string {
  return COMPACT_DATE_FORMATTER.format(new Date(`${value}T12:00:00`)).replace('.', '')
}

export function ExpensesPage({
  stores,
  user,
  operatorSession,
  networkAvailable,
  operatorAccountId,
  onDataChanged,
  onSync,
}: ExpensesPageProps) {
  const today = getLocalDate()
  const activeStores = useMemo(
    () => stores.filter((store) => store.status === 'active'),
    [stores],
  )
  const isAdmin = user.role === 'admin'
  const identity = { technicalUser: user, operatorSession }
  const storeScope = getRuntimeStoreScope(identity)
  const cashierStoreId = storeScope.kind === 'fixed' ? storeScope.storeId : ''
  const [storeFilter, setStoreFilter] = useState<StoreScopeValue>(
    isAdmin ? ALL_STORES : cashierStoreId,
  )
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [search, setSearch] = useState('')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [formStoreId, setFormStoreId] = useState('')
  const [initialFormStoreId, setInitialFormStoreId] = useState('')
  const [formDate, setFormDate] = useState(today)
  const [initialFormDate, setInitialFormDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [concept, setConcept] = useState('')
  const [requestId, setRequestId] = useState('')
  const [fundingSource, setFundingSource] =
    useState<PaymentFundingSource>('store_cash')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo')
  const [bills, setBills] = useState<CentralCashBills>({
    ...EMPTY_CENTRAL_CASH_BILLS,
  })
  const [coinsAmount, setCoinsAmount] = useState(0)
  const [cashBreakdownOpen, setCashBreakdownOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const amountInputRef = useRef<HTMLInputElement>(null)
  const centralAvailable =
    isAdmin && networkAvailable && isSupabaseConfigured && !user.demo

  const queryStoreId = isAdmin
    ? storeFilter === ALL_STORES
      ? undefined
      : storeFilter
    : cashierStoreId || undefined

  const load = useCallback(async () => {
    if (!isAdmin && !cashierStoreId) {
      setExpenses([])
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError('')
    try {
      setExpenses(await expenseService.list(queryStoreId, dateFrom, dateTo))
    } catch (cause: unknown) {
      console.error('No fue posible consultar los gastos', cause)
      setLoadError('No fue posible consultar los gastos guardados en este dispositivo.')
    } finally {
      setLoading(false)
    }
  }, [cashierStoreId, dateFrom, dateTo, isAdmin, queryStoreId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (
      isAdmin &&
      storeFilter !== ALL_STORES &&
      !activeStores.some((store) => store.id === storeFilter)
    ) {
      setStoreFilter(ALL_STORES)
    }
  }, [activeStores, isAdmin, storeFilter])

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setFeedback(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  const isFormDirty =
    amount.trim().length > 0 ||
    concept.trim().length > 0 ||
    notes.trim().length > 0 ||
    fundingSource !== 'store_cash' ||
    paymentMethod !== 'efectivo' ||
    formStoreId !== initialFormStoreId ||
    formDate !== initialFormDate ||
    Object.values(bills).some((count) => count > 0) ||
    coinsAmount > 0

  const visibleExpenses = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es-MX')
    return expenses.filter((expense) => {
      if (paymentFilter !== 'all' && expense.paymentMethod !== paymentFilter) {
        return false
      }
      return (
        !normalizedSearch ||
        expense.concept.toLocaleLowerCase('es-MX').includes(normalizedSearch)
      )
    })
  }, [expenses, paymentFilter, search])

  const total = useMemo(
    () => visibleExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    [visibleExpenses],
  )
  const cashBreakdownVisible =
    paymentMethod === 'efectivo' &&
    (cashBreakdownOpen || fundingSource === 'central_cash')

  const groupedExpenses = useMemo(() => {
    const groups = new Map<string, Expense[]>()
    for (const expense of visibleExpenses) {
      const group = groups.get(expense.businessDate) ?? []
      group.push(expense)
      groups.set(expense.businessDate, group)
    }
    return Array.from(groups.entries())
  }, [visibleExpenses])

  const storeNames = useMemo(
    () => new Map(stores.map((store) => [store.id, store.name])),
    [stores],
  )

  const rangeLabel =
    dateFrom === dateTo
      ? capitalize(formatLongDate(dateFrom))
      : `${capitalize(formatLongDate(dateFrom))} – ${capitalize(formatLongDate(dateTo))}`

  function changeDateFrom(value: string) {
    setDateFrom(value)
    if (value > dateTo) setDateTo(value)
  }

  function changeDateTo(value: string) {
    setDateTo(value)
    if (value < dateFrom) setDateFrom(value)
  }

  function openForm() {
    const selectedStore = isAdmin
      ? storeFilter === ALL_STORES
        ? ''
        : storeFilter
      : cashierStoreId
    const selectedDate = dateFrom === dateTo ? dateFrom : today

    setFormStoreId(selectedStore)
    setInitialFormStoreId(selectedStore)
    setFormDate(selectedDate)
    setInitialFormDate(selectedDate)
    setAmount('')
    setConcept('')
    setRequestId(crypto.randomUUID())
    setFundingSource('store_cash')
    setPaymentMethod('efectivo')
    setBills({ ...EMPTY_CENTRAL_CASH_BILLS })
    setCoinsAmount(0)
    setCashBreakdownOpen(false)
    setNotes('')
    setErrors([])
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
  }

  function changeFundingSource(nextFundingSource: PaymentFundingSource) {
    if (nextFundingSource === fundingSource) return
    setFundingSource(nextFundingSource)
    setBills({ ...EMPTY_CENTRAL_CASH_BILLS })
    setCoinsAmount(0)
    setCashBreakdownOpen(nextFundingSource === 'central_cash')
    if (nextFundingSource === 'central_cash') setPaymentMethod('efectivo')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])

    if (
      cashBreakdownVisible &&
      hasCapturedCashBreakdown(bills, coinsAmount) &&
      !cashBreakdownMatchesAmount(bills, coinsAmount, Number(amount))
    ) {
      setErrors(['Las denominaciones deben sumar exactamente el monto'])
      return
    }

    setSaving(true)

    try {
      if (fundingSource === 'central_cash' && !centralAvailable) {
        throw new Error(
          'Necesitas conexión para confirmar un Gasto desde Caja Central.',
        )
      }
      await expenseService.create(
        {
          storeId: formStoreId,
          businessDate: formDate,
          amount: Number(amount),
          concept,
          requestId,
          fundingSource,
          sourceStoreId:
            fundingSource === 'store_cash' ? formStoreId : undefined,
          paymentMethod,
          bills: fundingSource === 'central_cash' ? bills : undefined,
          coinsAmount: fundingSource === 'central_cash' ? coinsAmount : 0,
          notes,
        },
        user,
        operatorAccountId,
      )
      await load()
      setFeedback(
        fundingSource === 'store_cash' && !networkAvailable
          ? 'Gasto registrado. Pendiente de sincronizar.'
          : 'Gasto registrado',
      )
      setFormOpen(false)
      onDataChanged()
      if (fundingSource === 'store_cash') {
        await onSync?.()
        await load()
        onDataChanged()
      }
    } catch (cause: unknown) {
      if (cause instanceof ExpenseValidationError) {
        setErrors(cause.messages)
      } else {
        console.error('No fue posible guardar el gasto', cause)
        setErrors(['No fue posible guardar el gasto en este dispositivo'])
      }
    } finally {
      setSaving(false)
    }
  }

  const cannotCreate = isAdmin ? activeStores.length === 0 : !cashierStoreId

  if (!hasCapability(identity, 'expenses')) return null

  return (
    <section>
      <div>
        <h1 className="page-title">Gastos</h1>
      </div>

      {feedback && (
        <div className="alert-success mt-5" role="status">
          <CheckIcon className="size-5" />
          {feedback}
        </div>
      )}

      {!isAdmin && !cashierStoreId && (
        <div className="alert-error mt-5" role="alert">
          Tu perfil no tiene una tienda asignada. No es posible consultar ni registrar gastos.
        </div>
      )}

      <div className="mt-4 space-y-3 sm:mt-7 sm:space-y-5">
        {isAdmin && (
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
              Tienda
            </p>
            <StoreScopeSelector
              ariaLabel="Filtrar gastos por tienda"
              scope={storeScope}
              stores={stores}
              value={storeFilter}
              onChange={setStoreFilter}
            />
          </div>
        )}

        <div className="panel grid grid-cols-1 gap-x-2 gap-y-3 p-3 min-[360px]:grid-cols-2 sm:gap-4 sm:p-5 xl:grid-cols-[minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(180px,0.8fr)_minmax(240px,1.4fr)]">
          <label className="field-label min-w-0">
            Desde
            <DatePickerButton
              aria-label="Fecha inicial"
              max={dateTo}
              value={dateFrom}
              onChange={(event) => changeDateFrom(event.target.value)}
            >
              {compactDate(dateFrom)}
            </DatePickerButton>
          </label>
          <label className="field-label min-w-0">
            Hasta
            <DatePickerButton
              aria-label="Fecha final"
              min={dateFrom}
              value={dateTo}
              onChange={(event) => changeDateTo(event.target.value)}
            >
              {compactDate(dateTo)}
            </DatePickerButton>
          </label>
          <label className="field-label">
            Forma de pago
            <select
              className="field"
              value={paymentFilter}
              onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}
            >
              <option value="all">Todas</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>{PAYMENT_LABELS[method]}</option>
              ))}
            </select>
          </label>

          <div className="flex min-h-full flex-col justify-end sm:hidden">
            <p className="text-sm font-bold text-slate-700">Total</p>
            <p className="mt-2 flex min-h-12 items-center justify-end rounded-xl bg-teal-50 px-3 text-lg font-black tabular-nums text-teal-800 ring-1 ring-teal-100">
              {currencyFormatter.format(total)}
            </p>
          </div>

          <label className="field-label col-span-full xl:col-span-1">
            Concepto
            <input
              className="field"
              placeholder="Ej. tortillas"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="hidden sm:block">
          <article className="summary-strip">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Total visible
              </p>
              <p className="mt-1 text-3xl font-black tracking-tight text-slate-950">
                {currencyFormatter.format(total)}
              </p>
            </div>
            <div className="min-w-0 text-right">
              <p className="text-sm font-extrabold text-slate-800">
                {visibleExpenses.length} gasto{visibleExpenses.length === 1 ? '' : 's'}
              </p>
              <p className="mt-1 max-w-sm text-xs text-slate-500">{rangeLabel}</p>
            </div>
          </article>
        </div>

        <div className="panel overflow-hidden p-0">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
            <h2 className="font-extrabold text-slate-950">Movimientos</h2>
            <ReceiptIcon className="size-5 shrink-0 text-slate-400" />
          </div>

          {loading && <p className="empty-state">Cargando gastos…</p>}
          {!loading && loadError && (
            <div className="p-5 sm:p-6">
              <div className="alert-error" role="alert">{loadError}</div>
            </div>
          )}
          {!loading && !loadError && visibleExpenses.length === 0 && (
            <div className="empty-state">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <ReceiptIcon className="size-5" />
              </span>
              <p>No hay gastos que coincidan con estos filtros.</p>
              <button
                className="button-secondary mt-5"
                disabled={cannotCreate}
                type="button"
                onClick={openForm}
              >
                <PlusIcon className="size-4" />
                Nuevo gasto
              </button>
            </div>
          )}

          {!loading && !loadError && groupedExpenses.map(([date, items]) => (
            <section className="border-b border-slate-100 last:border-b-0" key={date}>
              <div className="bg-slate-50/80 px-5 py-2.5 sm:px-6">
                <h3 className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-600">
                  {groupDateLabel(date, today)}
                </h3>
              </div>
              <div className="divide-y divide-slate-100">
                {items.map((expense) => {
                  const time = expenseTime(expense.createdAt)
                  const syncLabel =
                    expense.syncStatus === 'synced'
                      ? 'Sincronizado'
                      : expense.syncStatus === 'error'
                        ? 'Error al sincronizar'
                        : 'Pendiente'
                  const syncClass =
                    expense.syncStatus === 'synced'
                      ? 'text-emerald-600'
                      : expense.syncStatus === 'error'
                        ? 'text-red-600'
                        : 'text-amber-700'

                  return (
                    <article className="flex min-w-0 items-center gap-3 px-5 py-4 sm:gap-4 sm:px-6" key={expense.id}>
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 font-black text-teal-700">
                        {expense.concept.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="overflow-hidden text-ellipsis whitespace-nowrap font-bold text-slate-900">
                          {expense.concept}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-500">
                          <span>
                            {expense.fundingSource === 'central_cash'
                              ? 'Caja Central'
                              : isAdmin
                                ? storeNames.get(expense.storeId) ?? 'Tienda sin nombre'
                                : 'Caja de tienda'}
                          </span>
                          <span aria-hidden="true"> · </span>
                          {time}
                          <span aria-hidden="true"> · </span>
                          {PAYMENT_LABELS[expense.paymentMethod]}
                        </p>
                        <p className={`mt-0.5 text-[11px] font-bold ${syncClass}`}>
                          {expense.syncStatus !== 'synced' && <SyncIcon className="mr-1 inline size-3" />}
                          {syncLabel}
                        </p>
                      </div>
                      <p className="max-w-[42%] shrink-0 text-right text-sm font-black tabular-nums text-slate-950 sm:max-w-none sm:text-base">
                        {currencyFormatter.format(expense.amount)}
                      </p>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <button
        aria-label="Registrar nuevo gasto"
        className="app-fab"
        disabled={cannotCreate}
        ref={addButtonRef}
        title="Nuevo gasto"
        type="button"
        onClick={openForm}
      >
        <PlusIcon className="size-7" />
      </button>

      <AppModal
        closeDisabled={saving}
        closeLabel="Cerrar formulario de gasto"
        eyebrow="Registro local"
        hasUnsavedChanges={isFormDirty}
        initialFocusRef={amountInputRef}
        open={formOpen}
        returnFocusRef={addButtonRef}
        title="Nuevo gasto"
        onClose={closeForm}
      >
        <form onSubmit={submit}>
            {errors.length > 0 && (
              <div className="alert-error mt-5" role="alert">
                {errors.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            )}

            <div className="mt-6 space-y-5">
              {isAdmin ? (
                <label className="field-label">
                  Tienda
                  <select
                    className="field"
                    required
                    value={formStoreId}
                    onChange={(event) => setFormStoreId(event.target.value)}
                  >
                    <option disabled value="">Selecciona una tienda</option>
                    {activeStores.map((store) => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div>
                  <p className="field-label">Tienda</p>
                  <p className="mt-2 rounded-xl bg-slate-50 px-3.5 py-3 text-sm font-bold text-slate-800 ring-1 ring-slate-200">
                    {user.storeName}
                  </p>
                </div>
              )}

              <div>
                <p className="field-label">Fuente de fondos</p>
                <FilterChipGroup
                  ariaLabel="Fuente de fondos del gasto"
                  options={[
                    { value: 'store_cash', label: 'Caja de tienda' },
                    ...(isAdmin
                      ? [{
                          value: 'central_cash' as const,
                          label: 'Caja Central',
                          disabled: !centralAvailable,
                        }]
                      : []),
                  ]}
                  value={fundingSource}
                  onChange={changeFundingSource}
                />
                {isAdmin && !centralAvailable && (
                  <p className="mt-2 text-xs text-slate-500">
                    Caja Central requiere conexión y una sesión Supabase.
                  </p>
                )}
              </div>

              <label className="field-label">
                Monto
                <div className="money-field">
                  <span>$</span>
                  <input
                    inputMode="decimal"
                    min="0.01"
                    placeholder="0.00"
                    ref={amountInputRef}
                    required
                    step="0.01"
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
              </label>

              <label className="field-label">
                Concepto
                <input
                  className="field"
                  maxLength={160}
                  placeholder="Ej. Material de limpieza"
                  required
                  value={concept}
                  onChange={(event) => setConcept(event.target.value)}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field-label">
                  Fecha
                  <input
                    className="field"
                    required
                    type="date"
                    value={formDate}
                    onChange={(event) => setFormDate(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  Forma de pago
                  <select
                    className="field"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                  >
                    {fundingSource === 'central_cash' ? (
                      <option value="efectivo">Efectivo</option>
                    ) : (
                      PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>{PAYMENT_LABELS[method]}</option>
                      ))
                    )}
                  </select>
                </label>
              </div>

              <CashBreakdownControl
                amount={amount}
                bills={bills}
                coinsAmount={coinsAmount}
                open={cashBreakdownOpen}
                showToggle={fundingSource === 'store_cash' && paymentMethod === 'efectivo'}
                toggleDescription="Opcional para gastos desde la tienda."
                visible={cashBreakdownVisible}
                onBillsChange={setBills}
                onCoinsChange={setCoinsAmount}
                onOpenChange={setCashBreakdownOpen}
              />

              <label className="field-label">
                Notas <span className="font-normal text-slate-400">(opcional)</span>
                <textarea
                  className="field min-h-20 resize-y"
                  maxLength={500}
                  placeholder="Información adicional"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                className="button-secondary w-full"
                disabled={saving}
                type="button"
                onClick={closeForm}
              >
                Cancelar
              </button>
              <button className="button-primary w-full" disabled={saving} type="submit">
                {saving ? (
                  <><SyncIcon className="size-4 animate-spin" /> Guardando…</>
                ) : (
                  <><CheckIcon className="size-4" /> Guardar</>
                )}
              </button>
            </div>
        </form>
      </AppModal>
    </section>
  )
}
