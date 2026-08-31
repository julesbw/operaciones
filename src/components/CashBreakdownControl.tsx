import { useState } from 'react'
import { AppModal } from './AppModal'
import { BillCounter } from './BillCounter'
import { EMPTY_CENTRAL_CASH_BILLS } from '../domain/constants'
import {
  cashBreakdownMatchesAmount,
  hasCapturedCashBreakdown,
  shouldConfirmCashBreakdownClose,
} from '../domain/purchasePolicy'
import type { CentralCashBills } from '../domain/models'
import { calculateCentralCashBillsTotal, currencyFormatter } from '../utils/money'

type CashBreakdownControlProps = {
  amount: number | string
  bills: CentralCashBills
  coinsAmount: number
  open: boolean
  visible: boolean
  showToggle: boolean
  toggleDescription: string
  errorMessage?: string
  onOpenChange: (open: boolean) => void
  onBillsChange: (bills: CentralCashBills) => void
  onCoinsChange: (amount: number) => void
}

export function CashBreakdownControl({
  amount,
  bills,
  coinsAmount,
  open,
  visible,
  showToggle,
  toggleDescription,
  errorMessage,
  onOpenChange,
  onBillsChange,
  onCoinsChange,
}: CashBreakdownControlProps) {
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false)
  const hasCapturedBreakdown = hasCapturedCashBreakdown(bills, coinsAmount)
  const breakdownTotal =
    calculateCentralCashBillsTotal(bills) + coinsAmount

  function handleToggle(enabled: boolean) {
    if (
      shouldConfirmCashBreakdownClose({
        nextOpen: enabled,
        hasCapturedBreakdown,
      })
    ) {
      setCloseConfirmationOpen(true)
      return
    }
    onOpenChange(enabled)
  }

  function closeAndClear() {
    onBillsChange({ ...EMPTY_CENTRAL_CASH_BILLS })
    onCoinsChange(0)
    onOpenChange(false)
    setCloseConfirmationOpen(false)
  }

  return (
    <>
      {showToggle && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <p className="font-bold text-slate-800">Registrar desglose de efectivo</p>
            <p className="mt-1 text-xs text-slate-500">{toggleDescription}</p>
          </div>
          <button
            aria-checked={open}
            aria-label="Registrar desglose de efectivo"
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${open ? 'bg-teal-700' : 'bg-slate-300'}`}
            role="switch"
            type="button"
            onClick={() => handleToggle(!open)}
          >
            <span className={`size-5 rounded-full bg-white shadow transition ${open ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      )}

      {visible && (
        <div>
          <p className="field-label">Desglose de efectivo</p>
          <div className="mt-2">
            <BillCounter
              coinsValue={coinsAmount}
              showTotal={false}
              value={bills}
              onCoinsChange={(value) =>
                onCoinsChange(value === '' ? 0 : Number(value))
              }
              onChange={onBillsChange}
            />
          </div>
          <p className={`mt-3 text-right text-sm font-extrabold ${cashBreakdownMatchesAmount(bills, coinsAmount, Number(amount || 0)) ? 'text-emerald-700' : 'text-amber-700'}`}>
            Total: {currencyFormatter.format(breakdownTotal)}
          </p>
        </div>
      )}

      {errorMessage && (
        <div className="alert-error mt-4" role="alert">
          <p>{errorMessage}</p>
        </div>
      )}

      <AppModal
        closeLabel="Cancelar cierre del contador"
        open={closeConfirmationOpen}
        title="¿Cerrar contador de efectivo?"
        onClose={() => setCloseConfirmationOpen(false)}
      >
        <p className="mt-5 text-sm leading-6 text-slate-600">
          Hay billetes o monedas capturados por encima de cero. Si cierras el
          contador, esos valores se eliminarán.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            className="button-secondary"
            type="button"
            onClick={() => setCloseConfirmationOpen(false)}
          >
            Cancelar
          </button>
          <button
            className="button-primary"
            type="button"
            onClick={closeAndClear}
          >
            Cerrar y limpiar
          </button>
        </div>
      </AppModal>
    </>
  )
}
