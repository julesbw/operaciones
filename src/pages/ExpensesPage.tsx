import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckIcon, PlusIcon, ReceiptIcon, SyncIcon } from '../components/icons'
import {
  PAYMENT_METHODS,
  type Expense,
  type PaymentMethod,
  type Store,
  type UserProfile,
} from '../domain/models'
import {
  expenseService,
  ExpenseValidationError,
} from '../services/expenseService'
import { syncService } from '../services/syncService'
import { formatLongDate, getLocalDate } from '../utils/date'
import { currencyFormatter } from '../utils/money'

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
}

type ExpensesPageProps = {
  stores: Store[]
  user: UserProfile
  onDataChanged: () => void
}

export function ExpensesPage({ stores, user, onDataChanged }: ExpensesPageProps) {
  const initialStore = user.storeId ?? stores.find((store) => store.status === 'active')?.id ?? ''
  const [storeId, setStoreId] = useState(initialStore)
  const [businessDate, setBusinessDate] = useState(getLocalDate())
  const [amount, setAmount] = useState('')
  const [concept, setConcept] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo')
  const [notes, setNotes] = useState('')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    try {
      setExpenses(await expenseService.list(storeId, businessDate))
    } finally {
      setLoading(false)
    }
  }, [businessDate, storeId])

  useEffect(() => {
    void load()
  }, [load])

  const total = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses],
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])
    setSaved(false)
    setSaving(true)

    try {
      await expenseService.create(
        {
          storeId,
          businessDate,
          amount: Number(amount),
          concept,
          paymentMethod,
          notes,
        },
        user.id,
      )
      setAmount('')
      setConcept('')
      setNotes('')
      setSaved(true)
      await load()
      onDataChanged()
      void syncService.process().then(onDataChanged)
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

  return (
    <section>
      <div>
        <p className="eyebrow">Movimientos de caja</p>
        <h1 className="page-title mt-2">Gastos</h1>
        <p className="page-subtitle">Captura rápida, incluso sin conexión.</p>
      </div>

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="min-w-0 space-y-5">
          <article className="summary-strip">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Total · {formatLongDate(businessDate)}
              </p>
              <p className="mt-1 text-3xl font-black tracking-tight text-slate-950">
                {currencyFormatter.format(total)}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <ReceiptIcon className="size-4" />
              {expenses.length} movimiento{expenses.length === 1 ? '' : 's'}
            </div>
          </article>

          <div className="panel p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 className="font-extrabold text-slate-950">Gastos del día</h2>
              <label className="sr-only" htmlFor="expense-date-filter">
                Fecha a consultar
              </label>
              <input
                className="compact-field"
                id="expense-date-filter"
                type="date"
                value={businessDate}
                onChange={(event) => setBusinessDate(event.target.value)}
              />
            </div>

            <div className="divide-y divide-slate-100">
              {loading && <p className="empty-state">Cargando gastos…</p>}
              {!loading && expenses.length === 0 && (
                <div className="empty-state">
                  <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                    <ReceiptIcon className="size-5" />
                  </span>
                  Aún no hay gastos para esta fecha.
                </div>
              )}
              {expenses.map((expense) => (
                <article className="flex items-center gap-4 px-5 py-4 sm:px-6" key={expense.id}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 font-black text-teal-700">
                    {expense.concept.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{expense.concept}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                      {PAYMENT_LABELS[expense.paymentMethod]}
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          expense.syncStatus === 'synced'
                            ? 'text-emerald-600'
                            : expense.syncStatus === 'error'
                              ? 'text-red-600'
                              : 'text-amber-600'
                        }
                      >
                        {expense.syncStatus === 'synced' ? 'Sincronizado' : 'Pendiente'}
                      </span>
                    </p>
                  </div>
                  <p className="shrink-0 font-extrabold tabular-nums text-slate-950">
                    {currencyFormatter.format(expense.amount)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>

        <form className="panel xl:sticky xl:top-24" onSubmit={submit}>
          <div className="flex items-center gap-3">
            <span className="stat-icon bg-teal-50 text-teal-700">
              <PlusIcon className="size-5" />
            </span>
            <div>
              <p className="eyebrow">Registro rápido</p>
              <h2 className="text-xl font-extrabold text-slate-950">Nuevo gasto</h2>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="alert-error mt-5" role="alert">
              {errors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}
          {saved && (
            <div className="alert-success mt-5" role="status">
              <CheckIcon className="size-5" />
              Gasto guardado en este dispositivo.
            </div>
          )}

          <div className="mt-6 space-y-5">
            {user.role === 'admin' ? (
              <label className="field-label">
                Tienda
                <select className="field" value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                  {stores
                    .filter((store) => store.status === 'active')
                    .map((store) => (
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

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <label className="field-label">
                Fecha
                <input className="field" required type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
              </label>
              <label className="field-label">
                Monto
                <div className="money-field">
                  <span>$</span>
                  <input
                    autoFocus
                    inputMode="decimal"
                    min="0.01"
                    placeholder="0.00"
                    required
                    step="0.01"
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
              </label>
            </div>

            <label className="field-label">
              Concepto
              <input className="field" maxLength={160} placeholder="Ej. Material de limpieza" required value={concept} onChange={(event) => setConcept(event.target.value)} />
            </label>
            <label className="field-label">
              Forma de pago
              <select className="field" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>{PAYMENT_LABELS[method]}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Notas <span className="font-normal text-slate-400">(opcional)</span>
              <textarea className="field min-h-20 resize-y" maxLength={500} placeholder="Información adicional" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </div>

          <button className="button-primary mt-6 w-full" disabled={saving} type="submit">
            {saving ? (
              <><SyncIcon className="size-4 animate-spin" /> Guardando…</>
            ) : (
              <><CheckIcon className="size-4" /> Guardar gasto</>
            )}
          </button>
          <p className="mt-3 text-center text-xs text-slate-400">
            Se guarda localmente antes de sincronizar.
          </p>
        </form>
      </div>
    </section>
  )
}
