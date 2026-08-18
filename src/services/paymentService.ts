import {
  buildCollaboratorPaymentState,
  type CollaboratorPaymentState,
} from '../domain/paymentPolicy'
import type {
  AttendanceRecord,
  Collaborator,
  CollaboratorCompensationHistory,
  Payment,
  PaymentAttendanceItem,
  PaymentFundingSource,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type {
  AttendanceRow,
  CollaboratorCompensationHistoryRow,
  PaymentAttendanceItemRow,
  PaymentRow,
} from '../types/database'
import { getOperationalDate } from '../utils/date'
import { connectivityService } from './connectivityService'
import { syncService } from './syncService'

export type PaymentDomainErrorCode =
  | 'PAYMENT_REQUIRES_ADMIN'
  | 'PAY_CYCLE_NOT_CONFIGURED'
  | 'ATTENDANCE_ALREADY_PAID'
  | 'ATTENDANCE_NOT_PAYABLE'
  | 'FUTURE_ATTENDANCE_NOT_ALLOWED'
  | 'INVALID_PAYMENT_SOURCE'
  | 'PAYMENT_REQUIRES_ONLINE'
  | 'PAYMENT_CONFLICT'
  | 'PAID_ATTENDANCE_IMMUTABLE'

const PAYMENT_ERROR_MESSAGES: Record<PaymentDomainErrorCode, string> = {
  PAYMENT_REQUIRES_ADMIN: 'Sólo administración puede confirmar pagos.',
  PAY_CYCLE_NOT_CONFIGURED:
    'Configura el día de raya del colaborador antes de pagar.',
  ATTENDANCE_ALREADY_PAID:
    'Uno o más días ya fueron cubiertos por otro pago. Actualiza la selección.',
  ATTENDANCE_NOT_PAYABLE:
    'Uno o más días seleccionados ya no son pagables.',
  FUTURE_ATTENDANCE_NOT_ALLOWED:
    'No se pueden registrar ni pagar asistencias futuras.',
  INVALID_PAYMENT_SOURCE: 'Selecciona un origen de dinero válido.',
  PAYMENT_REQUIRES_ONLINE:
    'Se necesita conexión para confirmar el pago.',
  PAYMENT_CONFLICT:
    'El pago cambió en el servidor. Actualiza la información e intenta nuevamente.',
  PAID_ATTENDANCE_IMMUTABLE:
    'Una asistencia pagada ya no puede modificarse.',
}

export class PaymentDomainError extends Error {
  constructor(readonly code: PaymentDomainErrorCode, message?: string) {
    super(message ?? PAYMENT_ERROR_MESSAGES[code])
    this.name = 'PaymentDomainError'
  }
}

export type ConfirmPaymentInput = {
  paymentId: string
  collaboratorId: string
  attendanceIds: string[]
  paidAmount: number
  fundingSource: PaymentFundingSource
  sourceStoreId?: string
  notes?: string
}

export type ConfirmedPayment = {
  payment: Payment
  items: PaymentAttendanceItem[]
}

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    collaboratorId: row.collaborator_id,
    collaboratorNameSnapshot: row.collaborator_name_snapshot,
    collaboratorStoreIdSnapshot: row.collaborator_store_id_snapshot,
    payCycleEndWeekdaySnapshot: row.pay_cycle_end_weekday_snapshot,
    businessDate: row.business_date,
    paidAt: row.paid_at,
    paidBy: row.paid_by,
    suggestedAmount: Number(row.suggested_amount),
    paidAmount: Number(row.paid_amount),
    fundingSource: row.funding_source,
    sourceStoreId: row.source_store_id ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
  }
}

function mapPaymentItem(row: PaymentAttendanceItemRow): PaymentAttendanceItem {
  return {
    paymentId: row.payment_id,
    attendanceId: row.attendance_id,
    workDateSnapshot: row.work_date_snapshot,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    weeklyPaySnapshot: Number(row.weekly_pay_snapshot),
    dailyPaySnapshot: Number(row.daily_pay_snapshot),
    suggestedAllocation: Number(row.suggested_allocation),
    createdAt: row.created_at,
  }
}

function mapCompensationHistory(
  row: CollaboratorCompensationHistoryRow,
): CollaboratorCompensationHistory {
  return {
    id: row.id,
    collaboratorId: row.collaborator_id,
    weeklyPay: Number(row.weekly_pay),
    effectiveFrom: row.effective_from,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
  }
}

function mapAttendance(row: AttendanceRow): AttendanceRecord {
  return {
    id: row.id,
    collaboratorId: row.collaborator_id,
    storeId: row.store_id,
    attendanceDate: row.attendance_date,
    status: row.status,
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    syncStatus: 'synced',
  }
}

function paymentError(cause: unknown): Error {
  const message =
    cause && typeof cause === 'object' && 'message' in cause
      ? String(cause.message)
      : ''
  const code = Object.keys(PAYMENT_ERROR_MESSAGES).find((candidate) =>
    message.includes(candidate),
  ) as PaymentDomainErrorCode | undefined
  return code ? new PaymentDomainError(code) : cause instanceof Error ? cause : new Error(message)
}

