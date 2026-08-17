import { EMPTY_CENTRAL_CASH_BILLS } from '../domain/constants'
import type {
  Bills,
  CentralCashAdjustmentInput,
  CentralCashBills,
  CentralCashMovement,
  CentralCashPendingClosing,
  CentralCashSummary,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type {
  CentralCashMovementRow,
  CentralCashPendingClosingRow,
  CentralCashSummaryResult,
} from '../types/database'
import { connectivityService } from './connectivityService'

export type CentralCashQueryResult<T> = {
  data: T
  fromCache: boolean
}

export type CentralCashDomainErrorCode =
  | 'CENTRAL_CASH_REQUIRES_ADMIN'
  | 'CENTRAL_CASH_REQUIRES_ONLINE'
  | 'CENTRAL_CASH_CLOSING_NOT_FOUND'
  | 'CENTRAL_CASH_CLOSING_NOT_CLOSED'
  | 'CENTRAL_CASH_CLOSING_ALREADY_RECEIVED'
  | 'CENTRAL_CASH_CLOSING_MISMATCH'
  | 'CENTRAL_CASH_ADJUSTMENT_MISMATCH'
  | 'CENTRAL_CASH_INSUFFICIENT_FUNDS'
  | 'CENTRAL_CASH_REQUEST_ID_CONFLICT'

const ERROR_MESSAGES: Record<CentralCashDomainErrorCode, string> = {
  CENTRAL_CASH_REQUIRES_ADMIN:
    'Sólo administración puede operar Caja Central.',
  CENTRAL_CASH_REQUIRES_ONLINE:
    'Necesitas conexión para confirmar una operación en Caja Central.',
  CENTRAL_CASH_CLOSING_NOT_FOUND: 'El Corte ya no existe.',
  CENTRAL_CASH_CLOSING_NOT_CLOSED:
    'Sólo pueden recibirse Cortes cerrados.',
  CENTRAL_CASH_CLOSING_ALREADY_RECEIVED:
    'Este Corte ya fue recibido en Caja Central.',
  CENTRAL_CASH_CLOSING_MISMATCH:
    'Las denominaciones del Corte no coinciden con el efectivo a recibir.',
  CENTRAL_CASH_ADJUSTMENT_MISMATCH:
    'Las denominaciones del ajuste no coinciden con el monto.',
  CENTRAL_CASH_INSUFFICIENT_FUNDS:
    'Caja Central no tiene saldo o denominaciones suficientes para esta salida.',
  CENTRAL_CASH_REQUEST_ID_CONFLICT:
    'La solicitud ya se utilizó para una operación diferente.',
}

export class CentralCashDomainError extends Error {
  constructor(readonly code: CentralCashDomainErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'CentralCashDomainError'
  }
}

function centralBills(value: Partial<CentralCashBills> | null): CentralCashBills {
  return {
    b1000: Number(value?.b1000 ?? 0),
    b500: Number(value?.b500 ?? 0),
    b200: Number(value?.b200 ?? 0),
    b100: Number(value?.b100 ?? 0),
    b50: Number(value?.b50 ?? 0),
    b20: Number(value?.b20 ?? 0),
  }
}

function closingBills(value: Bills): Bills {
  return {
    ...centralBills(value),
    monedas: Number(value.monedas ?? 0),
  }
}

function mapMovement(
  row: CentralCashMovementRow,
  cachedAt: string,
): CentralCashMovement {
  return {
    id: row.id,
    movementType: row.movement_type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    amount: Number(row.amount),
    businessDate: row.business_date,
    concept: row.concept,
    notes: row.notes ?? undefined,
    bills: centralBills(row.bills_snapshot),
    coinsAmount: Number(row.coins_amount),
    storeIdSnapshot: row.store_id_snapshot ?? undefined,
    storeNameSnapshot: row.store_name_snapshot ?? undefined,
    sequenceNumberSnapshot: row.sequence_number_snapshot ?? undefined,
    createdBy: row.created_by,
    createdByNameSnapshot: row.created_by_name_snapshot,
    createdAt: row.created_at,
    cachedAt,
  }
}

function mapPendingClosing(
  row: CentralCashPendingClosingRow,
  cachedAt: string,
): CentralCashPendingClosing {
  return {
    id: row.id,
    storeId: row.store_id,
    storeName: row.store_name,
    businessDate: row.business_date,
    sequenceNumber: row.sequence_number,
    cashToWithdraw: Number(row.cash_to_withdraw),
    withdrawBills: closingBills(row.withdraw_bills),
    closedAt: row.closed_at,
    cachedAt,
  }
}

function mapSummary(
  result: CentralCashSummaryResult,
  cachedAt: string,
): CentralCashSummary {
  return {
    id: 'current',
    balance: Number(result.balance),
    todayInflows: Number(result.today_inflows),
    todayOutflows: Number(result.today_outflows),
    todayNet: Number(result.today_net),
    bills: centralBills(result.bills),
    coinsAmount: Number(result.coins_amount),
    pendingClosingsCount: Number(result.pending_closings_count),
    pendingClosingsAmount: Number(result.pending_closings_amount),
    cachedAt,
  }
}

function emptySummary(): CentralCashSummary {
  return {
    id: 'current',
    balance: 0,
    todayInflows: 0,
    todayOutflows: 0,
    todayNet: 0,
    bills: { ...EMPTY_CENTRAL_CASH_BILLS },
    coinsAmount: 0,
    pendingClosingsCount: 0,
    pendingClosingsAmount: 0,
    cachedAt: new Date().toISOString(),
  }
}

function domainError(cause: unknown): CentralCashDomainError | undefined {
  if (!cause || typeof cause !== 'object') return undefined
  const text = [
    'message' in cause ? cause.message : '',
    'details' in cause ? cause.details : '',
  ].join(' ')
  const code = Object.keys(ERROR_MESSAGES).find((candidate) =>
    text.includes(candidate),
  ) as CentralCashDomainErrorCode | undefined
  return code ? new CentralCashDomainError(code) : undefined
}

function requireDefinitiveOperation(): void {
  if (!supabase || !connectivityService.isNetworkAvailable()) {
    throw new CentralCashDomainError('CENTRAL_CASH_REQUIRES_ONLINE')
  }
}

export class CentralCashService {
  async getSummary(): Promise<CentralCashQueryResult<CentralCashSummary>> {
    if (!supabase || !connectivityService.isNetworkAvailable()) {
      return {
        data: (await operationsRepository.getCentralCashSummary()) ?? emptySummary(),
        fromCache: true,
      }
    }

    try {
      const { data, error } = await supabase.rpc('get_central_cash_summary')
      if (error) throw error
      const summary = mapSummary(data, new Date().toISOString())
      await operationsRepository.saveCentralCashSummary(summary)
      return { data: summary, fromCache: false }
    } catch (cause: unknown) {
      const known = domainError(cause)
      if (known) throw known
      console.error('No fue posible actualizar el saldo de Caja Central', cause)
      return {
        data: (await operationsRepository.getCentralCashSummary()) ?? emptySummary(),
        fromCache: true,
      }
    }
  }

  async listMovements(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<CentralCashQueryResult<CentralCashMovement[]>> {
    if (!supabase || !connectivityService.isNetworkAvailable()) {
      return {
        data: await operationsRepository.listCentralCashMovements(
          storeId,
          dateFrom,
          dateTo,
        ),
        fromCache: true,
      }
    }

    try {
      let query = supabase.from('central_cash_movements').select('*')
      if (storeId) query = query.eq('store_id_snapshot', storeId)
      if (dateFrom) query = query.gte('business_date', dateFrom)
      if (dateTo) query = query.lte('business_date', dateTo)
      const { data, error } = await query
        .order('business_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      const cachedAt = new Date().toISOString()
      const movements = data.map((row) => mapMovement(row, cachedAt))
      await operationsRepository.replaceCentralCashMovementsForScope(
        movements,
        storeId,
        dateFrom,
        dateTo,
      )
      return { data: movements, fromCache: false }
    } catch (cause: unknown) {
      const known = domainError(cause)
      if (known) throw known
      console.error('No fue posible actualizar los movimientos centrales', cause)
      return {
        data: await operationsRepository.listCentralCashMovements(
          storeId,
          dateFrom,
          dateTo,
        ),
        fromCache: true,
      }
    }
  }

  async listPendingClosings(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<CentralCashQueryResult<CentralCashPendingClosing[]>> {
    if (!supabase || !connectivityService.isNetworkAvailable()) {
      return {
        data: await operationsRepository.listCentralCashPendingClosings(
          storeId,
          dateFrom,
          dateTo,
        ),
        fromCache: true,
      }
    }

    try {
      const { data, error } = await supabase.rpc(
        'list_pending_central_cash_closings',
        {
          p_store_id: storeId ?? null,
          p_date_from: dateFrom ?? null,
          p_date_to: dateTo ?? null,
        },
      )
      if (error) throw error
      const cachedAt = new Date().toISOString()
      const closings = data.map((row) => mapPendingClosing(row, cachedAt))
      await operationsRepository.replaceCentralCashPendingClosingsForScope(
        closings,
        storeId,
        dateFrom,
        dateTo,
      )
      return { data: closings, fromCache: false }
    } catch (cause: unknown) {
      const known = domainError(cause)
      if (known) throw known
      console.error('No fue posible actualizar los Cortes por recibir', cause)
      return {
        data: await operationsRepository.listCentralCashPendingClosings(
          storeId,
          dateFrom,
          dateTo,
        ),
        fromCache: true,
      }
    }
  }

  async receiveClosing(
    cashClosingId: string,
    receiptId: string,
    notes?: string,
  ): Promise<void> {
    requireDefinitiveOperation()
    const { data, error } = await supabase!.rpc(
      'receive_cash_closing_into_central_cash',
      {
        p_receipt_id: receiptId,
        p_cash_closing_id: cashClosingId,
        p_notes: notes?.trim() || null,
      },
    )
    if (error) throw domainError(error) ?? error
    if (!data) throw new Error('Supabase no confirmó la recepción del Corte.')
    const cachedAt = new Date().toISOString()
    await Promise.all([
      operationsRepository.saveCentralCashMovement(
        mapMovement(data.movement, cachedAt),
      ),
      operationsRepository.deleteCentralCashPendingClosing(cashClosingId),
    ])
    await this.refreshAfterMutation()
  }

  async createAdjustment(input: CentralCashAdjustmentInput): Promise<void> {
    requireDefinitiveOperation()
    const { data, error } = await supabase!.rpc(
      'create_central_cash_adjustment',
      {
        p_movement_id: input.id,
        p_movement_type: input.movementType,
        p_amount: input.amount,
        p_business_date: input.businessDate,
        p_concept: input.concept.trim(),
        p_notes: input.notes?.trim() || null,
        p_bills: input.bills,
        p_coins_amount: input.coinsAmount,
      },
    )
    if (error) throw domainError(error) ?? error
    if (!data) throw new Error('Supabase no confirmó el ajuste.')
    await operationsRepository.saveCentralCashMovement(
      mapMovement(data, new Date().toISOString()),
    )
    await this.refreshAfterMutation()
  }

  private async refreshAfterMutation(): Promise<void> {
    await Promise.all([
      this.getSummary(),
      this.listMovements(),
      this.listPendingClosings(),
    ])
  }
}

export const centralCashService = new CentralCashService()
