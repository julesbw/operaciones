import type {
  Expense,
  ExpenseInput,
  SyncQueueItem,
  UserProfile,
} from '../domain/models'
import type { ExpenseRow } from '../types/database'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import { calculateCentralCashBillsTotal } from '../utils/money'
import { centralCashService } from './centralCashService'
import { connectivityService } from './connectivityService'

export class ExpenseValidationError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join('. '))
    this.name = 'ExpenseValidationError'
  }
}

export type ExpenseDomainErrorCode =
  | 'EXPENSE_REQUIRES_ADMIN'
  | 'EXPENSE_CENTRAL_CASH_REQUIRES_ONLINE'
  | 'EXPENSE_INSUFFICIENT_CENTRAL_CASH'
  | 'EXPENSE_BILLS_MISMATCH'
  | 'EXPENSE_CENTRAL_CASH_PAYMENT_METHOD'
  | 'EXPENSE_FUNDING_SOURCE_INVALID'
  | 'EXPENSE_STORE_REQUIRED'
  | 'EXPENSE_STORE_FORBIDDEN'
  | 'EXPENSE_REQUEST_ID_CONFLICT'
  | 'EXPENSE_CENTRAL_LEDGER_INCOMPLETE'

const ERROR_MESSAGES: Record<ExpenseDomainErrorCode, string> = {
  EXPENSE_REQUIRES_ADMIN:
    'Sólo administración puede registrar Gastos desde Caja Central.',
  EXPENSE_CENTRAL_CASH_REQUIRES_ONLINE:
    'Necesitas conexión para confirmar un Gasto desde Caja Central.',
  EXPENSE_INSUFFICIENT_CENTRAL_CASH:
    'Caja Central no tiene saldo o denominaciones suficientes.',
  EXPENSE_BILLS_MISMATCH:
    'Las denominaciones no coinciden con el monto del Gasto.',
  EXPENSE_CENTRAL_CASH_PAYMENT_METHOD:
    'Caja Central v1 sólo permite Gastos en efectivo.',
  EXPENSE_FUNDING_SOURCE_INVALID: 'La fuente de fondos no es válida.',
  EXPENSE_STORE_REQUIRED: 'Selecciona una tienda activa.',
  EXPENSE_STORE_FORBIDDEN: 'La tienda seleccionada no está permitida.',
  EXPENSE_REQUEST_ID_CONFLICT:
    'La solicitud ya se utilizó para un Gasto diferente.',
  EXPENSE_CENTRAL_LEDGER_INCOMPLETE:
    'El Gasto central no tiene un ledger completo; requiere revisión.',
}

export class ExpenseDomainError extends Error {
  constructor(readonly code: ExpenseDomainErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES[code])
    this.name = 'ExpenseDomainError'
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function expenseError(cause: unknown): Error {
  if (!cause || typeof cause !== 'object') {
    return new Error('No fue posible registrar el gasto.')
  }
  const text = [
    'message' in cause ? cause.message : '',
    'details' in cause ? cause.details : '',
  ].join(' ')
  const code = Object.keys(ERROR_MESSAGES).find((candidate) =>
    String(text).includes(candidate),
  ) as ExpenseDomainErrorCode | undefined
  return code
    ? new ExpenseDomainError(code)
    : cause instanceof Error
      ? cause
      : new Error(String(text))
}

function hasCentralCashBreakdown(input: ExpenseInput): boolean {
  return Boolean(input.bills) || (input.coinsAmount ?? 0) !== 0
}

function validateCentralCashBreakdown(input: ExpenseInput): string[] {
  const messages: string[] = []
  const coinsAmount = input.coinsAmount ?? 0

  if (!input.bills || !Number.isFinite(coinsAmount) || coinsAmount < 0) {
    messages.push('Captura el desglose de efectivo de Caja Central')
    return messages
  }

  const total = calculateCentralCashBillsTotal(input.bills) + coinsAmount
  if (roundMoney(total) !== roundMoney(input.amount)) {
    messages.push('Las denominaciones deben sumar exactamente el monto')
  }
  if (
    Object.values(input.bills).some(
      (count) => !Number.isInteger(count) || count < 0,
    ) ||
    roundMoney(coinsAmount) !== coinsAmount
  ) {
    messages.push('El desglose de efectivo no es válido')
  }
  return messages
}

export function validateExpense(input: ExpenseInput): string[] {
  const messages: string[] = []
  if (!input.storeId) messages.push('Selecciona una tienda')
  if (!input.businessDate) messages.push('Selecciona una fecha')
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    messages.push('El monto debe ser mayor a cero')
  }
  if (!input.concept.trim()) messages.push('Escribe el concepto del gasto')
  if (input.concept.trim().length > 160) {
    messages.push('El concepto no puede exceder 160 caracteres')
  }
  if ((input.notes?.trim().length ?? 0) > 500) {
    messages.push('Las notas no pueden exceder 500 caracteres')
  }
  if (!input.fundingSource) {
    messages.push('Selecciona una fuente de fondos')
  } else if (input.fundingSource === 'store_cash') {
    if (!input.sourceStoreId) messages.push('Selecciona la caja de tienda')
    if (hasCentralCashBreakdown(input)) {
      messages.push('El desglose sólo aplica a Gastos desde Caja Central')
    }
  } else if (input.fundingSource === 'central_cash') {
    if (input.sourceStoreId) {
      messages.push('Caja Central no puede tener una tienda fuente')
    }
    if (input.paymentMethod !== 'efectivo') {
      messages.push('Caja Central v1 sólo permite Gastos en efectivo')
    }
    messages.push(...validateCentralCashBreakdown(input))
  } else {
    messages.push('Selecciona una fuente de fondos')
  }
  return messages
}

