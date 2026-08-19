import type { ChangeEvent, ReactElement, ReactNode } from 'react'
import { BILL_DENOMINATIONS } from '../domain/constants'
import type { CentralCashBills } from '../domain/models'
import { calculateCentralCashBillsTotal, currencyFormatter } from '../utils/money'

export type BillCounts = CentralCashBills

export type BillCounterProps = {
  value: BillCounts
  onChange: (value: BillCounts) => void
  maxCounts?: Partial<BillCounts>
  showTotal?: boolean
  totalLabel?: string
  className?: string
  variant?: 'cards' | 'table'
  renderBeforeInput?: (key: keyof BillCounts) => ReactNode
  renderAfterInput?: (key: keyof BillCounts) => ReactNode
  coinsValue?: number | string
  onCoinsChange?: (value: string) => void
  coinsMax?: number
  renderCoinsBeforeInput?: ReactNode
  renderCoinsAfterInput?: ReactNode
  getInputClassName?: (key: keyof BillCounts) => string | undefined
  getAriaLabel?: (key: keyof BillCounts, value: number) => string
  autoFocusFirst?: boolean
}

function parseCount(rawValue: string): number | undefined {
  if (rawValue === '') return 0
  if (!/^\d+$/.test(rawValue)) return undefined

  const value = Number(rawValue)
  return Number.isSafeInteger(value) ? value : undefined
}

function inputValue(value: number): string {
  const normalized = Math.max(0, Math.trunc(Number(value) || 0))
  return normalized > 0 ? String(normalized) : ''
}

function amountInputValue(value: number | string): string {
  return Number(value) > 0 ? String(value) : ''
}

