import type {
  AttendanceRecord,
  Expense,
  LocalAppContext,
  MerchandiseTransfer,
  OperatorSession,
  SyncQueueItem,
} from '../domain/models'
import { getEffectiveAttendanceType } from '../domain/models'
import { hasCapability } from '../domain/capabilities'
import type { ExpenseRow } from '../types/database'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import { cashClosingCacheService } from './cashClosingCacheService'
import { connectivityService } from './connectivityService'
import { mapExpenseRow } from './expenseService'
import { profileFromLocalContext } from './localContextService'
import { purchaseService } from './purchaseService'
import { operatorSessionService } from './operatorSessionService'
import {
  mapOperatorAuthorizationError,
  OperatorAuthorizationError,
} from './operatorAuthorization'
import {
  buildSyncDiagnostic,
  getSafeSyncErrorCode,
  isPaidAttendanceImmutableError,
  sanitizeSyncDiagnostic,
  sanitizeSyncErrorCode,
  toFriendlySyncMessage,
} from '../utils/syncError'

export type SyncResult = {
  synced: number
  failed: number
  pending: number
  errors?: string[]
}

export class SyncAuthenticationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncAuthenticationError'
  }
}

export function isSyncAuthenticationFailure(cause: unknown): boolean {
  if (cause instanceof SyncAuthenticationError) return true
  if (!cause || typeof cause !== 'object') return false

  const status = 'status' in cause ? cause.status : undefined
  const message = [
    'code' in cause ? cause.code : '',
    'message' in cause ? cause.message : '',
    'details' in cause ? cause.details : '',
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('es-MX')

  return (
    status === 401 ||
    message.includes('jwt') ||
    message.includes('refresh token') ||
    message.includes('refresh_token') ||
    message.includes('invalid_refresh_token') ||
    message.includes('invalid session') ||
    message.includes('auth session') ||
    message.includes('session missing')
  )
}

function authenticationFailureToThrow(cause: unknown): unknown {
  if (isSyncAuthenticationFailure(cause)) return cause
  const mapped = mapOperatorAuthorizationError(cause)
  return mapped instanceof OperatorAuthorizationError && mapped.requiresLogin
    ? mapped
    : undefined
}

type AttendanceRow = {
  id: string
  collaborator_id: string
  store_id: string
  attendance_date: string
  status: AttendanceRecord['status']
  attendance_type: AttendanceRecord['attendanceType'] | undefined
  recorded_by: string
  recorded_by_operator_account_id: string | null
  created_at: string
  updated_at: string
  version: number
}

type MerchandiseTransferRow = {
  id: string
  origin_store_id: string
  destination_store_id: string
  ticket_number: string
  amount: number
  business_date: string
  notes: string | null
  created_by: string
  created_by_operator_account_id: string | null
  created_at: string
  updated_at: string
  version: number
}

function mapAttendanceRow(record: AttendanceRow): AttendanceRecord {
  return {
    id: record.id,
    collaboratorId: record.collaborator_id,
    storeId: record.store_id,
    attendanceDate: record.attendance_date,
    status: record.status,
    attendanceType: getEffectiveAttendanceType(
      record.status,
      record.attendance_type,
    ),
    recordedBy: record.recorded_by,
    operatorAccountId: record.recorded_by_operator_account_id,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    version: record.version,
    syncStatus: 'synced',
  }
}

function isPaidAttendanceQueueItem(item: SyncQueueItem): boolean {
  return (
    item.entityType === 'attendance' &&
    isPaidAttendanceImmutableError(item)
  )
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
    p_attendance_type: record.attendanceType,
    p_created_at: record.createdAt,
    p_updated_at: record.updatedAt,
    p_recorded_by: record.recordedBy,
  }
}

function merchandiseTransferToRpcArgs(transfer: MerchandiseTransfer) {
  return {
    p_id: transfer.id,
    p_base_version: transfer.version,
    p_origin_store_id: transfer.originStoreId,
    p_destination_store_id: transfer.destinationStoreId,
    p_ticket_number: transfer.ticketNumber,
    p_amount: transfer.amount,
    p_business_date: transfer.businessDate,
    p_notes: transfer.notes ?? null,
    p_created_at: transfer.createdAt,
    p_updated_at: transfer.updatedAt,
    p_created_by: transfer.createdBy,
  }
}

