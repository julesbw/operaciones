import type {
  AttendanceRecord,
  Expense,
  SyncQueueItem,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'

export type SyncResult = {
  synced: number
  failed: number
  pending: number
}

type ExpenseRow = {
  id: string
  store_id: string
  business_date: string
  amount: number
  concept: string
  payment_method: Expense['paymentMethod']
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  version: number
}

type AttendanceRow = {
  id: string
  collaborator_id: string
  store_id: string
  attendance_date: string
  status: AttendanceRecord['status']
  recorded_by: string
  created_at: string
  updated_at: string
  version: number
}

function expenseToRpcArgs(expense: Expense) {
  return {
    p_id: expense.id,
    p_base_version: expense.version,
    p_store_id: expense.storeId,
    p_business_date: expense.businessDate,
    p_amount: expense.amount,
    p_concept: expense.concept,
    p_payment_method: expense.paymentMethod,
    p_notes: expense.notes ?? null,
    p_created_at: expense.createdAt,
    p_updated_at: expense.updatedAt,
    p_created_by: expense.createdBy,
  }
}

function attendanceToRpcArgs(record: AttendanceRecord) {
  return {
    p_id: record.id,
    p_base_version: record.version,
    p_collaborator_id: record.collaboratorId,
    p_store_id: record.storeId,
    p_attendance_date: record.attendanceDate,
    p_status: record.status,
    p_created_at: record.createdAt,
    p_updated_at: record.updatedAt,
    p_recorded_by: record.recordedBy,
  }
}

class SyncService {
  private running?: Promise<SyncResult>

  process(): Promise<SyncResult> {
    if (this.running) return this.running
    this.running = this.processQueue().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  countPending(): Promise<number> {
    return operationsRepository.countPendingQueue()
  }

  private async processQueue(): Promise<SyncResult> {
    const items = await operationsRepository.listPendingQueue()
    if (!supabase) {
      return { synced: 0, failed: 0, pending: items.length }
    }

    const now = new Date().toISOString()
    const dueItems = items.filter(
      (item) => !item.nextAttemptAt || item.nextAttemptAt <= now,
    )
    const results = await Promise.all(
      dueItems.map((item) => this.processItem(item)),
    )
    await this.pullRecent()

    return {
      synced: results.filter(Boolean).length,
      failed: results.filter((successful) => !successful).length,
      pending: await operationsRepository.countPendingQueue(),
    }
  }

  private async processItem(item: SyncQueueItem): Promise<boolean> {
    try {
      await operationsRepository.markEntitySyncStatus(
        item.entityType,
        item.entityId,
        'syncing',
      )
      const remoteVersion = await this.pushItem(item)
      await operationsRepository.completeQueueItem(item, remoteVersion)
      return true
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error de sincronización'
      await operationsRepository.failQueueItem(item, message)
      return false
    }
  }

  private async pullRecent(): Promise<void> {
    if (!supabase) return

    const since = new Date()
    since.setDate(since.getDate() - 45)
    const sinceDate = since.toISOString().slice(0, 10)
    const [expensesResult, attendanceResult] = await Promise.all([
      supabase
        .from('expenses')
        .select(
          'id, store_id, business_date, amount, concept, payment_method, notes, created_by, created_at, updated_at, version',
        )
        .gte('business_date', sinceDate)
        .returns<ExpenseRow[]>(),
      supabase
        .from('attendance_records')
        .select(
          'id, collaborator_id, store_id, attendance_date, status, recorded_by, created_at, updated_at, version',
        )
        .gte('attendance_date', sinceDate)
        .returns<AttendanceRow[]>(),
    ])
    if (expensesResult.error) throw expensesResult.error
    if (attendanceResult.error) throw attendanceResult.error

    await Promise.all([
      operationsRepository.saveRemoteExpenses(
        expensesResult.data.map((expense) => ({
          id: expense.id,
          storeId: expense.store_id,
          businessDate: expense.business_date,
          amount: Number(expense.amount),
          concept: expense.concept,
          paymentMethod: expense.payment_method,
          notes: expense.notes ?? undefined,
          createdBy: expense.created_by,
          createdAt: expense.created_at,
          updatedAt: expense.updated_at,
          version: expense.version,
          syncStatus: 'synced',
        })),
      ),
      operationsRepository.saveRemoteAttendance(
        attendanceResult.data.map((record) => ({
          id: record.id,
          collaboratorId: record.collaborator_id,
          storeId: record.store_id,
          attendanceDate: record.attendance_date,
          status: record.status,
          recordedBy: record.recorded_by,
          createdAt: record.created_at,
          updatedAt: record.updated_at,
          version: record.version,
          syncStatus: 'synced',
        })),
      ),
    ])
  }

  private async pushItem(item: SyncQueueItem): Promise<number> {
    if (!supabase) throw new Error('Supabase no está configurado')

    if (item.operation === 'delete') {
      throw new Error('La eliminación remota no está habilitada en el MVP')
    }

    if (item.entityType === 'expense') {
      const expense = await operationsRepository.getExpense(item.entityId)
      if (!expense) throw new Error('El gasto local ya no existe')
      const result = await supabase.rpc('sync_expense', expenseToRpcArgs(expense))
      if (result.error) throw result.error
      return result.data.version
    }

    const attendance = await operationsRepository.getAttendance(item.entityId)
    if (!attendance) throw new Error('La asistencia local ya no existe')
    const { data, error } = await supabase.rpc(
      'sync_attendance',
      attendanceToRpcArgs(attendance),
    )
    if (error) throw error
    return data.version
  }
}

export const syncService = new SyncService()
