import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { AppModal } from '../components/AppModal'
import { BillCounter } from '../components/BillCounter'
import { DatePickerButton } from '../components/DatePickerButton'
import { FilterChipGroup } from '../components/filters/FilterChipGroup'
import {
  ALL_STORES,
  StoreScopeSelector,
  type StoreScopeValue,
} from '../components/filters/StoreScopeSelector'
import { CheckIcon, PlusIcon, ReceiptIcon, SyncIcon } from '../components/icons'
import { EMPTY_CENTRAL_CASH_BILLS } from '../domain/constants'
import {
  PAYMENT_METHODS,
  type CentralCashBills,
  type PaidPurchase,
  type PaymentFundingSource,
  type PaymentMethod,
  type Store,
  type Supplier,
  type UserProfile,
} from '../domain/models'
import { isSupabaseConfigured } from '../lib/supabase'
import { purchaseService } from '../services/purchaseService'
import { referenceDataService } from '../services/referenceDataService'
import { syncService } from '../services/syncService'
import { formatLongDate, getLocalDate } from '../utils/date'
import {
  calculateCentralCashBillsTotal,
  currencyFormatter,
} from '../utils/money'

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
}

const FILTER_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

type OriginFilter = PaymentFundingSource | 'all'

type PurchasesPageProps = {
  stores: Store[]
  user: UserProfile
  networkAvailable: boolean
  onDataChanged: () => void
}

function groupLabel(value: string): string {
  return formatLongDate(value).toLocaleUpperCase('es-MX')
}

function formatFilterDate(value: string): string {
  return FILTER_DATE_FORMATTER.format(new Date(`${value}T12:00:00`))
}