export class SyncService {
  private running?: Promise<SyncResult>

  process(options: {
    forceRetry?: boolean
    operatorAccountId?: string | null
  } = {}): Promise<SyncResult> {
    if (this.running) return this.running
    this.running = this.processQueue(
      options.forceRetry === true,
      options.operatorAccountId,
    ).finally(() => {
      this.running = undefined
    })
    return this.running
  }

  countPending(): Promise<number> {
    return operationsRepository.countPendingQueue()
  }

  private async processQueue(
    forceRetry: boolean,
    operatorAccountId?: string | null,
  ): Promise<SyncResult> {
    if (!supabase) {
      const items = await operationsRepository.listPendingQueue()
      return { synced: 0, failed: 0, pending: items.length }
    }
    if (!connectivityService.isNetworkAvailable()) {
      const items = await operationsRepository.listPendingQueue()
      return { synced: 0, failed: 0, pending: items.length }
    }

    const context = await operationsRepository.getLocalAppContext()
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    if (!context || !data.session) {
      throw new SyncAuthenticationError(
        'Inicia sesión para sincronizar los cambios guardados.',
      )
    }
    if (context.userId !== data.session.user.id) {
      throw new SyncAuthenticationError(
        'La sesión actual no corresponde a los datos guardados en este dispositivo.',
      )
    }

    let operatorToken: string | null = null
    let activeOperator: OperatorSession | undefined
    let activeOperatorId: string | undefined
    const preflightErrors: string[] = []
    let preflightFailed = 0
    if (context.role !== 'admin') {
      activeOperator = operatorSessionService.getRequiredActiveSession(
        context.userId,
      )
      if (
        typeof operatorAccountId === 'string' &&
        operatorAccountId !== activeOperator.account.id
      ) {
        throw new SyncAuthenticationError(
          'La identidad operativa activa cambió antes de sincronizar.',
        )
      }
      operatorToken = activeOperator.token
      activeOperatorId = activeOperator.account.id
    }

    const items = await operationsRepository.listPendingQueue()
    const now = new Date().toISOString()
    const dueItems = forceRetry
      ? items
      : items.filter(
          (item) =>
            isPaidAttendanceQueueItem(item) ||
            !item.nextAttemptAt ||
            item.nextAttemptAt <= now,
        )
    const operatorItems = context.role === 'admin'
      ? dueItems.filter(
          (item) => !item.operatorAccountId || isPaidAttendanceQueueItem(item),
        )
      : dueItems.filter(
          (item) =>
            isPaidAttendanceQueueItem(item) ||
            item.operatorAccountId === activeOperatorId,
        )

    if (context.role !== 'admin') {
      const legacyItems = dueItems.filter(
        (item) => !item.operatorAccountId && !isPaidAttendanceQueueItem(item),
      )
      if (legacyItems.length > 0) {
        const legacyError = new OperatorAuthorizationError(
          'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED',
        ).message
        const lastAttemptAt = new Date().toISOString()
        await Promise.all(
          legacyItems.map((item) =>
            operationsRepository.failQueueItem(item, legacyError, {
              errorCode: 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED',
              diagnosticError: 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED',
              lastAttemptAt,
            }),
          ),
        )
        preflightFailed = legacyItems.length
        preflightErrors.push(legacyError)
      }
    }
    const results: Array<{ success: boolean; error?: string }> = []
    for (const item of operatorItems) {
      // La secuencia debe detenerse si una respuesta invalida la sesión.
      // oxlint-disable-next-line no-await-in-loop
      results.push(await this.processItem(item, operatorToken))
    }
    await this.pullRecent(context, operatorToken, activeOperator)

    return {
      synced: results.filter((result) => result.success).length,
      failed:
        preflightFailed + results.filter((result) => !result.success).length,
      pending: await operationsRepository.countPendingQueue(),
      errors: [
        ...preflightErrors,
        ...results.flatMap((result) =>
          result.success || !result.error ? [] : [result.error],
        ),
      ],
    }
  }

