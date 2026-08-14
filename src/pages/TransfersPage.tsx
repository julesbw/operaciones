import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { AppModal } from '../components/AppModal'
import {
  ALL_STORES,
  StoreScopeSelector,
  type StoreScopeValue,
} from '../components/filters/StoreScopeSelector'
import {
  CheckIcon,
  PlusIcon,
  SyncIcon,
  TransferIcon,
} from '../components/icons'
import type {
  MerchandiseTransfer,
  Store,
  UserProfile,
} from '../domain/models'
import { syncService } from '../services/syncService'
import { connectivityService } from '../services/connectivityService'
import {
  filterTransfersByTicket,
  sumTransferAmounts,
  transferService,
  TransferValidationError,
} from '../services/transferService'
import {
  formatLongDate,
  getLocalDate,
  getOperationalDate,
} from '../utils/date'
import { currencyFormatter } from '../utils/money'

const COMPACT_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const DETAIL_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

type TransfersPageProps = {
  stores: Store[]
  user: UserProfile
  onDataChanged: () => void
}

export function resolveTransferOriginStoreId(
  user: Pick<UserProfile, 'role' | 'storeId'>,
  storeFilter: StoreScopeValue,
): string | undefined {
  if (user.role === 'cashier') return user.storeId || undefined
  return storeFilter === ALL_STORES ? undefined : storeFilter
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

function compactDate(value: string): string {
  return COMPACT_DATE_FORMATTER.format(new Date(`${value}T12:00:00`)).replace(
    '.',
    '',
  )
}

function detailDate(value: string): string {
  return DETAIL_DATE_FORMATTER.format(new Date(`${value}T12:00:00`))
}

export function TransfersPage({
  stores,
  user,
  onDataChanged,
}: TransfersPageProps) {
  const today = getOperationalDate()
  const activeStores = useMemo(
    () => stores.filter((store) => store.status === 'active'),
    [stores],
  )
  const isAdmin = user.role === 'admin'
  const cashierStoreId = user.storeId ?? ''
  const [storeFilter, setStoreFilter] = useState<StoreScopeValue>(
    isAdmin ? ALL_STORES : cashierStoreId,
  )
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [ticketSearch, setTicketSearch] = useState('')
  const [transfers, setTransfers] = useState<MerchandiseTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [formOriginStoreId, setFormOriginStoreId] = useState('')
  const [initialOriginStoreId, setInitialOriginStoreId] = useState('')
  const [destinationStoreId, setDestinationStoreId] = useState('')
  const [ticketNumber, setTicketNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [formDate, setFormDate] = useState(today)
  const [initialFormDate, setInitialFormDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [selectedTransfer, setSelectedTransfer] =
    useState<MerchandiseTransfer>()
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const ticketInputRef = useRef<HTMLInputElement>(null)

  const queryOriginStoreId = resolveTransferOriginStoreId(user, storeFilter)

  const load = useCallback(async () => {
    if (!isAdmin && !cashierStoreId) {
      setTransfers([])
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError('')
    try {
      setTransfers(
        await transferService.list(queryOriginStoreId, dateFrom, dateTo),
      )
    } catch (cause: unknown) {
      console.error('No fue posible consultar las transferencias', cause)
      setLoadError(
        'No fue posible consultar las transferencias guardadas en este dispositivo.',
      )
    } finally {
      setLoading(false)
    }
  }, [cashierStoreId, dateFrom, dateTo, isAdmin, queryOriginStoreId])

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
    const timeout = window.setTimeout(() => setFeedback(''), 3_200)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  const visibleTransfers = useMemo(() => {
    return filterTransfersByTicket(transfers, ticketSearch)
  }, [ticketSearch, transfers])

  const total = useMemo(
    () => sumTransferAmounts(visibleTransfers),
    [visibleTransfers],
  )

  const groupedTransfers = useMemo(() => {
    const groups = new Map<string, MerchandiseTransfer[]>()
    for (const transfer of visibleTransfers) {
      const group = groups.get(transfer.businessDate) ?? []
      group.push(transfer)
      groups.set(transfer.businessDate, group)
    }
    return Array.from(groups.entries())
  }, [visibleTransfers])

  const storeNames = useMemo(
    () => new Map(stores.map((store) => [store.id, store.name])),
    [stores],
  )

  const effectiveOriginStoreId = isAdmin
    ? formOriginStoreId
    : cashierStoreId
  const availableDestinations = activeStores.filter(
    (store) => store.id !== effectiveOriginStoreId,
  )
  const apparentDuplicate = useMemo(
    () =>
      transfers.some(
        (transfer) =>
          transfer.originStoreId === effectiveOriginStoreId &&
          transfer.businessDate === formDate &&
          transfer.ticketNumber.toLocaleLowerCase('es-MX') ===
            ticketNumber.trim().toLocaleLowerCase('es-MX'),
      ),
    [effectiveOriginStoreId, formDate, ticketNumber, transfers],
  )

  const isFormDirty =
    destinationStoreId.length > 0 ||
    ticketNumber.trim().length > 0 ||
    amount.trim().length > 0 ||
    notes.trim().length > 0 ||
    formOriginStoreId !== initialOriginStoreId ||
    formDate !== initialFormDate

  function changeDateFrom(value: string) {
    setDateFrom(value)
    if (value > dateTo) setDateTo(value)
  }

  function changeDateTo(value: string) {
    setDateTo(value)
    if (value < dateFrom) setDateFrom(value)
  }

  function openForm() {
    const selectedOrigin = isAdmin
      ? storeFilter === ALL_STORES
        ? ''
        : storeFilter
      : cashierStoreId
    const selectedDate =
      today >= dateFrom && today <= dateTo ? today : dateTo

    setFormOriginStoreId(selectedOrigin)
    setInitialOriginStoreId(selectedOrigin)
    setDestinationStoreId('')
    setTicketNumber('')
    setAmount('')
    setFormDate(selectedDate)
    setInitialFormDate(selectedDate)
    setNotes('')
    setErrors([])
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])
    setSaving(true)

    try {
      await transferService.create(
        {
          originStoreId: effectiveOriginStoreId,
          destinationStoreId,
          ticketNumber,
          amount: Number(amount),
          businessDate: formDate,
          notes,
        },
        user.id,
      )
      await load()
      setFeedback(
        connectivityService.isNetworkAvailable()
          ? 'Transferencia registrada'
          : 'Transferencia registrada. Pendiente de sincronizar.',
      )
      setFormOpen(false)
      onDataChanged()
      void syncService
        .process()
        .then(async () => {
          await load()
          onDataChanged()
        })
        .catch((cause: unknown) => {
          console.error('No fue posible sincronizar la transferencia', cause)
        })
    } catch (cause: unknown) {
      if (cause instanceof TransferValidationError) {
        setErrors(cause.messages)
      } else {
        console.error('No fue posible guardar la transferencia', cause)
        setErrors([
          'No fue posible guardar la transferencia en este dispositivo',
        ])
      }
    } finally {
      setSaving(false)
    }
  }

  const cashierCanCreate =
    Boolean(cashierStoreId) &&
    activeStores.some((store) => store.id === cashierStoreId) &&
    activeStores.length > 1
  const cannotCreate = isAdmin ? activeStores.length < 2 : !cashierCanCreate

  return (
    <section>
      <h1 className="page-title">Transferencias</h1>

      {feedback && (
        <div className="alert-success mt-5" role="status">
          <CheckIcon className="size-5" />
          {feedback}
        </div>
      )}

      {!isAdmin && !cashierStoreId && (
        <div className="alert-error mt-5" role="alert">
          Tu perfil no tiene una tienda asignada. No es posible consultar ni
          registrar transferencias.
        </div>
      )}

      <div className="mt-4 space-y-3 sm:mt-7 sm:space-y-5">
        {isAdmin && (
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
              Tienda origen
            </p>
            <StoreScopeSelector
              ariaLabel="Filtrar transferencias por tienda de origen"
              assignedStoreId={user.storeId}
              role={user.role}
              stores={stores}
              value={storeFilter}
              onChange={setStoreFilter}
            />
          </div>
        )}

        <div className="panel grid grid-cols-2 gap-x-2 gap-y-3 p-3 sm:gap-4 sm:p-5 xl:grid-cols-[minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(260px,1.4fr)]">
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
                max={today}
                min={dateFrom}
                type="date"
                value={dateTo}
                onChange={(event) => changeDateTo(event.target.value)}
              />
            </span>
          </label>
          <label className="field-label col-span-2 xl:col-span-1">
            Ticket
            <input
              className="field"
              placeholder="Buscar número de ticket…"
              type="search"
              value={ticketSearch}
              onChange={(event) => setTicketSearch(event.target.value)}
            />
          </label>
        </div>

        <article className="summary-strip">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-800">
              {visibleTransfers.length} transferencia
              {visibleTransfers.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total
            </p>
            <p className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              {currencyFormatter.format(total)}
            </p>
          </div>
        </article>

        <div className="panel overflow-hidden p-0">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
            <h2 className="font-extrabold text-slate-950">Movimientos</h2>
            <TransferIcon className="size-5 shrink-0 text-slate-400" />
          </div>

          {loading && <p className="empty-state">Cargando transferencias…</p>}
          {!loading && loadError && (
            <div className="p-5 sm:p-6">
              <div className="alert-error" role="alert">
                {loadError}
              </div>
            </div>
          )}
          {!loading && !loadError && visibleTransfers.length === 0 && (
            <div className="empty-state">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <TransferIcon className="size-5" />
              </span>
              <p>No hay transferencias registradas</p>
              <button
                className="button-secondary mt-5"
                disabled={cannotCreate}
                type="button"
                onClick={openForm}
              >
                <PlusIcon className="size-4" />
                Registrar transferencia
              </button>
            </div>
          )}

          {!loading &&
            !loadError &&
            groupedTransfers.map(([date, items]) => (
              <section
                className="border-b border-slate-100 last:border-b-0"
                key={date}
              >
                <div className="bg-slate-50/80 px-5 py-2.5 sm:px-6">
                  <h3 className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-600">
                    {groupDateLabel(date, today)}
                  </h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((transfer) => {
                    const syncLabel =
                      transfer.syncStatus === 'error'
                        ? 'No se pudo sincronizar'
                        : transfer.syncStatus === 'synced'
                          ? ''
                          : 'Pendiente de sincronizar'
                    const syncClass =
                      transfer.syncStatus === 'error'
                        ? 'text-red-600'
                        : 'text-amber-700'

                    return (
                      <button
                        className="flex w-full min-w-0 items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50 sm:gap-4 sm:px-6"
                        key={transfer.id}
                        type="button"
                        onClick={() => setSelectedTransfer(transfer)}
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                          <TransferIcon className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-bold text-slate-900">
                            Ticket #{transfer.ticketNumber}
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                            {storeNames.get(transfer.originStoreId) ??
                              'Tienda sin nombre'}
                            <span aria-hidden="true"> → </span>
                            {storeNames.get(transfer.destinationStoreId) ??
                              'Tienda sin nombre'}
                          </span>
                          {syncLabel && (
                            <span
                              className={`mt-0.5 block text-[11px] font-bold ${syncClass}`}
                            >
                              <SyncIcon className="mr-1 inline size-3" />
                              {syncLabel}
                            </span>
                          )}
                        </span>
                        <span className="max-w-[38%] shrink-0 text-right text-sm font-black tabular-nums text-slate-950 sm:max-w-none sm:text-base">
                          {currencyFormatter.format(transfer.amount)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
        </div>
      </div>

      <button
        aria-label="Registrar nueva transferencia"
        className="app-fab"
        disabled={cannotCreate}
        ref={addButtonRef}
        title="Nueva transferencia"
        type="button"
        onClick={openForm}
      >
        <PlusIcon className="size-7" />
      </button>

      <AppModal
        closeDisabled={saving}
        closeLabel="Cerrar formulario de transferencia"
        hasUnsavedChanges={isFormDirty}
        initialFocusRef={ticketInputRef}
        open={formOpen}
        returnFocusRef={addButtonRef}
        title="Nueva transferencia"
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
                Origen
                <select
                  className="field"
                  required
                  value={formOriginStoreId}
                  onChange={(event) => {
                    setFormOriginStoreId(event.target.value)
                    if (event.target.value === destinationStoreId) {
                      setDestinationStoreId('')
                    }
                  }}
                >
                  <option disabled value="">
                    Selecciona una tienda
                  </option>
                  {activeStores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div>
                <p className="field-label">Origen</p>
                <p className="mt-2 rounded-xl bg-slate-50 px-3.5 py-3 text-sm font-bold text-slate-800 ring-1 ring-slate-200">
                  {storeNames.get(cashierStoreId) ?? user.storeName}
                </p>
              </div>
            )}

            <label className="field-label">
              Destino
              <select
                className="field"
                disabled={!effectiveOriginStoreId}
                required
                value={destinationStoreId}
                onChange={(event) => setDestinationStoreId(event.target.value)}
              >
                <option disabled value="">
                  Selecciona una tienda
                </option>
                {availableDestinations.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-label">
              Número de ticket
              <input
                autoComplete="off"
                className="field"
                maxLength={80}
                placeholder="Ej. 0018452"
                ref={ticketInputRef}
                required
                type="text"
                value={ticketNumber}
                onChange={(event) => setTicketNumber(event.target.value)}
              />
            </label>

            {apparentDuplicate && ticketNumber.trim() && (
              <div
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800"
                role="status"
              >
                Ya existe una transferencia con el mismo origen, fecha y
                ticket. Puedes registrarla si corresponde a otro movimiento.
              </div>
            )}

            <label className="field-label">
              Monto
              <div className="money-field">
                <span>$</span>
                <input
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

            <label className="field-label">
              Fecha
              <input
                className="field"
                max={today}
                required
                type="date"
                value={formDate}
                onChange={(event) => setFormDate(event.target.value)}
              />
            </label>

            <label className="field-label">
              Notas{' '}
              <span className="font-normal text-slate-400">(opcional)</span>
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
            <button
              className="button-primary w-full"
              disabled={saving}
              type="submit"
            >
              {saving ? (
                <>
                  <SyncIcon className="size-4 animate-spin" /> Guardando…
                </>
              ) : (
                <>
                  <CheckIcon className="size-4" /> Registrar
                </>
              )}
            </button>
          </div>
        </form>
      </AppModal>

      <AppModal
        closeLabel="Cerrar detalle de transferencia"
        open={Boolean(selectedTransfer)}
        title={`Ticket #${selectedTransfer?.ticketNumber ?? ''}`}
        onClose={() => setSelectedTransfer(undefined)}
      >
        {selectedTransfer && (
          <dl className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                Origen
              </dt>
              <dd className="mt-1 font-bold text-slate-900">
                {storeNames.get(selectedTransfer.originStoreId) ??
                  'Tienda sin nombre'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                Destino
              </dt>
              <dd className="mt-1 font-bold text-slate-900">
                {storeNames.get(selectedTransfer.destinationStoreId) ??
                  'Tienda sin nombre'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                Monto
              </dt>
              <dd className="mt-1 text-xl font-black text-slate-950">
                {currencyFormatter.format(selectedTransfer.amount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                Fecha
              </dt>
              <dd className="mt-1 font-bold text-slate-900">
                {detailDate(selectedTransfer.businessDate)}
              </dd>
            </div>
            {selectedTransfer.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                  Notas
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {selectedTransfer.notes}
                </dd>
              </div>
            )}
          </dl>
        )}
      </AppModal>
    </section>
  )
}
