import type {
  CentralCashBills,
  ClosingAdjustment,
  ClosingAdjustmentType,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type { CashClosingAdjustmentRow } from '../types/database'
import { connectivityService } from './connectivityService'

export type CreateClosingAdjustmentInput = {
  id: string
  cashClosingId: string
  type: ClosingAdjustmentType
  amount: number
  concept: string
  notes?: string
  bills: CentralCashBills
  coinsAmount: number
}

export type ClosingAdjustmentLockState =
  | 'adjustable'
  | 'prepared'
  | 'confirmed'
  | 'received'

export type ClosingAdjustmentErrorCode =
  | 'CLOSING_ADJUSTMENT_REQUIRES_ADMIN'
  | 'CLOSING_ADJUSTMENT_REQUIRES_ONLINE'
  | 'CLOSING_ADJUSTMENT_NOT_CLOSED'
  | 'CLOSING_ADJUSTMENT_EXPORT_PREPARED'
  | 'CLOSING_ADJUSTMENT_ALREADY_EXPORTED'
  | 'CLOSING_ADJUSTMENT_ALREADY_RECEIVED'
  | 'CLOSING_ADJUSTMENT_INVALID_AMOUNT'
  | 'CLOSING_ADJUSTMENT_INVALID_TYPE'
  | 'CLOSING_ADJUSTMENT_INVALID_CONCEPT'
  | 'CLOSING_ADJUSTMENT_INVALID_NOTES'
  | 'CLOSING_ADJUSTMENT_BILLS_MISMATCH'
  | 'CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT'
  | 'CLOSING_ADJUSTMENT_NOT_FOUND'
  | 'CLOSING_ADJUSTMENT_REQUEST_ID_CONFLICT'

const ERROR_MESSAGES: Record<ClosingAdjustmentErrorCode, string> = {
  CLOSING_ADJUSTMENT_REQUIRES_ADMIN: 'Sólo administración puede crear ajustes de Cortes.',
  CLOSING_ADJUSTMENT_REQUIRES_ONLINE: 'Crear un ajuste requiere conexión.',
  CLOSING_ADJUSTMENT_NOT_CLOSED: 'Sólo pueden ajustarse Cortes cerrados.',
  CLOSING_ADJUSTMENT_EXPORT_PREPARED: 'Este Corte pertenece a una exportación preparada. Cancela ese lote antes de realizar un ajuste.',
  CLOSING_ADJUSTMENT_ALREADY_EXPORTED: 'Este Corte ya fue exportado correctamente y no admite nuevos ajustes.',
  CLOSING_ADJUSTMENT_ALREADY_RECEIVED: 'Este Corte ya fue recibido en Caja Central y no admite nuevos ajustes.',
  CLOSING_ADJUSTMENT_INVALID_AMOUNT: 'El monto del ajuste no es válido.',
  CLOSING_ADJUSTMENT_INVALID_TYPE: 'El tipo de ajuste no es válido.',
  CLOSING_ADJUSTMENT_INVALID_CONCEPT: 'El concepto del ajuste no es válido.',
  CLOSING_ADJUSTMENT_INVALID_NOTES: 'Las notas del ajuste no son válidas.',
  CLOSING_ADJUSTMENT_BILLS_MISMATCH: 'Las denominaciones no coinciden con el monto del ajuste.',
  CLOSING_ADJUSTMENT_INVALID_PHYSICAL_RESULT: 'El ajuste produciría un resultado físico inválido.',
  CLOSING_ADJUSTMENT_NOT_FOUND: 'El Corte o el ajuste ya no existe.',
  CLOSING_ADJUSTMENT_REQUEST_ID_CONFLICT: 'La solicitud ya se utilizó para otro ajuste.',
}

export class ClosingAdjustmentDomainError extends Error {
  constructor(readonly code: ClosingAdjustmentErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'ClosingAdjustmentDomainError'
  }
}

function domainError(cause: unknown): ClosingAdjustmentDomainError | undefined {
  if (!cause || typeof cause !== 'object') return undefined
  const text = [
    'message' in cause ? cause.message : '',
    'details' in cause ? cause.details : '',
  ].join(' ')
  const code = Object.keys(ERROR_MESSAGES).find((candidate) =>
    text.includes(candidate),
  ) as ClosingAdjustmentErrorCode | undefined
  return code ? new ClosingAdjustmentDomainError(code) : undefined
}

function mapAdjustment(
  row: CashClosingAdjustmentRow,
): ClosingAdjustment {
  return {
    id: row.id,
    cashClosingId: row.cash_closing_id,
    type: row.type,
    amount: Number(row.amount),
    concept: row.concept,
    notes: row.notes ?? undefined,
    bills: {
      b1000: Number(row.bills.b1000 ?? 0),
      b500: Number(row.bills.b500 ?? 0),
      b200: Number(row.bills.b200 ?? 0),
      b100: Number(row.bills.b100 ?? 0),
      b50: Number(row.bills.b50 ?? 0),
      b20: Number(row.bills.b20 ?? 0),
    },
    coinsAmount: Number(row.coins_amount),
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

class ClosingAdjustmentService {
  async lockState(
    cashClosingId: string,
  ): Promise<ClosingAdjustmentLockState | undefined> {
    if (!supabase || !connectivityService.isNetworkAvailable()) return undefined
    const { data: receipt, error: receiptError } = await supabase
      .from('central_cash_receipts')
      .select('id')
      .eq('cash_closing_id', cashClosingId)
      .maybeSingle()
    if (receiptError) throw receiptError
    if (receipt) return 'received'

    const { data: items, error: itemError } = await supabase
      .from('export_batch_items')
      .select('batch_id')
      .eq('cash_closing_id', cashClosingId)
      .in('reservation_status', ['reserved', 'confirmed'])
    if (itemError) throw itemError
    const batchIds = (items ?? []).map((item) => item.batch_id)
    if (batchIds.length === 0) return 'adjustable'
    const { data: batches, error: batchError } = await supabase
      .from('export_batches')
      .select('status')
      .in('id', batchIds)
    if (batchError) throw batchError
    return batches?.some((batch) => batch.status === 'confirmed')
      ? 'confirmed'
      : 'prepared'
  }

  async list(cashClosingId: string): Promise<ClosingAdjustment[]> {
    const cached = () => operationsRepository.listClosingAdjustments(cashClosingId)
    if (!supabase || !connectivityService.isNetworkAvailable()) return cached()
    try {
      const { data, error } = await supabase
        .from('cash_closing_adjustments')
        .select('*')
        .eq('cash_closing_id', cashClosingId)
        .order('created_at')
      if (error) throw error
      const adjustments = data.map(mapAdjustment)
      await operationsRepository.replaceClosingAdjustments(cashClosingId, adjustments)
      return adjustments
    } catch (cause: unknown) {
      console.error('No fue posible actualizar los ajustes del Corte', cause)
      return cached()
    }
  }

  async create(input: CreateClosingAdjustmentInput): Promise<ClosingAdjustment> {
    if (!supabase || !connectivityService.isNetworkAvailable()) {
      throw new ClosingAdjustmentDomainError('CLOSING_ADJUSTMENT_REQUIRES_ONLINE')
    }
    const { data, error } = await supabase.rpc('create_cash_closing_adjustment', {
      p_id: input.id,
      p_cash_closing_id: input.cashClosingId,
      p_type: input.type,
      p_amount: input.amount,
      p_concept: input.concept.trim(),
      p_notes: input.notes?.trim() || null,
      p_bills: input.bills,
      p_coins_amount: input.coinsAmount,
    })
    if (error) throw domainError(error) ?? error
    if (!data) throw new Error('Supabase no confirmó el ajuste.')
    const adjustment = mapAdjustment(data)
    await operationsRepository.replaceClosingAdjustments(
      input.cashClosingId,
      await this.list(input.cashClosingId),
    )
    return adjustment
  }
}

export const closingAdjustmentService = new ClosingAdjustmentService()