  private async processItem(
    item: SyncQueueItem,
    operatorToken: string | null,
  ): Promise<{ success: boolean; error?: string }> {
    if (isPaidAttendanceQueueItem(item)) {
      try {
        await this.reconcilePaidAttendance(item)
        return { success: true }
      } catch (error: unknown) {
        const authenticationFailure = authenticationFailureToThrow(error)
        if (authenticationFailure) throw authenticationFailure
        return this.persistPaidReconciliationFailure(item, error)
      }
    }

    try {
      await operationsRepository.markEntitySyncStatus(
        item.entityType,
        item.entityId,
        'syncing',
      )
      const remoteVersion = await this.pushItem(item, operatorToken)
      await operationsRepository.completeQueueItem(item, remoteVersion)
      return { success: true }
    } catch (error: unknown) {
      const authenticationFailure = authenticationFailureToThrow(error)
      if (authenticationFailure) throw authenticationFailure
      if (
        item.entityType === 'attendance' &&
        isPaidAttendanceImmutableError(error)
      ) {
        try {
          await this.reconcilePaidAttendance(item)
          return { success: true }
        } catch (reconciliationError: unknown) {
          const reconciliationAuthenticationFailure = authenticationFailureToThrow(
            reconciliationError,
          )
          if (reconciliationAuthenticationFailure) {
            throw reconciliationAuthenticationFailure
          }
          return this.persistPaidReconciliationFailure(
            item,
            reconciliationError,
            error,
          )
        }
      }
      return this.persistFailure(item, error)
    }
  }

  private async persistFailure(
    item: SyncQueueItem,
    error: unknown,
  ): Promise<{ success: boolean; error: string }> {
    const diagnosticError =
      error instanceof Error
        ? error.message
        : String(error)
    const mapped = mapOperatorAuthorizationError(error)
    const message =
      mapped instanceof OperatorAuthorizationError
        ? mapped.message
        : toFriendlySyncMessage(mapped)
    await operationsRepository.failQueueItem(item, message, {
      errorCode: getSafeSyncErrorCode(error),
      diagnosticError: buildSyncDiagnostic(error, diagnosticError),
      lastAttemptAt: new Date().toISOString(),
    })
    return { success: false, error: message }
  }

  private async persistPaidReconciliationFailure(
    item: SyncQueueItem,
    reconciliationError: unknown,
    originalError?: unknown,
  ): Promise<{ success: boolean; error: string }> {
    const mapped = mapOperatorAuthorizationError(reconciliationError)
    const message =
      mapped instanceof OperatorAuthorizationError
        ? mapped.message
        : toFriendlySyncMessage(mapped)
    const originalDiagnostic = originalError
      ? buildSyncDiagnostic(originalError, 'PAID_ATTENDANCE_IMMUTABLE')
      : sanitizeSyncDiagnostic(item.diagnosticError) ??
        'PAID_ATTENDANCE_IMMUTABLE'
    const recoveryDiagnostic = buildSyncDiagnostic(
      reconciliationError,
      reconciliationError instanceof Error
        ? reconciliationError.message
        : String(reconciliationError),
    )
    const errorCode =
      sanitizeSyncErrorCode(item.errorCode) ??
      (originalError ? getSafeSyncErrorCode(originalError) : '55000')
    await operationsRepository.failQueueItem(item, message, {
      errorCode,
      diagnosticError: [originalDiagnostic, recoveryDiagnostic]
        .filter((value): value is string => Boolean(value))
        .join(' · '),
      lastAttemptAt: new Date().toISOString(),
    })
    return { success: false, error: message }
  }

  private async reconcilePaidAttendance(item: SyncQueueItem): Promise<void> {
    if (!supabase) throw new Error('Supabase no está configurado')

    const { data, error } = await supabase
      .from('attendance_records')
      .select(
        'id, collaborator_id, store_id, attendance_date, status, attendance_type, recorded_by, recorded_by_operator_account_id, created_at, updated_at, version',
      )
      .eq('id', item.entityId)
      .maybeSingle<AttendanceRow>()
    if (error) throw error
    if (!data) {
      throw new Error('La asistencia remota no existe para reconciliar el cambio')
    }

    await operationsRepository.reconcileAttendanceQueueItem(
      item,
      mapAttendanceRow(data),
    )
  }

