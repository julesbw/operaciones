import { useEffect, useMemo, useState } from 'react'
import { BILL_DENOMINATIONS } from '../domain/constants'
import type { Bills, CashClosingDraft, Expense, Store, UserProfile } from '../domain/models'
import { CashIcon, CheckIcon, ReceiptIcon } from '../components/icons'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  calculateClosingSummary,
  closingService,
} from '../services/closingService'
import { expenseService } from '../services/expenseService'
import { formatLongDate, getLocalDate } from '../utils/date'
import { currencyFormatter } from '../utils/money'

type ClosingsPageProps = {
  stores: Store[]
  user: UserProfile
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function ClosingsPage({ stores, user }: ClosingsPageProps) {
  const [storeId, setStoreId] = useState(stores.find((store) => store.status === 'active')?.id ?? '')
  const [date, setDate] = useState(getLocalDate())
  const [draft, setDraft] = useState<CashClosingDraft>()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!storeId) return
    let active = true
    setMessage(undefined)
    void Promise.all([
      closingService.load(storeId, date),
      expenseService.list(storeId, date),
    ])
      .then(([savedDraft, dayExpenses]) => {
        if (!active) return
        setDraft(savedDraft)
        setExpenses(dayExpenses)
      })
      .catch((cause: unknown) => {
        console.error('No fue posible preparar el corte', cause)
        if (active) setError('No fue posible preparar el corte.')
      })
    return () => {
      active = false
    }
  }, [date, storeId])

  const expenseTotal = useMemo(
    () => expenses.reduce((total, expense) => total + expense.amount, 0),
    [expenses],
  )
  const summary = draft ? calculateClosingSummary(draft, expenseTotal) : undefined

  function updateDraft(changes: Partial<CashClosingDraft>) {
    if (draft) setDraft({ ...draft, ...changes })
    setMessage(undefined)
  }

  async function saveDraft() {
    if (!draft) return
    setSaving(true)
    setError(undefined)
    try {
      await closingService.save(draft)
      setMessage('Borrador guardado en este dispositivo.')
    } catch (cause: unknown) {
      console.error('No fue posible guardar el borrador', cause)
      setError('No fue posible guardar el borrador.')
    } finally {
      setSaving(false)
    }
  }

  async function close() {
    if (!draft) return
    setSaving(true)
    setError(undefined)
    try {
      await closingService.close(draft, expenseTotal, user.id)
      setMessage('Corte cerrado y confirmado en Supabase.')
    } catch (cause: unknown) {
      console.error('No fue posible cerrar el corte', cause)
      setError('No fue posible confirmar el cierre. El borrador sigue guardado.')
    } finally {
      setSaving(false)
    }
  }

  if (!draft || !summary) {
    return <p className="empty-state">Preparando corte…</p>
  }

  const canClose = isSupabaseConfigured && navigator.onLine

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Cierre administrativo</p>
          <h1 className="page-title mt-2">Corte de caja</h1>
          <p className="page-subtitle">Ventas, gastos y efectivo conciliados.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select className="compact-field" aria-label="Tienda" value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            {stores.filter((store) => store.status === 'active').map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
          <input className="compact-field" aria-label="Fecha" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
      </div>

      {error && <p className="alert-error mt-6">{error}</p>}
      {message && <p className="alert-success mt-6"><CheckIcon className="size-5" />{message}</p>}

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <article className="panel">
            <div className="flex items-center gap-3">
              <span className="stat-icon bg-teal-50 text-teal-700"><CashIcon className="size-5" /></span>
              <div>
                <p className="eyebrow">{formatLongDate(date)}</p>
                <h2 className="text-xl font-extrabold text-slate-950">Datos del corte</h2>
              </div>
            </div>
            <div className="mt-6 grid gap-5 sm:grid-cols-3">
              <label className="field-label">Ventas brutas
                <input className="field" inputMode="decimal" min="0" step="0.01" type="number" value={draft.grossSales || ''} onChange={(event) => updateDraft({ grossSales: numberValue(event.target.value) })} />
              </label>
              <label className="field-label">Saldo inicial
                <input className="field" inputMode="decimal" min="0" step="0.01" type="number" value={draft.openingBalance || ''} onChange={(event) => updateDraft({ openingBalance: numberValue(event.target.value) })} />
              </label>
              <label className="field-label">Otros movimientos
                <input className="field" inputMode="decimal" step="0.01" type="number" value={draft.otherMovements || ''} onChange={(event) => updateDraft({ otherMovements: numberValue(event.target.value) })} />
              </label>
            </div>
          </article>

          <article className="panel">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Efectivo físico</p>
                <h2 className="mt-1 text-xl font-extrabold text-slate-950">Desglose de billetes</h2>
              </div>
              <p className="text-right text-sm text-slate-500">Contado<br /><strong className="text-lg text-slate-950">{currencyFormatter.format(summary.countedCash)}</strong></p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {BILL_DENOMINATIONS.map((denomination) => (
                <label className="denomination-field" key={denomination.key}>
                  <span>{denomination.label}</span>
                  <input
                    inputMode="numeric"
                    min="0"
                    step="1"
                    type="number"
                    value={draft.bills[denomination.key] || ''}
                    onChange={(event) =>
                      updateDraft({
                        bills: {
                          ...draft.bills,
                          [denomination.key]: Math.max(0, Math.floor(numberValue(event.target.value))),
                        } as Bills,
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </article>

          <article className="panel p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <p className="eyebrow">Importados automáticamente</p>
                <h2 className="mt-1 font-extrabold text-slate-950">Gastos del día</h2>
              </div>
              <strong className="text-lg text-slate-950">{currencyFormatter.format(expenseTotal)}</strong>
            </div>
            {expenses.length === 0 ? (
              <p className="empty-state">No hay gastos registrados.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {expenses.map((expense) => (
                  <div className="flex items-center gap-3 px-5 py-3.5 text-sm sm:px-6" key={expense.id}>
                    <ReceiptIcon className="size-4 text-slate-400" />
                    <span className="flex-1 font-semibold text-slate-700">{expense.concept}</span>
                    <strong className="tabular-nums text-slate-900">{currencyFormatter.format(expense.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>

        <aside className="panel xl:sticky xl:top-24">
          <p className="eyebrow">Resumen financiero</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Resultado del corte</h2>
          <dl className="mt-6 space-y-4 text-sm">
            <div className="summary-row"><dt>Ventas brutas</dt><dd>{currencyFormatter.format(draft.grossSales)}</dd></div>
            <div className="summary-row text-red-700"><dt>Gastos del día</dt><dd>− {currencyFormatter.format(expenseTotal)}</dd></div>
            <div className="summary-row"><dt>Otros movimientos</dt><dd>{currencyFormatter.format(draft.otherMovements)}</dd></div>
            <div className="summary-row border-t border-slate-200 pt-4 font-extrabold text-slate-950"><dt>Ingreso neto</dt><dd>{currencyFormatter.format(summary.netIncome)}</dd></div>
            <div className="summary-row"><dt>Efectivo esperado</dt><dd>{currencyFormatter.format(summary.expectedCash)}</dd></div>
            <div className="summary-row"><dt>Efectivo contado</dt><dd>{currencyFormatter.format(summary.countedCash)}</dd></div>
          </dl>
          <div className={`mt-6 rounded-2xl p-5 ${summary.difference === 0 ? 'bg-emerald-50 text-emerald-900' : summary.difference > 0 ? 'bg-blue-50 text-blue-900' : 'bg-red-50 text-red-900'}`}>
            <p className="text-xs font-bold uppercase tracking-wider">Diferencia</p>
            <p className="mt-1 text-3xl font-black tracking-tight">{currencyFormatter.format(summary.difference)}</p>
          </div>
          <label className="field-label mt-5">Observaciones
            <textarea className="field min-h-20 resize-y" value={draft.notes ?? ''} onChange={(event) => updateDraft({ notes: event.target.value })} />
          </label>
          <button className="button-secondary mt-5 w-full" disabled={saving} type="button" onClick={() => void saveDraft()}>
            Guardar borrador
          </button>
          <button className="button-primary mt-3 w-full" disabled={saving || !canClose} type="button" onClick={() => void close()}>
            <CheckIcon className="size-4" /> Cerrar corte
          </button>
          {!canClose && (
            <p className="mt-3 text-center text-xs leading-5 text-slate-400">
              El cierre definitivo requiere conexión con Supabase.
            </p>
          )}
        </aside>
      </div>
    </section>
  )
}
