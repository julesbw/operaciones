import { useCallback, useEffect, useMemo, useState } from 'react'
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
  ExportIcon,
  WifiOffIcon,
} from '../components/icons'
import type {
  ExportBatch,
  ExportCandidate,
} from '../domain/exportContract'
import type { Store, UserProfile } from '../domain/models'
import {
  buildExportFilename,
  downloadExportFile,
  exportService,
} from '../services/exportService'
import { formatLongDate, getOperationalDate } from '../utils/date'
import { currencyFormatter } from '../utils/money'

type ExportTab = 'pending' | 'history'

type ExportsPageProps = {
  stores: Store[]
  user: UserProfile
  networkAvailable: boolean
}

const TAB_OPTIONS: readonly FilterChipOption<ExportTab>[] = [
  { value: 'pending', label: 'Pendientes' },
  { value: 'history', label: 'Historial' },
]

const STATUS_LABELS: Record<ExportBatch['status'], string> = {
  prepared: 'Preparado',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
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

function batchTime(value: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function upsertBatch(batches: ExportBatch[], updated: ExportBatch): ExportBatch[] {
  return [updated, ...batches.filter((batch) => batch.id !== updated.id)]
}

function Filters({
  stores,
  user,
  storeFilter,
  dateFrom,
  dateTo,
  onStoreChange,
  onDateFromChange,
  onDateToChange,
}: {
  stores: Store[]
  user: UserProfile
  storeFilter: StoreScopeValue
  dateFrom: string
  dateTo: string
  onStoreChange: (value: StoreScopeValue) => void
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
          Tienda
        </p>
        <StoreScopeSelector
          ariaLabel="Filtrar exportaciones por tienda"
          includeInactive
          role={user.role}
          stores={stores}
          value={storeFilter}
          onChange={onStoreChange}
        />
      </div>
      <div className="panel grid grid-cols-2 gap-x-2 gap-y-3 p-3 sm:gap-4 sm:p-5">
        <label className="field-label min-w-0">
          Desde
          <span className="expense-date-control">
            <span aria-hidden="true">{compactDate(dateFrom)}</span>
            <input
              aria-label="Fecha inicial de exportación"
              max={dateTo}
              type="date"
              value={dateFrom}
              onChange={(event) => onDateFromChange(event.target.value)}
            />
          </span>
        </label>
        <label className="field-label min-w-0">
          Hasta
          <span className="expense-date-control">
            <span aria-hidden="true">{compactDate(dateTo)}</span>
            <input
              aria-label="Fecha final de exportación"
              min={dateFrom}
              type="date"
              value={dateTo}
              onChange={(event) => onDateToChange(event.target.value)}
            />
          </span>
        </label>
      </div>
    </div>
  )
}

function CandidateCard({
  candidate,
  selected,
  onToggle,
}: {
  candidate: ExportCandidate
  selected: boolean
  onToggle: () => void
}) {
  return (
    <label className="panel flex cursor-pointer items-start gap-3 transition hover:border-teal-200 hover:bg-teal-50/30">
      <input
        checked={selected}
        className="mt-1 size-5 shrink-0 accent-teal-700"
        type="checkbox"
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-black text-slate-950">
          {candidate.storeName} · Corte #{candidate.sequenceNumber}
        </span>
        <span className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-500 sm:grid-cols-5">
          <span>
            <strong className="block text-sm text-slate-900">
              {currencyFormatter.format(candidate.grossCash)}
            </strong>
            Efectivo bruto
          </span>
          <span>
            <strong className="block text-sm text-slate-900">
              {currencyFormatter.format(candidate.cashExpensesTotal)}
            </strong>
            Gastos desde caja
          </span>
          <span>
            <strong className="block text-sm text-slate-900">
              {currencyFormatter.format(candidate.storeCashPaymentsTotal)}
            </strong>
            Pagos
          </span>
          <span>
            <strong className="block text-sm text-slate-900">
              {currencyFormatter.format(candidate.netCash)}
            </strong>
            Neto
          </span>
          <span>
            <strong className="block text-sm text-teal-800">
              {currencyFormatter.format(candidate.physicalCashAmount)}
            </strong>
            Efectivo retirado
          </span>
        </span>
      </span>
    </label>
  )
}

function BatchCard({ batch, onOpen }: { batch: ExportBatch; onOpen: () => void }) {
  return (
    <button
      className="panel flex w-full items-center gap-4 text-left transition hover:border-teal-200 hover:bg-teal-50/30"
      type="button"
      onClick={onOpen}
    >
      <span className="min-w-0 flex-1">
        <span
          className={`eyebrow block ${
            batch.status === 'confirmed'
              ? 'text-teal-700'
              : batch.status === 'cancelled'
                ? 'text-slate-500'
                : 'text-amber-700'
          }`}
        >
          {STATUS_LABELS[batch.status]}
        </span>
        <span className="mt-1 block text-base font-black text-slate-950">
          {batchTime(batch.createdAt)} · {batch.payloadSnapshot.total_cortes}{' '}
          {batch.payloadSnapshot.total_cortes === 1 ? 'corte' : 'cortes'}
        </span>
        <span className="mt-2 block text-xs leading-5 text-slate-500">
          {batch.payloadSnapshot.cortes
            .map(
              (closing) =>
                `${closing.store_name} · Corte #${closing.sequence_number}`,
            )
            .join(' · ')}
        </span>
      </span>
      <ArrowIcon className="size-5 shrink-0 text-slate-400" />
    </button>
  )
}

function BatchDetail({
  batch,
  networkAvailable,
  action,
  error,
  onBack,
  onConfirm,
  onCancel,
}: {
  batch: ExportBatch
  networkAvailable: boolean
  action?: 'confirming' | 'cancelling'
  error: string
  onBack: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <section>
      <button className="small-button" type="button" onClick={onBack}>
        ← Volver a Exportación
      </button>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Lote {batch.id.slice(0, 8)}</p>
          <h1 className="page-title mt-1">{STATUS_LABELS[batch.status]}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {batchTime(batch.createdAt)} · contrato {batch.contractVersion}
          </p>
        </div>
        {batch.status !== 'cancelled' && (
          <button
            className="button-secondary"
            type="button"
            onClick={() => downloadExportFile(batch)}
          >
            {batch.status === 'prepared'
              ? 'Regenerar archivo'
              : 'Descargar archivo'}
          </button>
        )}
      </div>

      {error && <p className="alert-error mt-5">{error}</p>}
      {!networkAvailable && batch.status === 'prepared' && (
        <p className="mt-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          <WifiOffIcon className="size-5 shrink-0" />
          Conéctate para confirmar o cancelar este lote.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {batch.payloadSnapshot.cortes.map((closing) => (
          <article className="panel" key={closing.id}>
            <p className="eyebrow">
              {formatLongDate(closing.business_date)} · Corte #{closing.sequence_number}
            </p>
            <h2 className="mt-1 text-lg font-black text-slate-950">
              {closing.store_name}
            </h2>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="summary-row"><dt>Efectivo bruto</dt><dd>{currencyFormatter.format(closing.gross_cash)}</dd></div>
              <div className="summary-row"><dt>Gastos desde caja</dt><dd>{currencyFormatter.format(closing.cash_expenses_total)}</dd></div>
              <div className="summary-row"><dt>Pagos desde caja</dt><dd>{currencyFormatter.format(closing.store_cash_payments_total)}</dd></div>
              <div className="summary-row border-t border-slate-200 pt-3 font-extrabold"><dt>Efectivo neto</dt><dd>{currencyFormatter.format(closing.net_cash)}</dd></div>
              <div className="summary-row"><dt>Saldo en tienda</dt><dd>{currencyFormatter.format(closing.cash_balance)}</dd></div>
              <div className="summary-row font-extrabold text-teal-800"><dt>Efectivo físico</dt><dd>{currencyFormatter.format(closing.physical_cash.amount)}</dd></div>
              <div className="summary-row"><dt>Billetes</dt><dd>{currencyFormatter.format(closing.physical_cash.bills_total)}</dd></div>
              <div className="summary-row"><dt>Monedas</dt><dd>{currencyFormatter.format(closing.physical_cash.coins_amount)}</dd></div>
            </dl>
          </article>
        ))}
      </div>

      <p className="mt-5 break-all text-xs text-slate-500">
        Archivo: {buildExportFilename(batch)}
      </p>

      {batch.status === 'prepared' && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="font-extrabold text-amber-950">Archivo preparado</p>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            Confirma la exportación únicamente después de haber importado
            correctamente el archivo en el Add-in.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              className="button-primary"
              disabled={!networkAvailable || Boolean(action)}
              type="button"
              onClick={onConfirm}
            >
              {action === 'confirming' ? 'Confirmando…' : 'Confirmar exportación'}
            </button>
            <button
              className="button-secondary"
              disabled={!networkAvailable || Boolean(action)}
              type="button"
              onClick={onCancel}
            >
              {action === 'cancelling' ? 'Cancelando…' : 'Cancelar lote'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export function ExportsPage({
  stores,
  user,
  networkAvailable,
}: ExportsPageProps) {
  const today = getOperationalDate()
  const [tab, setTab] = useState<ExportTab>('pending')
  const [storeFilter, setStoreFilter] = useState<StoreScopeValue>(ALL_STORES)
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 8)}01`)
  const [dateTo, setDateTo] = useState(today)
  const [candidates, setCandidates] = useState<ExportCandidate[]>([])
  const [batches, setBatches] = useState<ExportBatch[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedBatch, setSelectedBatch] = useState<ExportBatch>()
  const [loading, setLoading] = useState(true)
  const [fromCache, setFromCache] = useState(false)
  const [error, setError] = useState('')
  const [action, setAction] = useState<
    'preparing' | 'confirming' | 'cancelling'
  >()

  const queryStoreId = storeFilter === ALL_STORES ? undefined : storeFilter

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (tab === 'pending') {
        const result = await exportService.listCandidates(
          queryStoreId,
          dateFrom,
          dateTo,
        )
        setCandidates(result.items)
        setFromCache(result.fromCache)
        const availableIds = new Set(result.items.map((candidate) => candidate.id))
        setSelectedIds(
          (current) => new Set([...current].filter((id) => availableIds.has(id))),
        )
      } else {
        const result = await exportService.listBatches()
        setBatches(result.items)
        setFromCache(result.fromCache)
      }
    } catch (cause: unknown) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, queryStoreId, tab])

  useEffect(() => {
    void load()
  }, [load])

  const filteredBatches = useMemo(
    () =>
      batches.filter((batch) =>
        batch.payloadSnapshot.cortes.some(
          (closing) =>
            (!queryStoreId || closing.store_id === queryStoreId) &&
            closing.business_date >= dateFrom &&
            closing.business_date <= dateTo,
        ),
      ),
    [batches, dateFrom, dateTo, queryStoreId],
  )

  const candidatesByDate = useMemo(() => {
    const groups = new Map<string, ExportCandidate[]>()
    for (const candidate of candidates) {
      const group = groups.get(candidate.businessDate) ?? []
      group.push(candidate)
      groups.set(candidate.businessDate, group)
    }
    return [...groups.entries()]
  }, [candidates])

  function changeDateFrom(value: string) {
    setDateFrom(value)
    if (value > dateTo) setDateTo(value)
  }

  function changeDateTo(value: string) {
    setDateTo(value)
    if (value < dateFrom) setDateFrom(value)
  }

  function toggleCandidate(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function prepare() {
    setAction('preparing')
    setError('')
    try {
      const batch = await exportService.prepare([...selectedIds])
      setBatches((current) => upsertBatch(current, batch))
      setCandidates((current) =>
        current.filter((candidate) => !selectedIds.has(candidate.id)),
      )
      setSelectedIds(new Set())
      setSelectedBatch(batch)
      downloadExportFile(batch)
    } catch (cause: unknown) {
      setError(errorMessage(cause))
    } finally {
      setAction(undefined)
    }
  }

  async function confirmSelectedBatch() {
    if (!selectedBatch) return
    setAction('confirming')
    setError('')
    try {
      const batch = await exportService.confirm(selectedBatch.id)
      setSelectedBatch(batch)
      setBatches((current) => upsertBatch(current, batch))
    } catch (cause: unknown) {
      setError(errorMessage(cause))
    } finally {
      setAction(undefined)
    }
  }

  async function cancelSelectedBatch() {
    if (!selectedBatch) return
    setAction('cancelling')
    setError('')
    try {
      const batch = await exportService.cancel(selectedBatch.id)
      setSelectedBatch(batch)
      setBatches((current) => upsertBatch(current, batch))
    } catch (cause: unknown) {
      setError(errorMessage(cause))
    } finally {
      setAction(undefined)
    }
  }

  if (user.role !== 'admin') return null

  if (selectedBatch) {
    return (
      <BatchDetail
        action={
          action === 'confirming' || action === 'cancelling'
            ? action
            : undefined
        }
        batch={selectedBatch}
        error={error}
        networkAvailable={networkAvailable}
        onBack={() => {
          setSelectedBatch(undefined)
          setError('')
          void load()
        }}
        onCancel={() => void cancelSelectedBatch()}
        onConfirm={() => void confirmSelectedBatch()}
      />
    )
  }

  return (
    <section>
      <div className="flex items-center gap-3">
        <ExportIcon className="size-8 text-teal-700" />
        <h1 className="page-title">Exportación</h1>
      </div>

      <div className="mt-5 space-y-5 sm:mt-7">
        <FilterChipGroup
          ariaLabel="Sección de Exportación"
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
        />

        <Filters
          dateFrom={dateFrom}
          dateTo={dateTo}
          storeFilter={storeFilter}
          stores={stores}
          user={user}
          onDateFromChange={changeDateFrom}
          onDateToChange={changeDateTo}
          onStoreChange={setStoreFilter}
        />

        {fromCache && (
          <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">
            <WifiOffIcon className="size-4 shrink-0" />
            Mostrando la última información guardada en este dispositivo.
          </p>
        )}
        {error && <p className="alert-error">{error}</p>}
        {loading && <p className="empty-state">Consultando exportaciones…</p>}

        {!loading && tab === 'pending' && candidates.length === 0 && (
          <div className="panel empty-state">
            <CheckIcon className="mx-auto mb-3 size-8 text-teal-700" />
            <p>No hay Cortes pendientes en este periodo.</p>
          </div>
        )}

        {!loading && tab === 'pending' && candidates.length > 0 && (
          <div className="space-y-6">
            {candidatesByDate.map(([date, entries]) => (
              <section key={date}>
                <h2 className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                  {compactDate(date)}
                </h2>
                <div className="space-y-3">
                  {entries.map((candidate) => (
                    <CandidateCard
                      candidate={candidate}
                      key={candidate.id}
                      selected={selectedIds.has(candidate.id)}
                      onToggle={() => toggleCandidate(candidate.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
            <div className="sticky bottom-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur lg:bottom-4">
              <button
                className="button-primary w-full"
                disabled={
                  selectedIds.size === 0 ||
                  !networkAvailable ||
                  action === 'preparing'
                }
                type="button"
                onClick={() => void prepare()}
              >
                {action === 'preparing'
                  ? 'Preparando…'
                  : `Preparar exportación (${selectedIds.size})`}
              </button>
              {!networkAvailable && (
                <p className="mt-2 text-center text-xs text-amber-700">
                  Esta operación requiere conexión.
                </p>
              )}
            </div>
          </div>
        )}

        {!loading && tab === 'history' && filteredBatches.length === 0 && (
          <div className="panel empty-state">
            <CashIcon className="mx-auto mb-3 size-8" />
            <p>No hay lotes en este periodo.</p>
          </div>
        )}
        {!loading && tab === 'history' && filteredBatches.length > 0 && (
          <div className="space-y-3">
            {filteredBatches.map((batch) => (
              <BatchCard
                batch={batch}
                key={batch.id}
                onOpen={() => setSelectedBatch(batch)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