  private async pullRecent(
    context: LocalAppContext,
    operatorToken: string | null,
    activeOperator?: OperatorSession,
  ): Promise<void> {
    if (!supabase) return

    const since = new Date()
    since.setDate(since.getDate() - 45)
    const sinceDate = since.toISOString().slice(0, 10)
    const [expensesResult, attendanceResult, transfersResult] = await Promise.all([
      supabase
        .from('expenses')
        .select(
          'id, store_id, business_date, amount, concept, payment_method, funding_source, source_store_id, notes, weekly_payment_id, created_by, created_by_operator_account_id, created_at, updated_at, version',
        )
        .gte('business_date', sinceDate)
        .returns<ExpenseRow[]>(),
      supabase
        .from('attendance_records')
        .select(
          'id, collaborator_id, store_id, attendance_date, status, attendance_type, recorded_by, recorded_by_operator_account_id, created_at, updated_at, version',
        )
        .gte('attendance_date', sinceDate)
        .returns<AttendanceRow[]>(),
      supabase
        .from('merchandise_transfers')
        .select(
          'id, origin_store_id, destination_store_id, ticket_number, amount, business_date, notes, created_by, created_by_operator_account_id, created_at, updated_at, version',
        )
        .gte('business_date', sinceDate)
        .returns<MerchandiseTransferRow[]>(),
    ])
    if (expensesResult.error) throw expensesResult.error
    if (attendanceResult.error) throw attendanceResult.error
    if (transfersResult.error) throw transfersResult.error

    await Promise.all([
      operationsRepository.saveRemoteExpenses(
        expensesResult.data.map((expense) => mapExpenseRow(expense)),
      ),
      operationsRepository.saveRemoteAttendance(
        attendanceResult.data.map(mapAttendanceRow),
      ),
      operationsRepository.saveRemoteMerchandiseTransfers(
        transfersResult.data.map((transfer) => ({
          id: transfer.id,
          originStoreId: transfer.origin_store_id,
          destinationStoreId: transfer.destination_store_id,
          ticketNumber: transfer.ticket_number,
          amount: Number(transfer.amount),
          businessDate: transfer.business_date,
          notes: transfer.notes ?? undefined,
          createdBy: transfer.created_by,
          operatorAccountId: transfer.created_by_operator_account_id,
          createdAt: transfer.created_at,
          updatedAt: transfer.updated_at,
          version: transfer.version,
          syncStatus: 'synced',
        })),
      ),
    ])

    const profile = profileFromLocalContext(context)
    const identity = {
      technicalUser: profile,
      operatorSession: activeOperator,
    }
    if (hasCapability(identity, 'cashClosings')) {
      await cashClosingCacheService.refreshList({
        user: profile,
        operatorSession: activeOperator,
        operatorToken,
        storeId: activeOperator?.account.storeId,
        dateFrom: sinceDate,
      })
    }
  }

  private async pushItem(
    item: SyncQueueItem,
    operatorToken: string | null,
  ): Promise<number> {
    if (!supabase) throw new Error('Supabase no está configurado')

    if (item.operation === 'delete') {
      throw new Error('La eliminación remota no está habilitada en el MVP')
    }

    if (item.entityType === 'expense') {
      const expense = await operationsRepository.getExpense(item.entityId)
      if (!expense) throw new Error('El gasto local ya no existe')
      const result = await supabase.rpc('sync_expense', {
        ...expenseToRpcArgs(expense),
        p_operator_token: operatorToken,
      })
      if (result.error) throw result.error
      return result.data.version
    }

    if (item.entityType === 'attendance') {
      const attendance = await operationsRepository.getAttendance(item.entityId)
      if (!attendance) throw new Error('La asistencia local ya no existe')
      const { data, error } = await supabase.rpc(
        'sync_attendance',
        {
          ...attendanceToRpcArgs(attendance),
          p_operator_token: operatorToken,
        },
      )
      if (error) throw error
      return data.version
    }

    if (item.entityType === 'purchase') {
      await purchaseService.sync(item.entityId, operatorToken)
      return 0
    }

    const transfer = await operationsRepository.getMerchandiseTransfer(
      item.entityId,
    )
    if (!transfer) throw new Error('La transferencia local ya no existe')
    const { data, error } = await supabase.rpc(
      'sync_merchandise_transfer',
      {
        ...merchandiseTransferToRpcArgs(transfer),
        p_operator_token: operatorToken,
      },
    )
    if (error) throw error
    return data.version
  }
}

export const syncService = new SyncService()
