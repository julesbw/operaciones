import {
  OPERATIONS_EXPORT_ORIGIN,
  OPERATIONS_EXPORT_TYPE,
  OPERATIONS_EXPORT_VERSION,
  type ExportedClosing,
  type OperationsExportFile,
} from './exportContract'

const BILL_VALUES = {
  b1000: 1000,
  b500: 500,
  b200: 200,
  b100: 100,
  b50: 50,
  b20: 20,
} as const

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function sameMoney(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function validateClosing(
  closing: ExportedClosing,
  index: number,
  movementIds: Set<string>,
): string[] {
  const errors: string[] = []
  const prefix = `Corte ${index + 1}: `
  const expenseMovements = closing.financial_movements.filter(
    (movement) => movement.source_type === 'expense',
  )
  const paymentMovements = closing.financial_movements.filter(
    (movement) => movement.source_type === 'payment',
  )
  const closingMovements = closing.financial_movements.filter(
    (movement) => movement.source_type === 'cash_closing',
  )

  for (const movement of closing.financial_movements) {
    if (movementIds.has(movement.id)) {
      errors.push(`${prefix}el movimiento ${movement.id} está duplicado.`)
    }
    movementIds.add(movement.id)
    if (!Number.isFinite(movement.monto) || movement.monto < 0) {
      errors.push(`${prefix}todos los movimientos deben tener monto no negativo.`)
    }
  }

  if (
    closingMovements.length !== 1 ||
    closingMovements[0]?.tipo !== 'entrada' ||
    !sameMoney(closingMovements[0]?.monto ?? -1, closing.gross_cash)
  ) {
    errors.push(`${prefix}debe existir una sola entrada por gross_cash.`)
  }
  if (expenseMovements.some((movement) => movement.tipo !== 'salida')) {
    errors.push(`${prefix}los gastos deben ser salidas.`)
  }
  if (paymentMovements.some((movement) => movement.tipo !== 'salida')) {
    errors.push(`${prefix}los pagos deben ser salidas.`)
  }

  const expenseMovementTotal = sum(
    expenseMovements.map((movement) => movement.monto),
  )
  const paymentMovementTotal = sum(
    paymentMovements.map((movement) => movement.monto),
  )
  if (!sameMoney(expenseMovementTotal, closing.cash_expenses_total)) {
    errors.push(`${prefix}las salidas de gastos no coinciden con cash_expenses_total.`)
  }
  if (!sameMoney(paymentMovementTotal, closing.store_cash_payments_total)) {
    errors.push(`${prefix}las salidas de pagos no coinciden con store_cash_payments_total.`)
  }
  if (
    !sameMoney(
      closing.gross_cash - expenseMovementTotal - paymentMovementTotal,
      closing.net_cash,
    )
  ) {
    errors.push(`${prefix}la reconciliación de efectivo neto no se cumple.`)
  }
  if (
    !sameMoney(
      closing.net_cash - closing.cash_balance,
      closing.physical_cash.amount,
    )
  ) {
    errors.push(`${prefix}la reconciliación de efectivo físico no se cumple.`)
  }

  const calculatedBillsTotal = Object.entries(BILL_VALUES).reduce(
    (total, [key, value]) => {
      const count = closing.physical_cash.bills[
        key as keyof typeof BILL_VALUES
      ]
      if (!Number.isInteger(count) || count < 0) {
        errors.push(`${prefix}el conteo ${key} no es válido.`)
        return total
      }
      return total + count * value
    },
    0,
  )
  if (!sameMoney(calculatedBillsTotal, closing.physical_cash.bills_total)) {
    errors.push(`${prefix}bills_total no coincide con los billetes.`)
  }
  if (
    !Number.isFinite(closing.physical_cash.coins_amount) ||
    closing.physical_cash.coins_amount < 0
  ) {
    errors.push(`${prefix}coins_amount no es válido.`)
  }
  if (
    !sameMoney(
      closing.physical_cash.bills_total + closing.physical_cash.coins_amount,
      closing.physical_cash.amount,
    ) ||
    !sameMoney(closing.physical_cash.amount, closing.physical_cash_amount)
  ) {
    errors.push(`${prefix}billetes, monedas y physical_cash.amount no coinciden.`)
  }

  const expenseItemsTotal = sum(
    closing.expense_items.map((item) => item.amount),
  )
  const cashExpenseItemsTotal = sum(
    closing.expense_items
      .filter((item) => item.affects_cash)
      .map((item) => item.amount),
  )
  const paymentItemsTotal = sum(
    closing.payment_items.map((item) => item.paid_amount),
  )
  const transferItemsTotal = sum(
    closing.transfer_items.map((item) => item.amount),
  )
  if (!sameMoney(expenseItemsTotal, closing.expenses_total)) {
    errors.push(`${prefix}los gastos históricos no coinciden con expenses_total.`)
  }
  if (!sameMoney(cashExpenseItemsTotal, closing.cash_expenses_total)) {
    errors.push(`${prefix}los gastos en efectivo históricos no coinciden.`)
  }
  if (!sameMoney(paymentItemsTotal, closing.store_cash_payments_total)) {
    errors.push(`${prefix}los pagos históricos no coinciden.`)
  }
  if (!sameMoney(transferItemsTotal, closing.transfers_total)) {
    errors.push(`${prefix}las transferencias históricas no coinciden.`)
  }

  return errors
}

export function validateOperationsExportFile(
  payload: OperationsExportFile,
): string[] {
  const errors: string[] = []
  if (payload.version !== OPERATIONS_EXPORT_VERSION) {
    errors.push('La versión del contrato no es 2.0.')
  }
  if (payload.origen !== OPERATIONS_EXPORT_ORIGIN) {
    errors.push('El origen del contrato no es operaciones_pwa.')
  }
  if (payload.tipo_exportacion !== OPERATIONS_EXPORT_TYPE) {
    errors.push('El tipo de exportación no corresponde a Cortes.')
  }
  if (!UUID_PATTERN.test(payload.lote_exportacion_id)) {
    errors.push('lote_exportacion_id no es un UUID válido.')
  }
  if (
    typeof payload.fecha_exportacion !== 'string' ||
    Number.isNaN(Date.parse(payload.fecha_exportacion))
  ) {
    errors.push('fecha_exportacion no es una fecha válida.')
  }
  if (payload.zona_horaria !== 'America/Mexico_City') {
    errors.push('La zona horaria del contrato no es válida.')
  }
  if (!Array.isArray(payload.cortes)) {
    return [...errors, 'cortes debe ser un arreglo.']
  }
  if (payload.total_cortes !== payload.cortes.length) {
    errors.push('total_cortes no coincide con la cantidad de Cortes.')
  }

  const closingIds = new Set<string>()
  const movementIds = new Set<string>()
  payload.cortes.forEach((closing, index) => {
    if (!UUID_PATTERN.test(closing.id)) {
      errors.push(`Corte ${index + 1}: id no es un UUID válido.`)
    }
    if (!UUID_PATTERN.test(closing.store_id)) {
      errors.push(`Corte ${index + 1}: store_id no es un UUID válido.`)
    }
    if (closingIds.has(closing.id)) {
      errors.push(`El Corte ${closing.id} está duplicado.`)
    }
    closingIds.add(closing.id)
    errors.push(...validateClosing(closing, index, movementIds))
  })
  return errors
}

export function assertValidOperationsExportFile(
  payload: OperationsExportFile,
): OperationsExportFile {
  const errors = validateOperationsExportFile(payload)
  if (errors.length > 0) {
    throw new Error(`El payload autoritativo no es válido: ${errors[0]}`)
  }
  return payload
}
