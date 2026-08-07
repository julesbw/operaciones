import type { Expense, ExpenseInput, SyncQueueItem } from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'

export class ExpenseValidationError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join('. '))
    this.name = 'ExpenseValidationError'
  }
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
  return messages
}

class ExpenseService {
  async create(input: ExpenseInput, userId: string): Promise<Expense> {
    const messages = validateExpense(input)
    if (messages.length > 0) throw new ExpenseValidationError(messages)

    const now = new Date().toISOString()
    const expense: Expense = {
      ...input,
      id: crypto.randomUUID(),
      amount: Math.round(input.amount * 100) / 100,
      concept: input.concept.trim(),
      notes: input.notes?.trim() || undefined,
      createdBy: userId,
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
    }

    await operationsRepository.saveExpenseWithQueue(expense, queueItem)
    return expense
  }

  list(storeId: string, businessDate?: string): Promise<Expense[]> {
    return operationsRepository.listExpenses(storeId, businessDate)
  }

  async totalForDay(storeId: string, businessDate: string): Promise<number> {
    const expenses = await this.list(storeId, businessDate)
    return expenses.reduce((total, expense) => total + expense.amount, 0)
  }
}

export const expenseService = new ExpenseService()