export function mapExpenseRow(
  row: ExpenseRow,
  syncStatus: Expense['syncStatus'] = 'synced',
): Expense {
  return {
    id: row.id,
    storeId: row.store_id,
    businessDate: row.business_date,
    amount: Number(row.amount),
    concept: row.concept,
    paymentMethod: row.payment_method,
    fundingSource: row.funding_source ?? 'store_cash',
    sourceStoreId: row.source_store_id ?? undefined,
    notes: row.notes ?? undefined,
    createdBy: row.created_by,
    operatorAccountId: row.created_by_operator_account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    syncStatus,
  }
}

function centralCashRpcArgs(
  input: ExpenseInput,
  expenseId: string,
  userId: string,
  createdAt: string,
) {
  return {
    p_expense_id: expenseId,
    p_store_id: input.storeId,
    p_business_date: input.businessDate,
    p_amount: roundMoney(input.amount),
    p_concept: input.concept.trim(),
    p_payment_method: input.paymentMethod,
    p_notes: input.notes?.trim() || null,
    p_funding_source: input.fundingSource,
    p_bills: input.bills!,
    p_coins_amount: roundMoney(input.coinsAmount ?? 0),
    p_created_at: createdAt,
    p_created_by: userId,
  }
}

class ExpenseService {
  async create(
    input: ExpenseInput,
    user: UserProfile,
    operatorAccountId?: string | null,
  ): Promise<Expense> {
    const messages = validateExpense(input)
    if (messages.length > 0) throw new ExpenseValidationError(messages)

    if (input.fundingSource === 'central_cash') {
      if (user.role !== 'admin') {
        throw new ExpenseDomainError('EXPENSE_REQUIRES_ADMIN')
      }
      if (user.demo || !supabase || !connectivityService.isNetworkAvailable()) {
        throw new ExpenseDomainError('EXPENSE_CENTRAL_CASH_REQUIRES_ONLINE')
      }

      const createdAt = new Date().toISOString()
      const { data, error } = await supabase.rpc(
        'create_central_cash_expense',
        centralCashRpcArgs(
          input,
          input.requestId ?? crypto.randomUUID(),
          user.id,
          createdAt,
        ),
      )
      if (error) throw expenseError(error)
      if (!data?.expense) {
        throw new Error('Supabase no confirmó el Gasto central.')
      }

      const expense = mapExpenseRow(data.expense)
      await operationsRepository.saveRemoteExpenses([expense])
      await Promise.all([
        centralCashService.getSummary(),
        centralCashService.listMovements(),
      ])
      return expense
    }

    const now = new Date().toISOString()
    const expense: Expense = {
      id: crypto.randomUUID(),
      storeId: input.storeId,
      businessDate: input.businessDate,
      amount: roundMoney(input.amount),
      concept: input.concept.trim(),
      paymentMethod: input.paymentMethod,
      fundingSource: 'store_cash',
      sourceStoreId: input.sourceStoreId,
      notes: input.notes?.trim() || undefined,
      createdBy: user.id,
      operatorAccountId: operatorAccountId ?? null,
      createdAt: now,
      updatedAt: now,
      version: 0,
      syncStatus: 'pending',
    }
    const queueItem: SyncQueueItem = {
      id: `expense:${expense.id}`,
      entityType: 'expense',
      entityId: expense.id,
      operation: 'insert',
      createdAt: now,
      attempts: 0,
      operatorAccountId: operatorAccountId ?? null,
    }

    await operationsRepository.saveExpenseWithQueue(expense, queueItem)
    return expense
  }

  list(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<Expense[]> {
    return operationsRepository.listExpenses(storeId, dateFrom, dateTo)
  }

  async totalForDay(storeId: string, businessDate: string): Promise<number> {
    const expenses = await this.list(storeId, businessDate)
    return expenses.reduce((total, expense) => total + expense.amount, 0)
  }
}

export const expenseService = new ExpenseService()
