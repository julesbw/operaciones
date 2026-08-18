import { useEffect, useMemo, useRef, useState } from 'react'
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
  ReceiptIcon,
  SyncIcon,
  TransferIcon,
  WalletIcon,
} from '../components/icons'
import { BILL_DENOMINATIONS } from '../domain/constants'
import type {
  Bills,
  CashClosingDraft,
  CashClosingStep,
  CentralCashBills,
  ClosingAdjustment,
  Store,
  UserProfile,
} from '../domain/models'
import {
  calculateEffectiveClosing,
  limitAdjustmentToAvailableStock,
} from '../domain/closingAdjustments'
import { isSupabaseConfigured } from '../lib/supabase'
import type { CashClosingRow } from '../types/database'
import {
  applyClosingSummary,
  calculateClosingSummary,
  type CashClosingDetail,
  ClosingDomainError,
  closingService,
  validateClosingBillCounts,
  type ClosingOperationalSummary,
  type ClosingOperationalTotals,
} from '../services/closingService'
import {
  closingAdjustmentService,
  type ClosingAdjustmentLockState,
} from '../services/closingAdjustmentService'
import { connectivityService } from '../services/connectivityService'
import { syncService } from '../services/syncService'
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

type ClosingStatusFilter = 'all' | 'closed' | 'draft'

const CLOSING_STATUS_OPTIONS: FilterChipOption<ClosingStatusFilter>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'closed', label: 'Cerrados' },
  { value: 'draft', label: 'Borradores' },
]

const CLOSING_TIME_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  hour: 'numeric',
  minute: '2-digit',
})

const COMPACT_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

type ClosingView =
  | { kind: 'history' }
  | { kind: 'flow'; storeId: string; businessDate: string }
  | { kind: 'detail'; closingId: string }

type ClosingHistoryEntry =
  | { kind: 'draft'; draft: CashClosingDraft }
  | { kind: 'closed'; closing: CashClosingRow }

function formatClosingTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : CLOSING_TIME_FORMATTER.format(date)
}

function compactDate(value: string): string {
  return COMPACT_DATE_FORMATTER.format(new Date(`${value}T12:00:00`)).replace(
    '.',
    '',
  )
}

export function reconcileDraftSelection(
  draft: CashClosingDraft,
  candidates: ClosingOperationalSummary,
): CashClosingDraft {
  const expenseIds = candidates.expenses.map((expense) => expense.id)
  const transferIds = candidates.outgoingTransfers.map((transfer) => transfer.id)
  const paymentIds = candidates.storeCashPayments.map((payment) => payment.id)
  const purchasePaymentIds = candidates.storeCashPurchases.map(
    ({ payment }) => payment.id,
  )
  if (!draft.movementSelectionInitialized) {
    return {
      ...draft,
      selectedExpenseIds: expenseIds,
      selectedTransferIds: transferIds,
      selectedPaymentIds: paymentIds,
      selectedPurchasePaymentIds: purchasePaymentIds,
      knownExpenseIds: expenseIds,
      knownTransferIds: transferIds,
      knownPaymentIds: paymentIds,
      knownPurchasePaymentIds: purchasePaymentIds,
      movementSelectionInitialized: true,
    }
  }

  const eligibleExpenseIds = new Set(expenseIds)
  const eligibleTransferIds = new Set(transferIds)
  const eligiblePaymentIds = new Set(paymentIds)
  const eligiblePurchasePaymentIds = new Set(purchasePaymentIds)
  const knownExpenseIds = new Set(draft.knownExpenseIds)
  const knownTransferIds = new Set(draft.knownTransferIds)
  const knownPaymentIds = new Set(draft.knownPaymentIds)
  const knownPurchasePaymentIds = new Set(draft.knownPurchasePaymentIds)
  return {
    ...draft,
    selectedExpenseIds: [
      ...draft.selectedExpenseIds.filter((id) => eligibleExpenseIds.has(id)),
      ...expenseIds.filter((id) => !knownExpenseIds.has(id)),
    ],
    selectedTransferIds: [
      ...draft.selectedTransferIds.filter((id) => eligibleTransferIds.has(id)),
      ...transferIds.filter((id) => !knownTransferIds.has(id)),
    ],
    selectedPaymentIds: [
      ...draft.selectedPaymentIds.filter((id) => eligiblePaymentIds.has(id)),
      ...paymentIds.filter((id) => !knownPaymentIds.has(id)),
    ],
    selectedPurchasePaymentIds: [
      ...draft.selectedPurchasePaymentIds.filter((id) =>
        eligiblePurchasePaymentIds.has(id),
      ),
      ...purchasePaymentIds.filter(
        (id) => !knownPurchasePaymentIds.has(id),
      ),
    ],
    knownExpenseIds: expenseIds,
    knownTransferIds: transferIds,
    knownPaymentIds: paymentIds,
    knownPurchasePaymentIds: purchasePaymentIds,
  }
}

