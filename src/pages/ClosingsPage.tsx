import { useEffect, useMemo, useRef, useState } from 'react'
import { CashIcon, CheckIcon, ReceiptIcon, StoreIcon } from '../components/icons'
import { BILL_DENOMINATIONS } from '../domain/constants'
import type {
  Bills,
  CashClosingDraft,
  CashClosingStep,
  Expense,
  Store,
  UserProfile,
} from '../domain/models'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  applyClosingSummary,
  calculateClosingSummary,
  calculateExpenseTotals,
  closingService,
  validateClosingBillCounts,
  type ClosingExpenseTotals,
} from '../services/closingService'
import { expenseService } from '../services/expenseService'
import { formatLongDate, getLocalDate } from '../utils/date'
import { currencyFormatter } from '../utils/money'

type ClosingsPageProps = {
  stores: Store[]
  user: UserProfile
}

type DraftSaveState = 'idle' | 'saving' | 'saved'

const STEPS: Array<{ id: CashClosingStep; label: string }> = [
  { id: 1, label: 'Ventas' },
  { id: 2, label: 'Efectivo' },
  { id: 3, label: 'Saldo' },
  { id: 4, label: 'Resumen' },
]

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function moneyValue(value: string): number {
  return Math.round(numberValue(value) * 100) / 100
}