class PaymentService {
  async refreshRemote(): Promise<void> {
    if (!supabase || !connectivityService.isNetworkAvailable()) return

    const { data, error } = await supabase.rpc('get_payment_module_data', {})
    if (error) throw paymentError(error)
    if (!data) throw new Error('Supabase no devolvió los datos de pagos')

    const payments = (data.payments ?? []).map(mapPayment)
    const items = (data.items ?? []).map(mapPaymentItem)
    const history = (data.compensation_history ?? []).map(
      mapCompensationHistory,
    )
    const attendance = (data.attendance ?? []).map(mapAttendance)

    await Promise.all([
      operationsRepository.replaceRemotePaymentData(
        payments,
        items,
        history,
      ),
      operationsRepository.saveRemoteAttendance(attendance),
    ])
  }

  async listCollaboratorStates(
    collaborators: Collaborator[],
    today = getOperationalDate(),
  ): Promise<CollaboratorPaymentState[]> {
    const [attendance, items, history] = await Promise.all([
      operationsRepository.listAttendanceForPayments(),
      operationsRepository.listPaymentAttendanceItems(),
      operationsRepository.listCompensationHistory(),
    ])
    return collaborators.map((collaborator) =>
      buildCollaboratorPaymentState({
        collaborator,
        attendance,
        paymentItems: items,
        compensationHistory: history,
        today,
      }),
    )
  }

  listHistory(): Promise<Payment[]> {
    return operationsRepository.listPayments()
  }

  async getHistoryDetail(id: string): Promise<ConfirmedPayment | undefined> {
    const [payment, items] = await Promise.all([
      operationsRepository.getPayment(id),
      operationsRepository.listPaymentAttendanceItems(id),
    ])
    return payment ? { payment, items } : undefined
  }

  async confirm(input: ConfirmPaymentInput): Promise<ConfirmedPayment> {
    try {
      connectivityService.requireOnline(
        PAYMENT_ERROR_MESSAGES.PAYMENT_REQUIRES_ONLINE,
      )
    } catch {
      throw new PaymentDomainError('PAYMENT_REQUIRES_ONLINE')
    }
    if (!supabase) throw new Error('Supabase no está configurado')
    if (!input.paymentId || !input.collaboratorId) {
      throw new PaymentDomainError('PAYMENT_CONFLICT')
    }
    if (input.attendanceIds.length === 0) {
      throw new PaymentDomainError('ATTENDANCE_NOT_PAYABLE')
    }
    if (!Number.isFinite(input.paidAmount) || input.paidAmount <= 0) {
      throw new PaymentDomainError(
        'PAYMENT_CONFLICT',
        'El monto pagado debe ser mayor que cero.',
      )
    }
    if (
      (input.fundingSource === 'store_cash' && !input.sourceStoreId) ||
      (input.fundingSource === 'central_cash' && input.sourceStoreId)
    ) {
      throw new PaymentDomainError('INVALID_PAYMENT_SOURCE')
    }

    const sync = await syncService.process()
    if (sync.failed > 0) {
      throw new PaymentDomainError(
        'PAYMENT_CONFLICT',
        'No fue posible sincronizar las asistencias antes del pago.',
      )
    }
    await this.refreshRemote()

    // Un retry cuyo primer response se perdió retorna el pago remoto ya creado.
    const existing = await operationsRepository.getPayment(input.paymentId)
    if (existing) {
      return {
        payment: existing,
        items: await operationsRepository.listPaymentAttendanceItems(
          existing.id,
        ),
      }
    }

    const collaborator = (
      await operationsRepository.listCollaborators(undefined, true)
    ).find((item) => item.id === input.collaboratorId)
    if (!collaborator) throw new PaymentDomainError('PAYMENT_CONFLICT')
    if (collaborator.payCycleEndWeekday === undefined) {
      throw new PaymentDomainError('PAY_CYCLE_NOT_CONFIGURED')
    }
    const [state] = await this.listCollaboratorStates([collaborator])
    const pendingIds = new Set(
      state?.periods.flatMap((period) =>
        period.attendance
          .filter((record) => !record.paid)
          .map((record) => record.id),
      ),
    )
    if (input.attendanceIds.some((id) => !pendingIds.has(id))) {
      throw new PaymentDomainError('PAYMENT_CONFLICT')
    }
    const selectedAttendance = await Promise.all(
      input.attendanceIds.map((id) => operationsRepository.getAttendance(id)),
    )
    if (
      selectedAttendance.some(
        (record) => !record || record.syncStatus !== 'synced',
      )
    ) {
      throw new PaymentDomainError(
        'PAYMENT_CONFLICT',
        'Sincroniza todos los días seleccionados antes de confirmar.',
      )
    }

    const { data, error } = await supabase.rpc(
      'confirm_collaborator_payment',
      {
        p_payment_id: input.paymentId,
        p_collaborator_id: input.collaboratorId,
        p_attendance_ids: input.attendanceIds,
        p_paid_amount: Math.round(input.paidAmount * 100) / 100,
        p_funding_source: input.fundingSource,
        p_source_store_id: input.sourceStoreId ?? null,
        p_notes: input.notes?.trim() || null,
      },
    )
    if (error) throw paymentError(error)
    if (!data?.payment) {
      throw new Error('Supabase no devolvió el pago confirmado')
    }

    const confirmed = {
      payment: mapPayment(data.payment),
      items: (data.items ?? []).map(mapPaymentItem),
    }
    await operationsRepository.saveConfirmedPayment(
      confirmed.payment,
      confirmed.items,
    )
    return confirmed
  }
}

export const paymentService = new PaymentService()