export function PurchasesPage({
  stores,
  user,
  networkAvailable,
  onDataChanged,
}: PurchasesPageProps) {
  const today = getLocalDate()
  const monthStart = `${today.slice(0, 8)}01`
  const activeStores = useMemo(
    () => stores.filter((store) => store.status === 'active'),
    [stores],
  )
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [purchases, setPurchases] = useState<PaidPurchase[]>([])
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all')
  const [storeFilter, setStoreFilter] = useState<StoreScopeValue>(ALL_STORES)
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(today)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [selected, setSelected] = useState<PaidPurchase>()

  const [formOpen, setFormOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [businessDate, setBusinessDate] = useState(today)
  const [folio, setFolio] = useState('')
  const [amount, setAmount] = useState('')
  const [fundingSource, setFundingSource] =
    useState<PaymentFundingSource>('store_cash')
  const [sourceStoreId, setSourceStoreId] = useState('')
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>('efectivo')
  const [bills, setBills] = useState<CentralCashBills>({
    ...EMPTY_CENTRAL_CASH_BILLS,
  })
  const [coinsAmount, setCoinsAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [purchaseId, setPurchaseId] = useState('')
  const [paymentId, setPaymentId] = useState('')
  const fabRef = useRef<HTMLButtonElement>(null)
  const supplierInputRef = useRef<HTMLSelectElement>(null)

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.isActive),
    [suppliers],
  )
  const storeNames = useMemo(
    () => new Map(stores.map((store) => [store.id, store.name])),
    [stores],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [availableSuppliers, items] = await Promise.all([
        referenceDataService.listSuppliers(),
        purchaseService.list({
          supplierId: supplierFilter === 'all' ? undefined : supplierFilter,
          fundingSource: originFilter === 'all' ? undefined : originFilter,
          storeId:
            originFilter === 'central_cash' || storeFilter === ALL_STORES
              ? undefined
              : storeFilter,
          dateFrom,
          dateTo,
        }),
      ])
      setSuppliers(availableSuppliers)
      setPurchases(items)
    } catch (cause: unknown) {
      console.error('No fue posible consultar Compras', cause)
      setError('No fue posible consultar las Compras guardadas.')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, originFilter, storeFilter, supplierFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setFeedback(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  const grouped = useMemo(() => {
    const groups = new Map<string, PaidPurchase[]>()
    for (const item of purchases) {
      const group = groups.get(item.purchase.businessDate) ?? []
      group.push(item)
      groups.set(item.purchase.businessDate, group)
    }
    return [...groups.entries()]
  }, [purchases])

  const denominationTotal = useMemo(() => {
    return calculateCentralCashBillsTotal(bills) + Number(coinsAmount || 0)
  }, [bills, coinsAmount])

  const initialSupplierId = activeSuppliers[0]?.id ?? ''
  const initialStoreId = activeStores[0]?.id ?? ''
  const formDirty =
    supplierId !== initialSupplierId ||
    amount.length > 0 ||
    folio.length > 0 ||
    notes.length > 0 ||
    sourceStoreId !== initialStoreId ||
    businessDate !== today ||
    fundingSource !== 'store_cash' ||
    paymentMethod !== 'efectivo' ||
    Object.values(bills).some((count) => count > 0) ||
    Number(coinsAmount || 0) > 0

  function openForm() {
    setSupplierId(initialSupplierId)
    setBusinessDate(today)
    setFolio('')
    setAmount('')
    setFundingSource('store_cash')
    setSourceStoreId(initialStoreId)
    setPaymentMethod('efectivo')
    setBills({ ...EMPTY_CENTRAL_CASH_BILLS })
    setCoinsAmount('')
    setNotes('')
    setPurchaseId(crypto.randomUUID())
    setPaymentId(crypto.randomUUID())
    setFormError('')
    setConfirming(false)
    setFormOpen(true)
  }

  function prepareConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    const numericAmount = Number(amount)
    if (!supplierId) {
      setFormError('Selecciona un proveedor.')
      return
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError('El monto debe ser mayor a cero.')
      return
    }
    if (fundingSource === 'store_cash' && !sourceStoreId) {
      setFormError('Selecciona una tienda.')
      return
    }
    if (
      paymentMethod === 'efectivo' &&
      Math.round(denominationTotal * 100) !== Math.round(numericAmount * 100)
    ) {
      setFormError('Las denominaciones deben sumar exactamente el monto.')
      return
    }
    setConfirming(true)
  }

  async function confirmPurchase() {
    setSaving(true)
    setFormError('')
    try {
      await purchaseService.create(
        {
          purchaseId,
          paymentId,
          supplierId,
          businessDate,
          folio,
          amount: Number(amount),
          notes,
          fundingSource,
          sourceStoreId:
            fundingSource === 'store_cash' ? sourceStoreId : undefined,
          paymentMethod,
          bills: paymentMethod === 'efectivo' ? bills : undefined,
          coinsAmount:
            paymentMethod === 'efectivo' ? Number(coinsAmount || 0) : 0,
        },
        user,
      )
      setFormOpen(false)
      setConfirming(false)
      setFeedback(
        fundingSource === 'store_cash' && !networkAvailable
          ? 'Compra registrada. Pendiente de sincronizar.'
          : 'Compra registrada.',
      )
      await load()
      onDataChanged()
      if (fundingSource === 'store_cash') {
        void syncService
          .process()
          .then(async () => {
            await load()
            onDataChanged()
          })
          .catch((cause: unknown) => {
            console.error('No fue posible sincronizar la compra', cause)
          })
      }
    } catch (cause: unknown) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible registrar la compra.',
      )
    } finally {
      setSaving(false)
    }
  }

  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId)
  const selectedStore = stores.find((store) => store.id === sourceStoreId)
  const centralAvailable =
    networkAvailable && isSupabaseConfigured && !user.demo

  if (user.role !== 'admin') return null

  return (
    <section>
      <h1 className="page-title">Compras</h1>

      {feedback && <p className="alert-success mt-5"><CheckIcon className="size-5" />{feedback}</p>}
      {error && <p className="alert-error mt-5">{error}</p>}
      {!loading && activeSuppliers.length === 0 && (
        <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No hay proveedores disponibles. Agrega uno desde Ajustes → Proveedores.
        </p>
      )}

      <div className="mt-5 space-y-4">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">Origen</p>
          <FilterChipGroup
            ariaLabel="Filtrar Compras por origen"
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'central_cash', label: 'Caja Central' },
              { value: 'store_cash', label: 'Caja de tienda' },
            ]}
            value={originFilter}
            onChange={setOriginFilter}
          />
        </div>

        {originFilter !== 'central_cash' && (
          <StoreScopeSelector
            ariaLabel="Filtrar Compras por tienda"
            role={user.role}
            stores={stores}
            value={storeFilter}
            onChange={setStoreFilter}
          />
        )}

        <div className="panel grid gap-3 p-4 sm:grid-cols-3">
          <label className="field-label">
            Proveedor
            <select className="field" value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="all">Todos</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label className="field-label">
            Desde
            <DatePickerButton
              aria-label="Fecha inicial de Compras"
              max={dateTo}
              variant="field"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            >
              {formatFilterDate(dateFrom)}
            </DatePickerButton>
          </label>
          <label className="field-label">
            Hasta
            <DatePickerButton
              aria-label="Fecha final de Compras"
              min={dateFrom}
              variant="field"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            >
              {formatFilterDate(dateTo)}
            </DatePickerButton>
          </label>
        </div>
      </div>

      {loading ? (
        <p className="mt-8 text-center text-sm text-slate-500">Cargando Compras…</p>
      ) : grouped.length === 0 ? (
        <div className="panel mt-6 border-dashed text-center">
          <ReceiptIcon className="mx-auto size-9 text-slate-300" />
          <p className="mt-3 font-bold text-slate-700">No hay Compras en este periodo</p>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {grouped.map(([date, items]) => (
            <section className="panel p-0" key={date}>
              <h2 className="border-b border-slate-100 px-5 py-3 text-xs font-extrabold tracking-wider text-slate-500">{groupLabel(date)}</h2>
              <div className="divide-y divide-slate-100">
                {items.map((item) => (
                  <button className="flex w-full items-center gap-3 px-5 py-4 text-left" key={item.purchase.id} type="button" onClick={() => setSelected(item)}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 font-black text-teal-700">{item.purchase.supplierNameSnapshot.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-slate-900">{item.purchase.supplierNameSnapshot}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {item.payment.fundingSource === 'central_cash'
                          ? 'Caja Central'
                          : storeNames.get(item.payment.sourceStoreId ?? '') ?? 'Tienda'}
                        {' · '}{PAYMENT_LABELS[item.payment.paymentMethod]}
                      </span>
                      <span className={`mt-0.5 block text-[11px] font-bold ${item.purchase.syncStatus === 'synced' ? 'text-emerald-600' : 'text-amber-700'}`}>
                        {item.purchase.syncStatus === 'synced' ? 'Sincronizada' : 'Pendiente de sincronizar'}
                      </span>
                    </span>
                    <strong className="shrink-0 tabular-nums text-slate-950">{currencyFormatter.format(item.purchase.amount)}</strong>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <button aria-label="Registrar nueva Compra" className="app-fab" disabled={activeSuppliers.length === 0 || (activeStores.length === 0 && !centralAvailable)} ref={fabRef} title="Nueva Compra" type="button" onClick={openForm}>
        <PlusIcon className="size-7" />
      </button>

      <AppModal
        closeDisabled={saving}
        closeLabel="Cerrar formulario de Compra"
        eyebrow="Pago de contado"
        hasUnsavedChanges={formDirty}
        initialFocusRef={supplierInputRef}
        open={formOpen}
        returnFocusRef={fabRef}
        title={confirming ? 'Confirmar compra' : 'Nueva Compra'}
        onClose={() => setFormOpen(false)}
      >
        {formError && <p className="alert-error mt-5">{formError}</p>}
        {confirming ? (
          <div className="mt-6">
            <dl className="space-y-3 rounded-2xl bg-slate-50 p-5">
              <div className="summary-row"><dt>Proveedor</dt><dd>{selectedSupplier?.name}</dd></div>
              <div className="summary-row"><dt>Monto</dt><dd>{currencyFormatter.format(Number(amount))}</dd></div>
              <div className="summary-row"><dt>Origen</dt><dd>{fundingSource === 'central_cash' ? 'Caja Central' : `Caja ${selectedStore?.name ?? ''}`}</dd></div>
              <div className="summary-row"><dt>Forma de pago</dt><dd>{PAYMENT_LABELS[paymentMethod]}</dd></div>
            </dl>
            {fundingSource === 'central_cash' && (
              <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                Se descontarán {currencyFormatter.format(Number(amount))} de Caja Central.
              </p>
            )}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button className="button-secondary" disabled={saving} type="button" onClick={() => setConfirming(false)}>Volver</button>
              <button className="button-primary" disabled={saving} type="button" onClick={() => void confirmPurchase()}>
                {saving ? <><SyncIcon className="size-4 animate-spin" /> Registrando…</> : 'Registrar compra'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={prepareConfirmation}>
            {activeSuppliers.length === 0 ? (
              <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                No hay proveedores disponibles. Agrega uno desde Ajustes → Proveedores.
              </p>
            ) : (
              <div className="mt-6 space-y-5">
                <label className="field-label">Proveedor<select className="field" ref={supplierInputRef} required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="field-label">Fecha<input className="field" max={today} required type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} /></label>
                  <label className="field-label">Folio / número de nota<input className="field" maxLength={80} value={folio} onChange={(event) => setFolio(event.target.value)} /></label>
                </div>
                <label className="field-label">Monto<div className="money-field"><span>$</span><input inputMode="decimal" min="0.01" required step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label>
                <div>
                  <p className="field-label">Origen del pago</p>
                  <FilterChipGroup
                    ariaLabel="Origen del pago"
                    options={[
                      { value: 'store_cash', label: 'Caja de tienda' },
                      { value: 'central_cash', label: 'Caja Central', disabled: !centralAvailable },
                    ]}
                    value={fundingSource}
                    onChange={setFundingSource}
                  />
                  {!centralAvailable && <p className="mt-2 text-xs text-slate-500">Caja Central requiere conexión y una sesión Supabase.</p>}
                </div>
                {fundingSource === 'store_cash' && <label className="field-label">Tienda<select className="field" required value={sourceStoreId} onChange={(event) => setSourceStoreId(event.target.value)}>{activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}
                <label className="field-label">Forma de pago<select className="field" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_LABELS[method]}</option>)}</select></label>
                {paymentMethod === 'efectivo' && (
                  <div>
                    <p className="field-label">Denominaciones</p>
                    <div className="mt-2">
                      <BillCounter
                        coinsValue={coinsAmount}
                        showTotal={false}
                        value={bills}
                        onCoinsChange={setCoinsAmount}
                        onChange={setBills}
                      />
                    </div>
                    <p className={`mt-3 text-right text-sm font-extrabold ${Math.round(denominationTotal * 100) === Math.round(Number(amount || 0) * 100) ? 'text-emerald-700' : 'text-amber-700'}`}>Total: {currencyFormatter.format(denominationTotal)}</p>
                  </div>
                )}
                <label className="field-label">Notas <span className="font-normal text-slate-400">(opcional)</span><textarea className="field min-h-20 resize-y" maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button className="button-secondary" disabled={saving} type="button" onClick={() => setFormOpen(false)}>Cancelar</button>
              <button className="button-primary" disabled={saving || activeSuppliers.length === 0} type="submit">Continuar</button>
            </div>
          </form>
        )}
      </AppModal>

      <AppModal closeLabel="Cerrar detalle" eyebrow="Compra pagada" open={Boolean(selected)} title={selected?.purchase.supplierNameSnapshot ?? ''} onClose={() => setSelected(undefined)}>
        {selected && (
          <dl className="mt-6 space-y-3">
            <div className="summary-row"><dt>Folio</dt><dd>{selected.purchase.folio || 'Sin folio'}</dd></div>
            <div className="summary-row"><dt>Fecha</dt><dd>{formatLongDate(selected.purchase.businessDate)}</dd></div>
            <div className="summary-row"><dt>Monto</dt><dd>{currencyFormatter.format(selected.purchase.amount)}</dd></div>
            <div className="summary-row"><dt>Origen</dt><dd>{selected.payment.fundingSource === 'central_cash' ? 'Caja Central' : storeNames.get(selected.payment.sourceStoreId ?? '') ?? 'Tienda'}</dd></div>
            <div className="summary-row"><dt>Forma de pago</dt><dd>{PAYMENT_LABELS[selected.payment.paymentMethod]}</dd></div>
            <div className="summary-row"><dt>Creado por</dt><dd>{selected.purchase.createdBy === user.id ? user.fullName : 'Administración'}</dd></div>
            <div className="summary-row"><dt>Registrado</dt><dd>{new Date(selected.purchase.createdAt).toLocaleString('es-MX')}</dd></div>
            {selected.purchase.notes && <div><dt className="text-xs font-bold text-slate-500">Notas</dt><dd className="mt-1 text-sm text-slate-800">{selected.purchase.notes}</dd></div>}
          </dl>
        )}
      </AppModal>
    </section>
  )
}