function ClosingAdjustmentForm({
  closingId,
  availableStock,
  networkAvailable,
  onCreated,
  onClose,
}: {
  closingId: string
  availableStock: Bills
  networkAvailable: boolean
  onCreated: (adjustment: ClosingAdjustment) => void
  onClose: () => void
}) {
  const [type, setType] = useState<'inflow' | 'outflow'>('inflow')
  const [amount, setAmount] = useState('')
  const [concept, setConcept] = useState('')
  const [notes, setNotes] = useState('')
  const [coinsAmount, setCoinsAmount] = useState('')
  const [bills, setBills] = useState<CentralCashBills>({
    b1000: 0, b500: 0, b200: 0, b100: 0, b50: 0, b20: 0,
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const billTotal =
    bills.b1000 * 1000 + bills.b500 * 500 + bills.b200 * 200 +
    bills.b100 * 100 + bills.b50 * 50 + bills.b20 * 20 + Number(coinsAmount || 0)
  const amountValue = moneyValue(amount)
  const valid = Boolean(
    networkAvailable && amountValue > 0 && concept.trim() &&
      Math.abs(billTotal - amountValue) < 0.005,
  )

  function selectType(nextType: 'inflow' | 'outflow') {
    setType(nextType)
    if (nextType !== 'outflow') return
    const limited = limitAdjustmentToAvailableStock(
      bills,
      moneyValue(coinsAmount),
      availableStock,
    )
    setBills(limited.bills)
    setCoinsAmount(limited.coinsAmount ? String(limited.coinsAmount) : '')
  }

  async function save() {
    if (!valid) return
    setSaving(true)
    setError('')
    try {
      const adjustment = await closingAdjustmentService.create({
        id: crypto.randomUUID(),
        cashClosingId: closingId,
        type,
        amount: amountValue,
        concept,
        notes,
        bills,
        coinsAmount: moneyValue(coinsAmount),
      })
      onCreated(adjustment)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'No fue posible crear el ajuste.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {(['inflow', 'outflow'] as const).map((movementType) => (
          <button
            className={type === movementType ? 'filter-chip-active' : 'filter-chip-item'}
            key={movementType}
            type="button"
            onClick={() => selectType(movementType)}
          >
            {movementType === 'inflow' ? 'Entrada' : 'Salida'}
          </button>
        ))}
      </div>
      <label className="field-label">Monto
        <input className="field" inputMode="decimal" min="0.01" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <fieldset>
        <legend className="field-label">Desglose de efectivo</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(['b1000', 'b500', 'b200', 'b100', 'b50', 'b20'] as const).map((key) => (
            <label className="field-label text-xs" key={key}>{key.replace('b', '$')}
              <input className="field" max={type === 'outflow' ? availableStock[key] : undefined} min="0" step="1" type="number" value={bills[key]} onChange={(event) => {
                const value = Math.max(0, Math.trunc(Number(event.target.value) || 0))
                setBills((current) => ({
                  ...current,
                  [key]: type === 'outflow'
                    ? Math.min(value, Math.max(0, availableStock[key]))
                    : value,
                }))
              }} />
            </label>
          ))}
          <label className="field-label text-xs">Monedas
            <input className="field" max={type === 'outflow' ? availableStock.monedas : undefined} min="0" step="0.01" type="number" value={coinsAmount} onChange={(event) => {
              const rawValue = event.target.value
              if (rawValue === '') {
                setCoinsAmount('')
                return
              }
              const value = Number(rawValue)
              setCoinsAmount(String(type === 'outflow'
                ? Math.min(Math.max(0, value || 0), Math.max(0, availableStock.monedas))
                : Math.max(0, value || 0)))
            }} />
          </label>
        </div>
        <p className={`mt-2 text-right text-sm font-black ${Math.abs(billTotal - amountValue) < 0.005 ? 'text-slate-900' : 'text-red-700'}`}>
          Desglose: {currencyFormatter.format(billTotal)}
        </p>
      </fieldset>
      <label className="field-label">Concepto
        <input className="field" maxLength={200} value={concept} onChange={(event) => setConcept(event.target.value)} />
      </label>
      <label className="field-label">Notas
        <textarea className="field min-h-20" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="rounded-xl bg-slate-50 p-4 text-sm">
        <p className="font-black">Confirmar ajuste</p>
        <p className="mt-1">{type === 'inflow' ? 'Entrada' : 'Salida'} {type === 'inflow' ? '+' : '-'}{currencyFormatter.format(amountValue)}</p>
        <p className="mt-1 text-slate-500">El Corte original permanecerá sin cambios.</p>
      </div>
      {error && <p className="alert-error">{error}</p>}
      {!networkAvailable && <p className="alert-error">Crear ajustes requiere conexión.</p>}
      <button className="button-primary w-full" disabled={!valid || saving} type="button" onClick={() => void save()}>
        {saving ? 'Confirmando…' : 'Confirmar ajuste'}
      </button>
      <button className="button-secondary w-full" disabled={saving} type="button" onClick={onClose}>Cancelar</button>
    </div>
  )
}