function StepProgress({ currentStep }: { currentStep: CashClosingStep }) {
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Progreso del corte">
      {STEPS.map((step) => {
        const active = step.id === currentStep
        const completed = step.id < currentStep
        return (
          <li className="min-w-0 text-center" key={step.id}>
            <div
              aria-current={active ? 'step' : undefined}
              className={`mx-auto flex size-8 items-center justify-center rounded-full text-xs font-black ${
                active
                  ? 'bg-teal-700 text-white ring-4 ring-teal-100'
                  : completed
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {completed ? <CheckIcon className="size-4" /> : step.id}
            </div>
            <p className={`mt-2 truncate text-[11px] font-bold ${active ? 'text-teal-800' : 'text-slate-400'}`}>
              {step.label}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

export function ClosingsPage({ stores, user }: ClosingsPageProps) {
  const activeStores = stores.filter((store) => store.status === 'active')
  const [storeId, setStoreId] = useState(activeStores[0]?.id ?? '')
  const [date, setDate] = useState(getLocalDate())
  const [draft, setDraft] = useState<CashClosingDraft>()
  const draftRef = useRef<CashClosingDraft | undefined>(undefined)
  const [pendingDraft, setPendingDraft] = useState<CashClosingDraft>()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<DraftSaveState>('idle')
  const saveSequence = useRef(0)
  const [closed, setClosed] = useState(false)
  const [showExpenseDetails, setShowExpenseDetails] = useState(false)
  const [showCashDetails, setShowCashDetails] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  const expenseTotals = useMemo(
    () => calculateExpenseTotals(expenses),
    [expenses],
  )
  const summary = useMemo(
    () => (draft ? calculateClosingSummary(draft, expenseTotals) : undefined),
    [draft, expenseTotals],
  )
  const selectedStore = stores.find((store) => store.id === storeId)

  function setCurrentDraft(nextDraft: CashClosingDraft | undefined) {
    draftRef.current = nextDraft
    setDraft(nextDraft)
  }

  useEffect(() => {
    const selectableStores = stores.filter((store) => store.status === 'active')
    if (selectableStores.some((store) => store.id === storeId)) return
    setStoreId(selectableStores[0]?.id ?? '')
  }, [storeId, stores])

  useEffect(() => {
    if (!storeId) {
      setLoading(false)
      setCurrentDraft(undefined)
      return
    }

    let active = true
    setLoading(true)
    setClosed(false)
    setError(undefined)
    setMessage(undefined)
    setPendingDraft(undefined)
    setCurrentDraft(undefined)

    void Promise.all([
      closingService.load(storeId, date, user.id),
      expenseService.list(storeId, date),
    ])
      .then(([savedDraft, dayExpenses]) => {
        if (!active) return
        const totals = calculateExpenseTotals(dayExpenses)
        setExpenses(dayExpenses)
        if (savedDraft) {
          setPendingDraft(applyClosingSummary(savedDraft, totals))
          setSaveState('saved')
        } else {
          setCurrentDraft(
            applyClosingSummary(
              closingService.create(storeId, date, user.id),
              totals,
            ),
          )
          setSaveState('idle')
        }
      })
      .catch((cause: unknown) => {
        console.error('No fue posible preparar el corte', cause)
        if (active) setError('No fue posible preparar el corte.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [date, storeId, user.id])

  function persistDraft(
    nextDraft: CashClosingDraft,
    totals: ClosingExpenseTotals = expenseTotals,
  ) {
    const enrichedDraft = applyClosingSummary(nextDraft, totals)
    setCurrentDraft(enrichedDraft)
    setMessage(undefined)
    setSaveState('saving')
    const sequence = ++saveSequence.current

    void closingService
      .save(enrichedDraft, totals)
      .then(() => {
        if (saveSequence.current === sequence) setSaveState('saved')
      })
      .catch((cause: unknown) => {
        console.error('No fue posible guardar el borrador', cause)
        if (saveSequence.current === sequence) {
          setSaveState('idle')
          setError('No fue posible guardar el borrador en este dispositivo.')
        }
      })
  }

  function updateDraft(changes: Partial<CashClosingDraft>) {
    const current = draftRef.current
    if (!current) return
    persistDraft({ ...current, ...changes })
  }

  async function goToStep(step: CashClosingStep) {
    const current = draftRef.current
    if (!current) return

    if (step === 4) {
      try {
        const latestExpenses = await expenseService.list(storeId, date)
        const totals = calculateExpenseTotals(latestExpenses)
        setExpenses(latestExpenses)
        persistDraft({ ...current, currentStep: step }, totals)
        return
      } catch (cause: unknown) {
        console.error('No fue posible actualizar los gastos del corte', cause)
        setError('No fue posible actualizar los gastos del día.')
        return
      }
    }

    persistDraft({ ...current, currentStep: step })
  }

  function continuePendingDraft() {
    if (!pendingDraft) return
    setCurrentDraft(pendingDraft)
    setPendingDraft(undefined)
    setSaveState('saved')
  }

  async function discardPendingDraft() {
    if (!pendingDraft) return
    setSaving(true)
    setError(undefined)
    try {
      await closingService.discard(pendingDraft.id)
      saveSequence.current += 1
      setPendingDraft(undefined)
      setCurrentDraft(
        applyClosingSummary(
          closingService.create(storeId, date, user.id),
          expenseTotals,
        ),
      )
      setSaveState('idle')
      setMessage('El borrador anterior fue descartado.')
    } catch (cause: unknown) {
      console.error('No fue posible descartar el borrador', cause)
      setError('No fue posible descartar el borrador.')
    } finally {
      setSaving(false)
    }
  }

  async function close() {
    const current = draftRef.current
    if (!current) return
    setSaving(true)
    setError(undefined)
    try {
      const latestDraft = await closingService.save(current, expenseTotals)
      await closingService.close(latestDraft, expenseTotals, user.id)
      saveSequence.current += 1
      setCurrentDraft(undefined)
      setClosed(true)
      setMessage('Corte cerrado y confirmado en Supabase.')
    } catch (cause: unknown) {
      console.error('No fue posible cerrar el corte', cause)
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible confirmar el cierre. El borrador sigue guardado.',
      )
    } finally {
      setSaving(false)
    }
  }

  const canClose = isSupabaseConfigured && navigator.onLine
  const balanceErrors = draft ? validateClosingBillCounts(draft) : []
  const invalidCashBalance = balanceErrors.length > 0

  return (
    <section className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Cierre administrativo</p>
          <h1 className="page-title mt-2">Corte de caja</h1>
          <p className="page-subtitle">Completa una tarea a la vez.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            aria-label="Tienda"
            className="compact-field"
            disabled={saving}
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
          >
            {activeStores.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
          <input
            aria-label="Fecha"
            className="compact-field"
            disabled={saving}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      </div>

      {error && <p className="alert-error mt-6">{error}</p>}
      {message && (
        <p className="alert-success mt-6"><CheckIcon className="size-5" />{message}</p>
      )}

      {activeStores.length === 0 && (
        <div className="panel mt-8 border-dashed text-center">
          <StoreIcon className="mx-auto size-8 text-slate-300" />
          <p className="mt-3 font-bold text-slate-700">No hay tiendas activas</p>
        </div>
      )}

      {loading && <p className="empty-state">Preparando corte…</p>}

      {!loading && pendingDraft && (
        <article className="panel mx-auto mt-8 max-w-xl text-center">
          <span className="stat-icon mx-auto bg-amber-50 text-amber-700">
            <CashIcon className="size-5" />
          </span>
          <p className="eyebrow mt-5">Corte pendiente</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">
            {selectedStore?.name}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {formatLongDate(date)} · Paso {pendingDraft.currentStep} de 4
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button className="button-primary" type="button" onClick={continuePendingDraft}>
              Continuar corte
            </button>
            <button
              className="button-secondary"
              disabled={saving}
              type="button"
              onClick={() => void discardPendingDraft()}
            >
              Descartar
            </button>
          </div>
        </article>
      )}

      {!loading && closed && (
        <article className="panel mx-auto mt-8 max-w-xl text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
            <CheckIcon className="size-7" />
          </span>
          <h2 className="mt-5 text-2xl font-black text-slate-950">Corte confirmado</h2>
          <p className="mt-2 text-sm text-slate-500">
            {selectedStore?.name} · {formatLongDate(date)}
          </p>
        </article>
      )}

      {!loading && draft && summary && (
        <div className="mt-8">
          <div className="panel mx-auto max-w-2xl py-4">
            <StepProgress currentStep={draft.currentStep} />
          </div>

          <div className="mx-auto mt-6 max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <p className="font-bold text-slate-500">
                Paso {draft.currentStep} de 4 · {selectedStore?.name} · {formatLongDate(date)}
              </p>
              <p className="font-semibold text-slate-400" aria-live="polite">
                {saveState === 'saving'
                  ? 'Guardando borrador…'
                  : saveState === 'saved'
                    ? 'Borrador guardado'
                    : 'El borrador se guardará al continuar'}
              </p>
            </div>

            {draft.currentStep === 1 && (
              <article className="panel">
                <p className="eyebrow">Ventas brutas</p>
                <h2 className="mt-2 text-2xl font-black text-slate-950">¿Cuánto vendió la tienda?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Captura el total vendido antes de descontar gastos. No representa necesariamente el efectivo físico.
                </p>
                <label className="field-label mt-8">Ventas brutas
                  <div className="money-field">
                    <span>$</span>
                    <input
                      autoFocus
                      inputMode="decimal"
                      min="0"
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                      value={draft.grossSales || ''}
                      onChange={(event) =>
                        updateDraft({ grossSales: moneyValue(event.target.value) })
                      }
                    />
                  </div>
                </label>
                <label className="field-label mt-6">Notas opcionales
                  <textarea
                    className="field min-h-24 resize-y"
                    maxLength={1000}
                    placeholder="Observaciones del corte"
                    value={draft.notes ?? ''}
                    onChange={(event) => updateDraft({ notes: event.target.value })}
                  />
                </label>
                <div className="mt-8 flex justify-end">
                  <button className="button-primary" type="button" onClick={() => void goToStep(2)}>
                    Continuar
                  </button>
                </div>
              </article>
            )}

            {draft.currentStep === 2 && (
              <article className="panel p-0">
                <div className="px-5 py-5 sm:px-6">
                  <p className="eyebrow">Efectivo</p>
                  <h2 className="mt-2 text-2xl font-black text-slate-950">Cuenta el efectivo físico</h2>
                  <p className="mt-2 text-sm text-slate-500">Captura cantidades de billetes; en monedas registra el monto total.</p>
                </div>
                <div className="divide-y divide-slate-100 border-y border-slate-200 px-5 sm:px-6">
                  {BILL_DENOMINATIONS.map((denomination) => {
                    const isCoins = denomination.key === 'monedas'
                    const value = draft.bills[denomination.key]
                    const subtotal = isCoins ? value : value * denomination.value
                    return (
                      <label
                        className="grid min-h-16 grid-cols-[minmax(3.5rem,0.8fr)_minmax(4.25rem,1fr)_minmax(4.5rem,auto)] items-center gap-2 sm:grid-cols-[5rem_1fr_minmax(5rem,auto)] sm:gap-3"
                        key={denomination.key}
                      >
                        <span className="text-sm font-bold text-slate-700">{denomination.label}</span>
                        <input
                          aria-label={isCoins ? 'Monto total en monedas' : `Cantidad de billetes de ${denomination.value} pesos`}
                          className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 text-center text-base font-bold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15"
                          inputMode={isCoins ? 'decimal' : 'numeric'}
                          min="0"
                          placeholder="0"
                          step={isCoins ? '0.01' : '1'}
                          type="number"
                          value={value || ''}
                          onChange={(event) => {
                            const parsed = numberValue(event.target.value)
                            updateDraft({
                              bills: {
                                ...draft.bills,
                                [denomination.key]: isCoins
                                  ? Math.round(parsed * 100) / 100
                                  : Math.floor(parsed),
                              } as Bills,
                            })
                          }}
                        />
                        <span className="text-right text-sm font-extrabold tabular-nums text-slate-900">
                          {currencyFormatter.format(subtotal)}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <div className="flex items-center justify-between gap-4 bg-slate-50 px-5 py-5 sm:px-6">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700">Efectivo contado</p>
                    <p className="mt-1 text-xs text-slate-500">Actualizado en tiempo real</p>
                  </div>
                  <p className="min-w-0 text-right text-xl font-black tabular-nums text-slate-950 min-[360px]:text-2xl">
                    {currencyFormatter.format(summary.countedCash)}
                  </p>
                </div>
                <div className="flex justify-between gap-3 px-5 py-5 sm:px-6">
                  <button className="button-secondary" type="button" onClick={() => void goToStep(1)}>Anterior</button>
                  <button className="button-primary" type="button" onClick={() => void goToStep(3)}>Continuar</button>
                </div>
              </article>
            )}

            {draft.currentStep === 3 && (
              <article className="panel px-3 sm:px-6">
                <p className="eyebrow">Saldo de caja</p>
                <h2 className="mt-2 text-2xl font-black text-slate-950">¿Qué efectivo permanece?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Indica cuántos billetes de cada denominación se quedan en caja. El retiro se calcula automáticamente.
                </p>
                <div className="summary-strip mt-6">
                  <span className="text-sm font-bold text-slate-600">Efectivo contado</span>
                  <strong className="text-2xl font-black text-slate-950">
                    {currencyFormatter.format(summary.countedCash)}
                  </strong>
                </div>
                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
                  <div className="grid grid-cols-[minmax(3.25rem,1fr)_2.625rem_3.5rem_2.75rem] gap-1 bg-slate-50 px-2 py-3 text-center text-[9px] font-extrabold uppercase leading-3 tracking-normal text-slate-400 sm:grid-cols-[minmax(6rem,1fr)_5rem_7rem_5rem] sm:gap-2 sm:px-4 sm:text-[10px] sm:tracking-wider">
                    <span className="text-left">Denominación</span>
                    <span>Contado</span>
                    <span>Permanece</span>
                    <span>Retirar</span>
                  </div>
                  <div className="divide-y divide-slate-100 px-2 sm:px-4">
                    {BILL_DENOMINATIONS.map((denomination, index) => {
                      const isCoins = denomination.key === 'monedas'
                      const counted = draft.bills[denomination.key]
                      const balance = draft.balanceBills[denomination.key]
                      const withdraw = summary.withdrawBills[denomination.key]
                      const invalid = balance > counted
                      return (
                        <label
                          className="grid min-h-16 grid-cols-[minmax(3.25rem,1fr)_2.625rem_3.5rem_2.75rem] items-center gap-1 sm:grid-cols-[minmax(6rem,1fr)_5rem_7rem_5rem] sm:gap-2"
                          key={denomination.key}
                        >
                          <span className="text-sm font-bold text-slate-700">{denomination.label}</span>
                          <span className="text-center text-sm font-semibold tabular-nums text-slate-500">
                            {counted}
                          </span>
                          <input
                            aria-label={`${denomination.label} que permanecen en caja`}
                            autoFocus={index === 0}
                            className={`h-10 min-w-0 rounded-lg border px-1 text-center font-bold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 sm:px-2 ${invalid ? 'border-red-400 bg-red-50 text-red-800' : 'border-slate-300'}`}
                            inputMode={isCoins ? 'decimal' : 'numeric'}
                            max={counted}
                            min="0"
                            placeholder="0"
                            step={isCoins ? '0.01' : '1'}
                            type="number"
                            value={balance || ''}
                            onChange={(event) => {
                              const parsed = numberValue(event.target.value)
                              updateDraft({
                                balanceBills: {
                                  ...draft.balanceBills,
                                  [denomination.key]: isCoins
                                    ? Math.round(parsed * 100) / 100
                                    : Math.floor(parsed),
                                } as Bills,
                              })
                            }}
                          />
                          <span className={`text-center text-sm font-extrabold tabular-nums ${invalid ? 'text-red-700' : 'text-teal-800'}`}>
                            {withdraw}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
                {invalidCashBalance && (
                  <p className="alert-error mt-4">
                    {balanceErrors[0]}
                  </p>
                )}
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-5 text-slate-900">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Saldo en caja</p>
                    <p className="mt-1 text-2xl font-black">
                      {currencyFormatter.format(summary.cashBalance)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-teal-50 p-5 text-teal-950">
                    <p className="text-xs font-bold uppercase tracking-wider">Efectivo a retirar</p>
                    <p className="mt-1 text-2xl font-black">
                      {currencyFormatter.format(summary.cashToWithdraw)}
                    </p>
                  </div>
                </div>
                <div className="mt-8 flex justify-between gap-3">
                  <button className="button-secondary" type="button" onClick={() => void goToStep(2)}>Anterior</button>
                  <button
                    className="button-primary"
                    disabled={invalidCashBalance}
                    type="button"
                    onClick={() => void goToStep(4)}
                  >
                    Continuar
                  </button>
                </div>
              </article>
            )}

            {draft.currentStep === 4 && (
              <div className="space-y-5">
                <article className="panel">
                  <p className="eyebrow">Resumen</p>
                  <h2 className="mt-2 text-2xl font-black text-slate-950">Revisa antes de confirmar</h2>
                  <p className="mt-2 text-sm text-slate-500">{selectedStore?.name} · {formatLongDate(date)}</p>

                  <dl className="mt-7 space-y-4 text-sm">
                    <div className="summary-row">
                      <dt>Ventas brutas</dt>
                      <dd className="flex items-center gap-3 font-bold">
                        {currencyFormatter.format(draft.grossSales)}
                        <button className="text-action text-xs" type="button" onClick={() => void goToStep(1)}>Editar</button>
                      </dd>
                    </div>
                    <div className="summary-row text-red-700">
                      <dt>Gastos del día</dt>
                      <dd>− {currencyFormatter.format(summary.expensesTotal)}</dd>
                    </div>
                    <div className="summary-row border-t border-slate-200 pt-4 font-extrabold text-slate-950">
                      <dt>Resultado después de gastos</dt>
                      <dd>{currencyFormatter.format(summary.resultAfterExpenses)}</dd>
                    </div>
                  </dl>

                  <button
                    className="text-action mt-5"
                    type="button"
                    onClick={() => setShowExpenseDetails((visible) => !visible)}
                  >
                    <ReceiptIcon className="size-4" />
                    {showExpenseDetails ? 'Ocultar gastos' : 'Ver detalle de gastos'}
                  </button>
                  {showExpenseDetails && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                      {expenses.length === 0 ? (
                        <p className="p-4 text-sm text-slate-400">No hay gastos registrados.</p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {expenses.map((expense) => (
                            <div className="flex items-center gap-3 px-4 py-3 text-sm" key={expense.id}>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-slate-700">{expense.concept}</p>
                                <p className="mt-0.5 text-xs capitalize text-slate-400">{expense.paymentMethod}</p>
                              </div>
                              <strong>{currencyFormatter.format(expense.amount)}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>

                <article className="panel">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="eyebrow">Conciliación de efectivo</p>
                      <h3 className="mt-2 text-xl font-black text-slate-950">Caja física</h3>
                    </div>
                    <button className="text-action text-xs" type="button" onClick={() => void goToStep(2)}>Editar</button>
                  </div>
                  <dl className="mt-6 space-y-4 text-sm">
                    <div className="summary-row"><dt>Ventas brutas</dt><dd>{currencyFormatter.format(draft.grossSales)}</dd></div>
                    <div className="summary-row text-red-700"><dt>Gastos en efectivo</dt><dd>− {currencyFormatter.format(summary.cashExpensesTotal)}</dd></div>
                    <div className="summary-row border-t border-slate-200 pt-4 font-extrabold"><dt>Efectivo esperado</dt><dd>{currencyFormatter.format(summary.expectedCash)}</dd></div>
                    <div className="summary-row"><dt>Efectivo contado</dt><dd>{currencyFormatter.format(summary.countedCash)}</dd></div>
                    <div className="summary-row">
                      <dt>Saldo en caja</dt>
                      <dd className="flex items-center gap-3">
                        {currencyFormatter.format(summary.cashBalance)}
                        <button className="text-action text-xs" type="button" onClick={() => void goToStep(3)}>Editar</button>
                      </dd>
                    </div>
                    <div className="summary-row font-extrabold text-teal-800"><dt>Efectivo a retirar</dt><dd>{currencyFormatter.format(summary.cashToWithdraw)}</dd></div>
                  </dl>

                  <div className={`mt-6 rounded-2xl p-5 ${summary.difference === 0 ? 'bg-emerald-50 text-emerald-900' : summary.difference > 0 ? 'bg-blue-50 text-blue-900' : 'bg-red-50 text-red-900'}`}>
                    <p className="text-xs font-bold uppercase tracking-wider">Diferencia de caja</p>
                    <p className="mt-1 text-3xl font-black">{currencyFormatter.format(summary.difference)}</p>
                    <p className="mt-2 text-xs opacity-75">Contado menos efectivo esperado</p>
                  </div>

                  <button
                    className="text-action mt-5"
                    type="button"
                    onClick={() => setShowCashDetails((visible) => !visible)}
                  >
                    <CashIcon className="size-4" />
                    {showCashDetails ? 'Ocultar desglose' : 'Ver desglose de efectivo'}
                  </button>
                  {showCashDetails && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                      <div className="grid grid-cols-4 gap-2 bg-slate-50 px-3 py-2.5 text-center text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                        <span className="text-left">Denom.</span>
                        <span>Contado</span>
                        <span>Saldo</span>
                        <span>Retiro</span>
                      </div>
                      <div className="divide-y divide-slate-100 px-3">
                        {BILL_DENOMINATIONS.map((denomination) => (
                          <div className="grid grid-cols-4 gap-2 py-2.5 text-center text-sm" key={denomination.key}>
                            <span className="text-left font-semibold text-slate-600">{denomination.label}</span>
                            <span>{draft.bills[denomination.key]}</span>
                            <span>{draft.balanceBills[denomination.key]}</span>
                            <strong className="text-teal-800">{summary.withdrawBills[denomination.key]}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </article>

                <article className="panel">
                  <p className="text-sm font-semibold text-slate-500">
                    Al confirmar, el borrador pasará a cerrado y se enviará a Supabase.
                  </p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button className="button-secondary" type="button" onClick={() => void goToStep(3)}>Anterior</button>
                    <button
                      className="button-primary"
                      disabled={saving || !canClose || invalidCashBalance}
                      type="button"
                      onClick={() => void close()}
                    >
                      <CheckIcon className="size-4" />
                      {saving ? 'Confirmando…' : 'Confirmar corte'}
                    </button>
                  </div>
                  {!canClose && (
                    <p className="mt-3 text-center text-xs leading-5 text-slate-400">
                      El cierre definitivo requiere conexión con Supabase.
                    </p>
                  )}
                </article>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