export function BillCounterView({
  value,
  onChange,
  maxCounts,
  showTotal = true,
  totalLabel = 'Total de billetes',
  className = '',
  variant = 'table',
  renderBeforeInput,
  renderAfterInput,
  coinsValue,
  onCoinsChange,
  coinsMax,
  renderCoinsBeforeInput,
  renderCoinsAfterInput,
  getInputClassName,
  getAriaLabel,
  autoFocusFirst = false,
}: BillCounterProps): ReactElement {
  const hasCoins = coinsValue !== undefined && onCoinsChange !== undefined
  const contextualTable = Boolean(
    renderBeforeInput ||
      renderAfterInput ||
      renderCoinsBeforeInput ||
      renderCoinsAfterInput,
  )

  function changeCoins(event: ChangeEvent<HTMLInputElement>) {
    if (!onCoinsChange) return
    const rawValue = event.target.value
    if (rawValue === '') {
      onCoinsChange('')
      return
    }
    if (!/^\d*\.?\d*$/.test(rawValue)) return

    const numericValue = Number(rawValue)
    if (!Number.isFinite(numericValue)) return
    onCoinsChange(
      coinsMax === undefined
        ? rawValue
        : String(Math.min(numericValue, Math.max(0, coinsMax))),
    )
  }

  function changeCount(
    key: keyof BillCounts,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const parsed = parseCount(event.target.value)
    if (parsed === undefined) return

    const max = maxCounts?.[key]
    const nextValue = max === undefined
      ? parsed
      : Math.min(parsed, Math.max(0, Math.trunc(Number(max) || 0)))

    onChange({ ...value, [key]: nextValue })
  }

  return (
    <div className={className}>
      <div
        className={variant === 'table'
          ? 'divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200'
          : 'grid grid-cols-2 gap-3 sm:grid-cols-3'}
      >
        {variant === 'table' && !contextualTable && (
          <div className="grid grid-cols-[minmax(5rem,1fr)_minmax(4.25rem,0.8fr)_minmax(5.5rem,auto)] gap-2 bg-slate-50 px-3 py-3 text-center text-[10px] font-extrabold uppercase tracking-wider text-slate-400 sm:grid-cols-[minmax(6rem,1fr)_7rem_minmax(7rem,auto)] sm:px-4">
            <span className="text-left">Denominación</span>
            <span>Cantidad</span>
            <span className="text-right">Subtotal</span>
          </div>
        )}
        {BILL_DENOMINATIONS.filter(({ key }) => key !== 'monedas').map(
          (denomination, index) => {
            const key = denomination.key as keyof BillCounts
            const max = maxCounts?.[key]
            return (
              <label
                className={variant === 'table'
                  ? `grid min-h-16 ${renderBeforeInput && renderAfterInput ? 'grid-cols-[minmax(3.25rem,1fr)_2.625rem_3.5rem_2.75rem] sm:grid-cols-[minmax(6rem,1fr)_5rem_7rem_5rem]' : 'grid-cols-[minmax(5rem,1fr)_minmax(4.25rem,0.8fr)_minmax(5.5rem,auto)] sm:grid-cols-[minmax(6rem,1fr)_7rem_minmax(7rem,auto)]'} items-center gap-2 px-3 sm:px-4`
                  : 'denomination-field'}
                key={key}
              >
                <span className={variant === 'table' ? 'text-sm font-bold text-slate-700' : undefined}>
                  {denomination.label}
                </span>
                {renderBeforeInput?.(key)}
                <input
                  aria-label={getAriaLabel?.(key, denomination.value) ?? `Cantidad de billetes de ${denomination.value} pesos`}
                  autoFocus={autoFocusFirst && index === 0}
                  className={getInputClassName?.(key) ?? (variant === 'table'
                    ? 'h-10 min-w-0 rounded-lg border border-slate-300 px-2 text-center text-base font-bold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15'
                    : undefined)}
                  inputMode="numeric"
                  max={max}
                  min="0"
                  placeholder="0"
                  step="1"
                  type="number"
                  value={inputValue(value[key])}
                  onChange={(event) => changeCount(key, event)}
                />
                {variant === 'cards' && (
                  <output className="mt-2 block text-right text-xs font-bold tabular-nums text-slate-500">
                    {currencyFormatter.format(value[key] * denomination.value)}
                  </output>
                )}
                {variant === 'table' && !contextualTable && (
                  <output className="text-right text-sm font-extrabold tabular-nums text-slate-900">
                    {currencyFormatter.format(value[key] * denomination.value)}
                  </output>
                )}
                {renderAfterInput?.(key)}
              </label>
            )
          },
        )}
        {hasCoins && (
          <label
            className={variant === 'table'
              ? `grid min-h-16 ${contextualTable ? 'grid-cols-[minmax(3.25rem,1fr)_2.625rem_3.5rem_2.75rem] sm:grid-cols-[minmax(6rem,1fr)_5rem_7rem_5rem]' : 'grid-cols-[minmax(5rem,1fr)_minmax(4.25rem,0.8fr)_minmax(5.5rem,auto)] sm:grid-cols-[minmax(6rem,1fr)_7rem_minmax(7rem,auto)]'} items-center gap-2 px-3 sm:px-4`
              : 'denomination-field'}
          >
            <span className={variant === 'table' ? 'text-sm font-bold text-slate-700' : undefined}>
              Monedas
            </span>
            {renderCoinsBeforeInput}
            <input
              aria-label="Monto total en monedas"
              className={variant === 'table'
                ? 'h-10 min-w-0 rounded-lg border border-slate-300 px-2 text-center text-base font-bold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15'
                : undefined}
              inputMode="decimal"
              max={coinsMax}
              min="0"
              placeholder="0"
              step="0.01"
              type="number"
              value={amountInputValue(coinsValue)}
              onChange={changeCoins}
            />
            {variant === 'cards' && (
              <output className="mt-2 block text-right text-xs font-bold tabular-nums text-slate-500">
                {currencyFormatter.format(Number(coinsValue || 0))}
              </output>
            )}
            {variant === 'table' && !contextualTable && (
              <output className="text-right text-sm font-extrabold tabular-nums text-slate-900">
                {currencyFormatter.format(Number(coinsValue || 0))}
              </output>
            )}
            {renderCoinsAfterInput}
          </label>
        )}
      </div>
      {showTotal && (
        <div className="mt-3 flex items-center justify-between gap-4 text-sm">
          <span className="font-bold text-slate-600">{totalLabel}</span>
          <strong className="font-black tabular-nums text-slate-950">
            {currencyFormatter.format(
              calculateCentralCashBillsTotal(value) + Number(coinsValue || 0),
            )}
          </strong>
        </div>
      )}
    </div>
  )
}

export function BillCounter(props: BillCounterProps) {
  return BillCounterView(props)
}