function ClosingDetailView({
  closingId,
  stores,
  user,
  networkAvailable,
  onBack,
}: {
  closingId: string
  stores: Store[]
  user: UserProfile
  networkAvailable: boolean
  onBack: () => void
}) {
  const [detail, setDetail] = useState<CashClosingDetail>()
  const [error, setError] = useState('')
  const [showExpenseDetails, setShowExpenseDetails] = useState(false)
  const [showTransferDetails, setShowTransferDetails] = useState(false)
  const [showPaymentDetails, setShowPaymentDetails] = useState(false)
  const [showPurchaseDetails, setShowPurchaseDetails] = useState(false)
  const [adjustmentOpen, setAdjustmentOpen] = useState(false)
  const [lockState, setLockState] = useState<ClosingAdjustmentLockState>()

  useEffect(() => {
    let active = true
    setDetail(undefined)
    setError('')
    setShowExpenseDetails(false)
    setShowTransferDetails(false)
    setShowPaymentDetails(false)
    setShowPurchaseDetails(false)
    setLockState(undefined)
    void closingService
      .getClosedDetail(closingId)
      .then((result) => {
        if (active) setDetail(result)
      })
    void closingAdjustmentService.lockState(closingId).then(setLockState).catch(() => setLockState(undefined))
      .catch((cause: unknown) => {
        console.error('No fue posible consultar el corte', cause)
        if (active) setError('No fue posible consultar el detalle del corte.')
      })
    return () => {
      active = false
    }
  }, [closingId])

  if (error) {
    return (
      <section className="mx-auto max-w-3xl">
        <button className="button-secondary" type="button" onClick={onBack}>Volver</button>
        <p className="alert-error mt-5">{error}</p>
      </section>
    )
  }
  if (!detail) return <p className="empty-state">Cargando corte…</p>

  const { closing, expenses, transfers, payments, purchases, adjustments } = detail
  const storeName = stores.find((store) => store.id === closing.store_id)?.name
  const effective = calculateEffectiveClosing(
    {
      countedCash: Number(closing.counted_cash),
      cashBalance: Number(closing.cash_balance),
      cashToWithdraw: Number(closing.cash_to_withdraw),
      countedBills: closing.bills,
      withdrawBills: closing.withdraw_bills,
    },
    adjustments,
  )
  const grossCash =
    effective.countedCash + Number(closing.cash_outflows_total_snapshot)
  const countedCashRows = BILL_DENOMINATIONS.map((denomination) => {
    const quantity = Number(effective.countedBills[denomination.key] ?? 0)
    const subtotal = denomination.key === 'monedas'
      ? quantity
      : quantity * denomination.value
    return { denomination, quantity, subtotal }
  })

  return (
    <section className="mx-auto max-w-3xl">
      <button className="button-secondary" type="button" onClick={onBack}>Volver al historial</button>
      <div className="mt-6">
        <p className="eyebrow">Corte #{closing.closing_number}</p>
        <h1 className="page-title mt-1">{storeName ?? 'Tienda'}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {formatLongDate(closing.business_date)} · Cerrado {formatClosingTime(closing.closed_at)}
        </p>
      </div>

      <div className="mt-7 space-y-5">
        <article className="panel">
          <p className="eyebrow">Ventas</p>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="summary-row"><dt>Ventas brutas</dt><dd>{currencyFormatter.format(Number(closing.gross_sales))}</dd></div>
          </dl>
        </article>

        <article className="panel">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Ajustes</p>
              <dl className="mt-5 space-y-3 text-sm">
                <div className="summary-row"><dt>Efectivo contado original</dt><dd>{currencyFormatter.format(Number(closing.counted_cash))}</dd></div>
                <div className="summary-row"><dt>Ajustes netos</dt><dd className={effective.adjustmentsNet >= 0 ? 'text-teal-800' : 'text-red-700'}>{effective.adjustmentsNet >= 0 ? '+' : ''}{currencyFormatter.format(effective.adjustmentsNet)}</dd></div>
                <div className="summary-row border-t border-slate-200 pt-3 font-extrabold"><dt>Efectivo corregido</dt><dd>{currencyFormatter.format(effective.countedCash)}</dd></div>
                <div className="summary-row"><dt>A retirar original</dt><dd>{currencyFormatter.format(Number(closing.cash_to_withdraw))}</dd></div>
                <div className="summary-row font-extrabold"><dt>A retirar corregido</dt><dd>{currencyFormatter.format(effective.cashToWithdraw)}</dd></div>
              </dl>
            </div>
            {user.role === 'admin' && lockState === 'adjustable' && networkAvailable && (
              <button className="button-primary" type="button" onClick={() => setAdjustmentOpen(true)}>+ Ajuste</button>
            )}
          </div>
          {lockState === 'prepared' && <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">Este Corte pertenece a una exportación preparada. Cancela ese lote antes de realizar un ajuste.</p>}
          {lockState === 'confirmed' && <p className="mt-5 rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-700">Este Corte ya fue exportado correctamente y no admite nuevos ajustes.</p>}
          {lockState === 'received' && <p className="mt-5 rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-700">Este Corte ya fue recibido en Caja Central y no admite nuevos ajustes.</p>}
          {adjustments.length > 0 && <div className="mt-6 space-y-2">{adjustments.map((adjustment) => <div className="summary-row rounded-xl border border-slate-100 px-3 py-3 text-sm" key={adjustment.id}><span><strong className={adjustment.type === 'inflow' ? 'text-teal-800' : 'text-red-700'}>{adjustment.type === 'inflow' ? '↑ +' : '↓ -'}{currencyFormatter.format(adjustment.amount)}</strong><span className="ml-3 font-semibold text-slate-700">{adjustment.concept}</span><span className="block text-xs text-slate-500">{formatLongDate(adjustment.createdAt.slice(0, 10))}</span></span></div>)}</div>}
        </article>

        <article className="panel">
          <p className="eyebrow">Salidas</p>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="summary-row"><dt>Gastos</dt><dd>{currencyFormatter.format(Number(closing.expenses_total_snapshot))}</dd></div>
            <div className="summary-row"><dt>Transferencias</dt><dd>{currencyFormatter.format(Number(closing.outgoing_transfers_total_snapshot))}</dd></div>
            <div className="summary-row"><dt>Pagos desde caja</dt><dd>{currencyFormatter.format(Number(closing.store_cash_payments_total_snapshot))}</dd></div>
            <div className="summary-row"><dt>Compras</dt><dd>{currencyFormatter.format(Number(closing.purchases_total_snapshot))}</dd></div>
            <div className="summary-row border-t border-slate-200 pt-4 font-extrabold"><dt>Total salidas</dt><dd>{currencyFormatter.format(Number(closing.operational_outflows_total_snapshot))}</dd></div>
          </dl>

          <div className="mt-6 space-y-4">
            <div>
              <button
                aria-expanded={showExpenseDetails}
                className="text-action"
                type="button"
                onClick={() => setShowExpenseDetails((visible) => !visible)}
              >
                <ReceiptIcon className="size-4" />
                {showExpenseDetails ? 'Ocultar gastos' : `Ver detalle de gastos · ${expenses.length}`}
              </button>
              {showExpenseDetails && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                  {expenses.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">Sin gastos incluidos.</p>
                  ) : expenses.map((expense) => (
                    <div className="summary-row border-b border-slate-100 px-4 py-3 text-sm last:border-b-0" key={expense.expense_id}>
                      <span className="min-w-0 truncate font-semibold text-slate-700">{expense.concept_snapshot}</span>
                      <strong>{currencyFormatter.format(Number(expense.amount_snapshot))}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <button
                aria-expanded={showPaymentDetails}
                className="text-action"
                type="button"
                onClick={() => setShowPaymentDetails((visible) => !visible)}
              >
                <WalletIcon className="size-4" />
                {showPaymentDetails ? 'Ocultar pagos' : `Ver detalle de pagos · ${payments.length}`}
              </button>
              {showPaymentDetails && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                  {payments.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">Sin pagos incluidos.</p>
                  ) : payments.map((payment) => (
                    <div className="summary-row border-b border-slate-100 px-4 py-3 text-sm last:border-b-0" key={payment.payment_id}>
                      <span className="min-w-0 truncate font-semibold text-slate-700">{payment.collaborator_name_snapshot}</span>
                      <strong>{currencyFormatter.format(Number(payment.amount_snapshot))}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <button
                aria-expanded={showPurchaseDetails}
                className="text-action"
                type="button"
                onClick={() => setShowPurchaseDetails((visible) => !visible)}
              >
                <ReceiptIcon className="size-4" />
                {showPurchaseDetails ? 'Ocultar Compras' : `Ver detalle de Compras · ${purchases.length}`}
              </button>
              {showPurchaseDetails && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                  {purchases.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">Sin Compras incluidas.</p>
                  ) : purchases.map((purchase) => (
                    <div className="summary-row border-b border-slate-100 px-4 py-3 text-sm last:border-b-0" key={purchase.purchase_payment_id}>
                      <span className="min-w-0 truncate font-semibold text-slate-700">{purchase.supplier_name_snapshot}</span>
                      <strong>{currencyFormatter.format(Number(purchase.amount_snapshot))}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <button
                aria-expanded={showTransferDetails}
                className="text-action"
                type="button"
                onClick={() => setShowTransferDetails((visible) => !visible)}
              >
                <TransferIcon className="size-4" />
                {showTransferDetails ? 'Ocultar transferencias' : `Ver detalle de transferencias · ${transfers.length}`}
              </button>
              {showTransferDetails && (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                  {transfers.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">Sin transferencias incluidas.</p>
                  ) : transfers.map((transfer) => (
                    <div className="summary-row border-b border-slate-100 px-4 py-3 text-sm last:border-b-0" key={transfer.transfer_id}>
                      <span className="min-w-0 truncate font-semibold text-slate-700">Ticket #{transfer.ticket_number_snapshot}</span>
                      <strong>{currencyFormatter.format(Number(transfer.amount_snapshot))}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Efectivo</p>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="summary-row"><dt>Efectivo contado</dt><dd>{currencyFormatter.format(effective.countedCash)}</dd></div>
            <div className="summary-row"><dt>Salidas desde caja</dt><dd>{currencyFormatter.format(Number(closing.cash_outflows_total_snapshot))}</dd></div>
            <div className="summary-row border-t border-slate-200 pt-4 font-extrabold"><dt>Efectivo bruto</dt><dd>{currencyFormatter.format(grossCash)}</dd></div>
          </dl>
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-[0.08em] text-slate-500">
              <span>Denominación</span>
              <span className="text-right">Cantidad</span>
              <span className="text-right">Subtotal</span>
            </div>
            <div className="divide-y divide-slate-100">
              {countedCashRows.map(({ denomination, quantity, subtotal }) => (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 px-4 py-3 text-sm" key={denomination.key}>
                  <span className="font-semibold text-slate-700">{denomination.label}</span>
                  <span className="text-right tabular-nums">
                    {denomination.key === 'monedas'
                      ? currencyFormatter.format(quantity)
                      : quantity.toLocaleString('es-MX')}
                  </span>
                  <strong className="text-right tabular-nums">{currencyFormatter.format(subtotal)}</strong>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Saldo</p>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="summary-row"><dt>Saldo de caja</dt><dd>{currencyFormatter.format(Number(closing.cash_balance))}</dd></div>
            <div className="summary-row"><dt>Efectivo retirado</dt><dd>{currencyFormatter.format(effective.cashToWithdraw)}</dd></div>
          </dl>
        </article>
      </div>
      <AppModal closeLabel="Cerrar ajuste" open={adjustmentOpen} title="Nuevo ajuste" onClose={() => setAdjustmentOpen(false)}>
        <ClosingAdjustmentForm
          availableStock={effective.withdrawBills}
          closingId={closingId}
          networkAvailable={networkAvailable}
          onClose={() => setAdjustmentOpen(false)}
          onCreated={(adjustment) => {
            setDetail((current) => {
              if (!current) return current
              const nextAdjustments = [
                ...current.adjustments.filter(({ id }) => id !== adjustment.id),
                adjustment,
              ]
              return { ...current, adjustments: nextAdjustments }
            })
            setAdjustmentOpen(false)
          }}
        />
      </AppModal>
    </section>
  )
}

export function ClosingsPage({ stores, user }: ClosingsPageProps) {
  const today = getLocalDate()
  const activeStores = stores.filter((store) => store.status === 'active')
  const [view, setView] = useState<ClosingView>({ kind: 'history' })
  const [storeFilter, setStoreFilter] = useState<StoreScopeValue>(ALL_STORES)
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 8)}01`)
  const [dateTo, setDateTo] = useState(today)
  const [statusFilter, setStatusFilter] =
    useState<ClosingStatusFilter>('all')
  const [drafts, setDrafts] = useState<CashClosingDraft[]>([])
  const [closedClosings, setClosedClosings] = useState<CashClosingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createStoreId, setCreateStoreId] = useState(activeStores[0]?.id ?? '')
  const [createDate, setCreateDate] = useState(today)
  const [checkingDraft, setCheckingDraft] = useState(false)
  const [existingDraft, setExistingDraft] = useState<CashClosingDraft>()
  const addButtonRef = useRef<HTMLButtonElement>(null)

  const queryStoreId = storeFilter === ALL_STORES ? undefined : storeFilter

  function changeDateFrom(value: string) {
    setDateFrom(value)
    if (value > dateTo) setDateTo(value)
  }

  function changeDateTo(value: string) {
    setDateTo(value)
    if (value < dateFrom) setDateFrom(value)
  }

  async function loadHistory() {
    setLoading(true)
    setLoadError('')
    try {
      const [localDrafts, remoteClosings] = await Promise.all([
        statusFilter === 'closed'
          ? Promise.resolve([])
          : closingService.listDrafts(queryStoreId, dateFrom, dateTo),
        statusFilter === 'draft'
          ? Promise.resolve([])
          : closingService.listClosed(queryStoreId, dateFrom, dateTo),
      ])
      setDrafts(localDrafts)
      setClosedClosings(remoteClosings)
    } catch (cause: unknown) {
      console.error('No fue posible consultar el historial de cortes', cause)
      setLoadError('No fue posible consultar el historial de cortes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (view.kind === 'history') void loadHistory()
    // loadHistory depends only on the filter snapshot used by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, statusFilter, storeFilter, view.kind])

  const historyEntries = useMemo<ClosingHistoryEntry[]>(() => {
    const entries: ClosingHistoryEntry[] = [
      ...drafts.map((draft): ClosingHistoryEntry => ({ kind: 'draft', draft })),
      ...closedClosings.map(
        (closing): ClosingHistoryEntry => ({ kind: 'closed', closing }),
      ),
    ]
    // oxlint-disable-next-line unicorn/no-array-sort
    return entries.sort((left, right) => {
      const leftDate = left.kind === 'draft' ? left.draft.businessDate : left.closing.business_date
      const rightDate = right.kind === 'draft' ? right.draft.businessDate : right.closing.business_date
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
      const leftTime = left.kind === 'draft' ? left.draft.updatedAt : left.closing.closed_at
      const rightTime = right.kind === 'draft' ? right.draft.updatedAt : right.closing.closed_at
      return rightTime.localeCompare(leftTime)
    })
  }, [closedClosings, drafts])

  function openCreate() {
    const preferredStore =
      storeFilter !== ALL_STORES && activeStores.some((store) => store.id === storeFilter)
        ? storeFilter
        : activeStores[0]?.id ?? ''
    setCreateStoreId(preferredStore)
    setCreateDate(today)
    setExistingDraft(undefined)
    setCreateOpen(true)
  }

  async function requestNewClosing() {
    if (!createStoreId || !createDate) return
    setCheckingDraft(true)
    try {
      const saved = await closingService.load(createStoreId, createDate, user.id)
      if (saved) {
        setExistingDraft(saved)
        return
      }
      setCreateOpen(false)
      setView({ kind: 'flow', storeId: createStoreId, businessDate: createDate })
    } finally {
      setCheckingDraft(false)
    }
  }

  if (view.kind === 'flow') {
    return (
      <ClosingFlow
        businessDate={view.businessDate}
        storeId={view.storeId}
        stores={stores}
        user={user}
        onBack={() => setView({ kind: 'history' })}
        onClosed={(closing) => setView({ kind: 'detail', closingId: closing.id })}
      />
    )
  }

  if (view.kind === 'detail') {
    return (
      <ClosingDetailView
        closingId={view.closingId}
        stores={stores}
        user={user}
        networkAvailable={connectivityService.isNetworkAvailable()}
        onBack={() => setView({ kind: 'history' })}
      />
    )
  }

  return (
    <section>
      <h1 className="page-title">Cortes</h1>

      <div className="mt-4 space-y-4 sm:mt-7">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">Tienda</p>
          <StoreScopeSelector
            ariaLabel="Filtrar cortes por tienda"
            includeInactive
            role={user.role}
            stores={stores}
            value={storeFilter}
            onChange={setStoreFilter}
          />
        </div>

        <div className="panel grid grid-cols-2 gap-x-2 gap-y-3 p-3 sm:gap-4 sm:p-5">
          <label className="field-label min-w-0">
            Desde
            <span className="expense-date-control">
              <span aria-hidden="true">{compactDate(dateFrom)}</span>
              <input
                aria-label="Fecha inicial"
                max={dateTo}
                type="date"
                value={dateFrom}
                onChange={(event) => changeDateFrom(event.target.value)}
              />
            </span>
          </label>
          <label className="field-label min-w-0">
            Hasta
            <span className="expense-date-control">
              <span aria-hidden="true">{compactDate(dateTo)}</span>
              <input
                aria-label="Fecha final"
                min={dateFrom}
                type="date"
                value={dateTo}
                onChange={(event) => changeDateTo(event.target.value)}
              />
            </span>
          </label>
        </div>

        <FilterChipGroup
          ariaLabel="Filtrar cortes por estado"
          options={CLOSING_STATUS_OPTIONS}
          value={statusFilter}
          onChange={setStatusFilter}
        />

        {loadError && <p className="alert-error">{loadError}</p>}
        {loading && <p className="empty-state">Consultando cortes…</p>}
        {!loading && !loadError && historyEntries.length === 0 && (
          <div className="panel empty-state">
            <CashIcon className="mx-auto mb-3 size-8" />
            <p>No hay cortes en este periodo.</p>
          </div>
        )}
        {!loading && !loadError && historyEntries.length > 0 && (
          <div className="space-y-3">
            {historyEntries.map((entry) => {
              if (entry.kind === 'draft') {
                const storeName = stores.find((store) => store.id === entry.draft.storeId)?.name
                return (
                  <article className="panel border-amber-200 bg-amber-50/35" key={`draft:${entry.draft.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="eyebrow text-amber-700">Corte pendiente</p>
                        <h2 className="mt-1 text-lg font-black text-slate-950">{storeName ?? 'Tienda'}</h2>
                        <p className="mt-1 text-sm text-slate-500">{formatLongDate(entry.draft.businessDate)} · Paso {entry.draft.currentStep} de 4</p>
                      </div>
                      <button className="button-primary" type="button" onClick={() => setView({ kind: 'flow', storeId: entry.draft.storeId, businessDate: entry.draft.businessDate })}>Continuar corte</button>
                    </div>
                  </article>
                )
              }

              const closing = entry.closing
              const storeName = stores.find((store) => store.id === closing.store_id)?.name
              return (
                <button
                  className="panel flex w-full items-center gap-4 text-left transition hover:border-teal-200 hover:bg-teal-50/30"
                  key={closing.id}
                  type="button"
                  onClick={() => setView({ kind: 'detail', closingId: closing.id })}
                >
                  <span className="min-w-0 flex-1">
                    <span className="eyebrow block">{formatLongDate(closing.business_date)} · Corte #{closing.closing_number}</span>
                    <span className="mt-1 block text-lg font-black text-slate-950">{storeName ?? 'Tienda'}</span>
                    <span className="mt-1 block text-xs font-semibold text-slate-500">Cerrado · {formatClosingTime(closing.closed_at)}</span>
                    <span className="mt-4 grid grid-cols-3 gap-3 text-xs text-slate-500">
                      <span><strong className="block text-sm text-slate-900">{currencyFormatter.format(Number(closing.gross_sales))}</strong>Ventas</span>
                      <span><strong className="block text-sm text-slate-900">{currencyFormatter.format(Number(closing.operational_outflows_total_snapshot))}</strong>Salidas</span>
                      <span><strong className="block text-sm text-slate-900">{currencyFormatter.format(Number(closing.counted_cash))}</strong>Efectivo</span>
                    </span>
                  </span>
                  <ArrowIcon className="size-5 shrink-0 text-slate-400" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      <button aria-label="Crear nuevo corte" className="app-fab" disabled={activeStores.length === 0} ref={addButtonRef} title="Nuevo corte" type="button" onClick={openCreate}>
        <PlusIcon className="size-7" />
      </button>

      <AppModal closeDisabled={checkingDraft} closeLabel="Cerrar nuevo corte" open={createOpen} returnFocusRef={addButtonRef} title="Nuevo corte" onClose={() => setCreateOpen(false)}>
        <div className="mt-6 space-y-5">
          <label className="field-label">Tienda
            <select className="field" value={createStoreId} onChange={(event) => { setCreateStoreId(event.target.value); setExistingDraft(undefined) }}>
              {activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <label className="field-label">Fecha operativa
            <input className="field" max={today} type="date" value={createDate} onChange={(event) => { setCreateDate(event.target.value); setExistingDraft(undefined) }} />
          </label>
          {existingDraft && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-extrabold">Ya existe un corte en proceso.</p>
              <p className="mt-1">Está guardado en el paso {existingDraft.currentStep} de 4.</p>
              <button className="button-primary mt-4 w-full" type="button" onClick={() => { setCreateOpen(false); setView({ kind: 'flow', storeId: existingDraft.storeId, businessDate: existingDraft.businessDate }) }}>Continuar corte</button>
            </div>
          )}
          {!existingDraft && (
            <button className="button-primary w-full" disabled={checkingDraft || !createStoreId || !createDate} type="button" onClick={() => void requestNewClosing()}>
              {checkingDraft ? 'Comprobando…' : 'Iniciar corte'}
            </button>
          )}
        </div>
      </AppModal>
    </section>
  )
}

type ClosingFlowProps = ClosingsPageProps & {
  storeId: string
  businessDate: string
  onBack: () => void
  onClosed: (closing: CashClosingRow) => void
}

function ClosingFlow({
  stores,
  user,
  storeId: initialStoreId,
  businessDate: initialBusinessDate,
  onBack,
  onClosed,
}: ClosingFlowProps) {
  const [storeId] = useState(initialStoreId)
  const [date] = useState(initialBusinessDate)
  const [draft, setDraft] = useState<CashClosingDraft>()
  const draftRef = useRef<CashClosingDraft | undefined>(undefined)
  const [candidates, setCandidates] = useState<ClosingOperationalSummary>({
    expenses: [],
    outgoingTransfers: [],
    storeCashPayments: [],
    storeCashPurchases: [],
    expensesTotal: 0,
    cashExpensesTotal: 0,
    outgoingTransfersTotal: 0,
    storeCashPaymentsTotal: 0,
    purchasesTotal: 0,
    cashPurchasesTotal: 0,
    operationalOutflowsTotal: 0,
    cashOutflowsTotal: 0,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<DraftSaveState>('idle')
  const saveSequence = useRef(0)
  const [showCashDetails, setShowCashDetails] = useState(false)
  const [showExpenseDetails, setShowExpenseDetails] = useState(false)
  const [showTransferDetails, setShowTransferDetails] = useState(false)
  const [showPaymentDetails, setShowPaymentDetails] = useState(false)
  const [showPurchaseDetails, setShowPurchaseDetails] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const [selectionConflict, setSelectionConflict] = useState(false)

  const operational = useMemo(
    () =>
      closingService.getOperationalSummary(
        candidates,
        draft?.selectedExpenseIds ?? [],
        draft?.selectedTransferIds ?? [],
        draft?.selectedPaymentIds ?? [],
        draft?.selectedPurchasePaymentIds ?? [],
      ),
    [
      candidates,
      draft?.selectedExpenseIds,
      draft?.selectedPaymentIds,
      draft?.selectedPurchasePaymentIds,
      draft?.selectedTransferIds,
    ],
  )

  const summary = useMemo(
    () => (draft ? calculateClosingSummary(draft, operational) : undefined),
    [draft, operational],
  )
  const selectedStore = stores.find((store) => store.id === storeId)

  function setCurrentDraft(nextDraft: CashClosingDraft | undefined) {
    draftRef.current = nextDraft
    setDraft(nextDraft)
  }

  useEffect(() => {
    if (!storeId) {
      setLoading(false)
      setCurrentDraft(undefined)
      return
    }

    let active = true
    setLoading(true)
    setError(undefined)
    setMessage(undefined)
    setCurrentDraft(undefined)

    void Promise.all([
      closingService.load(storeId, date, user.id),
      closingService.getEligibleMovements(storeId, date),
    ])
      .then(([savedDraft, eligibleMovements]) => {
        if (!active) return
        setCandidates(eligibleMovements)
        const baseDraft =
          savedDraft ?? closingService.create(storeId, date, user.id)
        const reconciled = reconcileDraftSelection(
          baseDraft,
          eligibleMovements,
        )
        const selected = closingService.getOperationalSummary(
          eligibleMovements,
          reconciled.selectedExpenseIds,
          reconciled.selectedTransferIds,
          reconciled.selectedPaymentIds,
          reconciled.selectedPurchasePaymentIds,
        )
        const prepared = applyClosingSummary(reconciled, selected)
        setCurrentDraft(prepared)
        setSaveState(savedDraft ? 'saved' : 'idle')
        if (savedDraft) {
          void closingService.save(prepared, selected)
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
    totals: ClosingOperationalTotals = operational,
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
    const nextDraft = { ...current, ...changes }
    const nextOperational = closingService.getOperationalSummary(
      candidates,
      nextDraft.selectedExpenseIds,
      nextDraft.selectedTransferIds,
      nextDraft.selectedPaymentIds,
      nextDraft.selectedPurchasePaymentIds,
    )
    persistDraft(nextDraft, nextOperational)
  }

  async function goToStep(step: CashClosingStep) {
    const current = draftRef.current
    if (!current) return

    if (step === 4) {
      try {
        if (
          isSupabaseConfigured &&
          connectivityService.isNetworkAvailable()
        ) {
          await syncService.process()
        }
        const latestCandidates =
          await closingService.getEligibleMovements(storeId, date)
        const reconciled = reconcileDraftSelection(current, latestCandidates)
        const latestOperational = closingService.getOperationalSummary(
          latestCandidates,
          reconciled.selectedExpenseIds,
          reconciled.selectedTransferIds,
          reconciled.selectedPaymentIds,
          reconciled.selectedPurchasePaymentIds,
        )
        setCandidates(latestCandidates)
        setSelectionConflict(false)
        persistDraft(
          { ...reconciled, currentStep: step },
          latestOperational,
        )
        return
      } catch (cause: unknown) {
        console.error('No fue posible actualizar las salidas del corte', cause)
        setError('No fue posible actualizar las salidas del día.')
        return
      }
    }

    persistDraft({ ...current, currentStep: step })
  }

  async function refreshCandidates() {
    const current = draftRef.current
    if (!current) return
    setSaving(true)
    setError(undefined)
    try {
      const latestCandidates = await closingService.getEligibleMovements(
        storeId,
        date,
      )
      const reconciled = reconcileDraftSelection(current, latestCandidates)
      const latestOperational = closingService.getOperationalSummary(
        latestCandidates,
        reconciled.selectedExpenseIds,
        reconciled.selectedTransferIds,
        reconciled.selectedPaymentIds,
        reconciled.selectedPurchasePaymentIds,
      )
      setCandidates(latestCandidates)
      setSelectionConflict(false)
      persistDraft(reconciled, latestOperational)
    } catch (cause: unknown) {
      console.error('No fue posible actualizar los movimientos', cause)
      setError('No fue posible actualizar los movimientos elegibles.')
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
      const latestDraft = await closingService.save(
        current,
        operational,
      )
      const confirmedClosing = await closingService.close(latestDraft)
      saveSequence.current += 1
      setCurrentDraft(undefined)
      onClosed(confirmedClosing)
    } catch (cause: unknown) {
      console.error('No fue posible cerrar el corte', cause)
      if (
        cause instanceof ClosingDomainError &&
        (cause.code === 'MOVEMENT_ALREADY_ASSIGNED' ||
          cause.code === 'SELECTED_MOVEMENT_NOT_FOUND' ||
          cause.code === 'PURCHASE_ALREADY_IN_CLOSING')
      ) {
        setSelectionConflict(true)
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible confirmar el cierre. El borrador sigue guardado.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function discardDraft() {
    const current = draftRef.current
    if (!current) return
    if (!window.confirm('¿Descartar este borrador de corte?')) return
    setSaving(true)
    setError(undefined)
    try {
      await closingService.discard(current.id)
      saveSequence.current += 1
      setCurrentDraft(undefined)
      onBack()
    } catch (cause: unknown) {
      console.error('No fue posible descartar el borrador', cause)
      setError('No fue posible descartar el borrador.')
    } finally {
      setSaving(false)
    }
  }

  const canClose =
    isSupabaseConfigured && connectivityService.isNetworkAvailable()
  const balanceErrors = draft ? validateClosingBillCounts(draft) : []
  const invalidCashBalance = balanceErrors.length > 0

  function toggleExpense(id: string) {
    if (!draft) return
    updateDraft({
      selectedExpenseIds: draft.selectedExpenseIds.includes(id)
        ? draft.selectedExpenseIds.filter((selectedId) => selectedId !== id)
        : [...draft.selectedExpenseIds, id],
    })
  }

  function toggleTransfer(id: string) {
    if (!draft) return
    updateDraft({
      selectedTransferIds: draft.selectedTransferIds.includes(id)
        ? draft.selectedTransferIds.filter((selectedId) => selectedId !== id)
        : [...draft.selectedTransferIds, id],
    })
  }

  function togglePayment(id: string) {
    if (!draft) return
    updateDraft({
      selectedPaymentIds: draft.selectedPaymentIds.includes(id)
        ? draft.selectedPaymentIds.filter((selectedId) => selectedId !== id)
        : [...draft.selectedPaymentIds, id],
    })
  }

  function togglePurchasePayment(id: string) {
    if (!draft) return
    updateDraft({
      selectedPurchasePaymentIds: draft.selectedPurchasePaymentIds.includes(id)
        ? draft.selectedPurchasePaymentIds.filter(
            (selectedId) => selectedId !== id,
          )
        : [...draft.selectedPurchasePaymentIds, id],
    })
  }

  return (
    <section className="mx-auto max-w-5xl">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-4 flex flex-wrap gap-3">
            <button className="button-secondary" disabled={saving} type="button" onClick={onBack}>Volver al historial</button>
            {saveState === 'saved' && (
              <button className="button-secondary text-red-700" disabled={saving} type="button" onClick={() => void discardDraft()}>Descartar borrador</button>
            )}
          </div>
          <p className="eyebrow">Nuevo corte</p>
          <h1 className="page-title mt-1">{selectedStore?.name ?? 'Corte'}</h1>
          <p className="mt-2 text-sm text-slate-500">{formatLongDate(date)}</p>
        </div>
        {!loading && draft && (
          <div className="panel w-full py-4 lg:max-w-2xl lg:flex-1">
            <StepProgress currentStep={draft.currentStep} />
          </div>
        )}
      </div>

      {error && (
        <div className="alert-error mt-6">
          <p>{error}</p>
          {selectionConflict && (
            <button className="button-secondary mt-3" disabled={saving} type="button" onClick={() => void refreshCandidates()}>
              <SyncIcon className="size-4" /> Actualizar resumen
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="alert-success mt-6"><CheckIcon className="size-5" />{message}</p>
      )}

      {loading && <p className="empty-state">Preparando corte…</p>}

      {!loading && draft && summary && (
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
                  </dl>

                  {candidates.expenses.length > 0 && (
                    <div className="mt-7 border-t border-slate-200 pt-6">
                      <div>
                        <p className="eyebrow">Gastos</p>
                        <p className="mt-1 text-sm font-bold text-slate-700">
                          {draft.selectedExpenseIds.length} de {candidates.expenses.length} seleccionados · {currencyFormatter.format(summary.expensesTotal)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">Disponible: {currencyFormatter.format(candidates.expensesTotal)}</p>
                      </div>

                      <button
                        aria-expanded={showExpenseDetails}
                        className="text-action mt-4"
                        type="button"
                        onClick={() => setShowExpenseDetails((visible) => !visible)}
                      >
                        <ReceiptIcon className="size-4" />
                        {showExpenseDetails ? 'Ocultar gastos' : 'Ver detalle de gastos'}
                      </button>

                      {showExpenseDetails && (
                        <div className="mt-3">
                          <div className="mb-3 flex justify-end">
                            <button className="small-button" type="button" onClick={() => updateDraft({ selectedExpenseIds: draft.selectedExpenseIds.length === candidates.expenses.length ? [] : candidates.expenses.map((expense) => expense.id) })}>
                              {draft.selectedExpenseIds.length === candidates.expenses.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                            </button>
                          </div>
                          <div className="overflow-hidden rounded-xl border border-slate-200">
                            {candidates.expenses.map((expense) => (
                              <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0" key={expense.id}>
                                <input checked={draft.selectedExpenseIds.includes(expense.id)} className="size-5 accent-teal-700" type="checkbox" onChange={() => toggleExpense(expense.id)} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-slate-700">{expense.concept}</span>
                                  <span className="mt-0.5 block text-xs capitalize text-slate-400">{expense.paymentMethod}</span>
                                </span>
                                <strong className="text-sm">{currencyFormatter.format(expense.amount)}</strong>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {candidates.outgoingTransfers.length > 0 && (
                    <div className="mt-7 border-t border-slate-200 pt-6">
                      <div>
                        <p className="eyebrow">Transferencias</p>
                        <p className="mt-1 text-sm font-bold text-slate-700">
                          {draft.selectedTransferIds.length} de {candidates.outgoingTransfers.length} seleccionadas · {currencyFormatter.format(summary.outgoingTransfersTotal)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">Disponible: {currencyFormatter.format(candidates.outgoingTransfersTotal)}</p>
                      </div>

                      <button
                        aria-expanded={showTransferDetails}
                        className="text-action mt-4"
                        type="button"
                        onClick={() => setShowTransferDetails((visible) => !visible)}
                      >
                        <TransferIcon className="size-4" />
                        {showTransferDetails ? 'Ocultar transferencias' : 'Ver detalle de transferencias'}
                      </button>

                      {showTransferDetails && (
                        <div className="mt-3">
                          <div className="mb-3 flex justify-end">
                            <button className="small-button" type="button" onClick={() => updateDraft({ selectedTransferIds: draft.selectedTransferIds.length === candidates.outgoingTransfers.length ? [] : candidates.outgoingTransfers.map((transfer) => transfer.id) })}>
                              {draft.selectedTransferIds.length === candidates.outgoingTransfers.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                            </button>
                          </div>
                          <div className="overflow-hidden rounded-xl border border-slate-200">
                            {candidates.outgoingTransfers.map((transfer) => {
                              const destination = stores.find((store) => store.id === transfer.destinationStoreId)?.name ?? 'Tienda destino'
                              return (
                                <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0" key={transfer.id}>
                                  <input checked={draft.selectedTransferIds.includes(transfer.id)} className="size-5 accent-teal-700" type="checkbox" onChange={() => toggleTransfer(transfer.id)} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold text-slate-700">Ticket #{transfer.ticketNumber}</span>
                                    <span className="mt-0.5 block truncate text-xs text-slate-400">Destino: {destination}</span>
                                  </span>
                                  <strong className="text-sm">{currencyFormatter.format(transfer.amount)}</strong>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {candidates.storeCashPayments.length > 0 && (
                    <div className="mt-7 border-t border-slate-200 pt-6">
                      <div>
                        <p className="eyebrow">Pagos desde caja</p>
                        <p className="mt-1 text-sm font-bold text-slate-700">
                          {draft.selectedPaymentIds.length} de {candidates.storeCashPayments.length} seleccionados · {currencyFormatter.format(summary.storeCashPaymentsTotal)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Disponible: {currencyFormatter.format(candidates.storeCashPaymentsTotal)}
                        </p>
                      </div>

                      <button
                        aria-expanded={showPaymentDetails}
                        className="text-action mt-4"
                        type="button"
                        onClick={() => setShowPaymentDetails((visible) => !visible)}
                      >
                        <WalletIcon className="size-4" />
                        {showPaymentDetails ? 'Ocultar pagos' : 'Ver detalle de pagos'}
                      </button>

                      {showPaymentDetails && (
                        <div className="mt-3">
                          <div className="mb-3 flex justify-end">
                            <button
                              className="small-button"
                              type="button"
                              onClick={() => updateDraft({
                                selectedPaymentIds:
                                  draft.selectedPaymentIds.length === candidates.storeCashPayments.length
                                    ? []
                                    : candidates.storeCashPayments.map((payment) => payment.id),
                              })}
                            >
                              {draft.selectedPaymentIds.length === candidates.storeCashPayments.length
                                ? 'Deseleccionar todos'
                                : 'Seleccionar todos'}
                            </button>
                          </div>
                          <div className="overflow-hidden rounded-xl border border-slate-200">
                            {candidates.storeCashPayments.map((payment) => (
                              <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0" key={payment.id}>
                                <input
                                  checked={draft.selectedPaymentIds.includes(payment.id)}
                                  className="size-5 accent-teal-700"
                                  type="checkbox"
                                  onChange={() => togglePayment(payment.id)}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-slate-700">
                                    {payment.collaboratorNameSnapshot}
                                  </span>
                                  <span className="mt-0.5 block text-xs text-slate-400">
                                    Pago confirmado desde esta caja
                                  </span>
                                </span>
                                <strong className="text-sm">
                                  {currencyFormatter.format(payment.paidAmount)}
                                </strong>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {candidates.storeCashPurchases.length > 0 && (
                    <div className="mt-7 border-t border-slate-200 pt-6">
                      <div>
                        <p className="eyebrow">Compras</p>
                        <p className="mt-1 text-sm font-bold text-slate-700">
                          {draft.selectedPurchasePaymentIds.length} de {candidates.storeCashPurchases.length} seleccionadas · {currencyFormatter.format(summary.purchasesTotal)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Disponible: {currencyFormatter.format(candidates.purchasesTotal)}
                        </p>
                      </div>
                      <button
                        aria-expanded={showPurchaseDetails}
                        className="text-action mt-4"
                        type="button"
                        onClick={() => setShowPurchaseDetails((visible) => !visible)}
                      >
                        <ReceiptIcon className="size-4" />
                        {showPurchaseDetails ? 'Ocultar Compras' : 'Ver detalle de Compras'}
                      </button>
                      {showPurchaseDetails && (
                        <div className="mt-3">
                          <div className="mb-3 flex justify-end">
                            <button
                              className="small-button"
                              type="button"
                              onClick={() => updateDraft({
                                selectedPurchasePaymentIds:
                                  draft.selectedPurchasePaymentIds.length === candidates.storeCashPurchases.length
                                    ? []
                                    : candidates.storeCashPurchases.map(({ payment }) => payment.id),
                              })}
                            >
                              {draft.selectedPurchasePaymentIds.length === candidates.storeCashPurchases.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                            </button>
                          </div>
                          <div className="overflow-hidden rounded-xl border border-slate-200">
                            {candidates.storeCashPurchases.map(({ purchase, payment }) => (
                              <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0" key={payment.id}>
                                <input checked={draft.selectedPurchasePaymentIds.includes(payment.id)} className="size-5 accent-teal-700" type="checkbox" onChange={() => togglePurchasePayment(payment.id)} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-slate-700">{purchase.supplierNameSnapshot}</span>
                                  <span className="mt-0.5 block text-xs capitalize text-slate-400">{payment.paymentMethod}</span>
                                </span>
                                <strong className="text-sm">{currencyFormatter.format(payment.amount)}</strong>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(candidates.expenses.length > 0 ||
                    candidates.outgoingTransfers.length > 0 ||
                    candidates.storeCashPayments.length > 0 ||
                    candidates.storeCashPurchases.length > 0) && (
                    <dl className="mt-7 space-y-4 border-t border-slate-200 pt-5 text-sm">
                      {candidates.expenses.length > 0 && (
                        <div className="summary-row"><dt>Gastos seleccionados</dt><dd>{currencyFormatter.format(summary.expensesTotal)}</dd></div>
                      )}
                      {candidates.outgoingTransfers.length > 0 && (
                        <div className="summary-row"><dt>Transferencias seleccionadas</dt><dd>{currencyFormatter.format(summary.outgoingTransfersTotal)}</dd></div>
                      )}
                      {candidates.storeCashPayments.length > 0 && (
                        <div className="summary-row"><dt>Pagos desde caja seleccionados</dt><dd>{currencyFormatter.format(summary.storeCashPaymentsTotal)}</dd></div>
                      )}
                      {candidates.storeCashPurchases.length > 0 && (
                        <div className="summary-row"><dt>Compras seleccionadas</dt><dd>{currencyFormatter.format(summary.purchasesTotal)}</dd></div>
                      )}
                      <div className="summary-row border-t border-slate-200 pt-4 font-extrabold text-slate-950"><dt>Total salidas del corte</dt><dd>{currencyFormatter.format(summary.operationalOutflowsTotal)}</dd></div>
                    </dl>
                  )}
                </article>

                <article className="panel">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="eyebrow">Conciliación de efectivo</p>
                      <h3 className="mt-2 text-xl font-black text-slate-950">Caja física</h3>
                      <p className="mt-1 text-xs text-slate-500">Las transferencias de mercancía no modifican este cálculo; los pagos y Compras en efectivo sí.</p>
                    </div>
                    <button className="text-action text-xs" type="button" onClick={() => void goToStep(2)}>Editar</button>
                  </div>
                  <dl className="mt-6 space-y-4 text-sm">
                    <div className="summary-row"><dt>Efectivo contado</dt><dd>{currencyFormatter.format(summary.countedCash)}</dd></div>
                    <div className="summary-row text-slate-700">
                      <dt>
                        <span className="block">Salidas de efectivo</span>
                        <span className="mt-0.5 block text-xs text-slate-400">Gastos, pagos y Compras en efectivo</span>
                      </dt>
                      <dd>+ {currencyFormatter.format(summary.cashOutflowsTotal)}</dd>
                    </div>
                    <div className="summary-row border-t border-slate-200 pt-4 font-extrabold"><dt>Efectivo bruto reconstruido</dt><dd>{currencyFormatter.format(summary.grossCashReconstructed)}</dd></div>
                    <div className="summary-row border-t border-slate-200 pt-4"><dt>Ventas brutas</dt><dd>{currencyFormatter.format(draft.grossSales)}</dd></div>
                    <div className="summary-row"><dt>Efectivo esperado después de gastos de caja</dt><dd>{currencyFormatter.format(summary.expectedCash)}</dd></div>
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
                      disabled={
                        saving ||
                        !canClose ||
                        invalidCashBalance ||
                        selectionConflict
                      }
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
      )}
    </section>
  )
}
