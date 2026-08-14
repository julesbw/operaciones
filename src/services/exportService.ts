import {
  OPERATIONS_EXPORT_VERSION,
  type ExportBatch,
  type ExportCandidate,
  type OperationsExportFile,
} from '../domain/exportContract'
import { assertValidOperationsExportFile } from '../domain/exportValidation'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type {
  ExportBatchRow,
  ExportCandidateRow,
} from '../types/database'
import { getOperationalDate } from '../utils/date'
import { connectivityService } from './connectivityService'

export type ExportQueryResult<T> = {
  items: T[]
  fromCache: boolean
}

export type ExportDomainErrorCode =
  | 'EXPORT_REQUIRES_ADMIN'
  | 'EXPORT_REQUIRES_ONLINE'
  | 'EXPORT_CLOSING_NOT_FOUND'
  | 'EXPORT_CLOSING_NOT_CLOSED'
  | 'EXPORT_CLOSING_ALREADY_RESERVED'
  | 'EXPORT_CLOSING_ALREADY_EXPORTED'
  | 'EXPORT_RECONCILIATION_ERROR'
  | 'EXPORT_BILLS_MISMATCH'
  | 'EXPORT_BATCH_NOT_FOUND'
  | 'EXPORT_BATCH_ALREADY_CONFIRMED'
  | 'EXPORT_BATCH_CANCELLED'
  | 'EXPORT_BATCH_ID_CONFLICT'

const ERROR_MESSAGES: Record<ExportDomainErrorCode, string> = {
  EXPORT_REQUIRES_ADMIN: 'Sólo administración puede operar Exportación.',
  EXPORT_REQUIRES_ONLINE:
    'Se necesita conexión para preparar, confirmar o cancelar una exportación.',
  EXPORT_CLOSING_NOT_FOUND: 'Uno o más Cortes ya no existen.',
  EXPORT_CLOSING_NOT_CLOSED: 'Sólo pueden exportarse Cortes cerrados.',
  EXPORT_CLOSING_ALREADY_RESERVED:
    'Uno o más Cortes ya están reservados por otro lote.',
  EXPORT_CLOSING_ALREADY_EXPORTED:
    'Uno o más Cortes ya fueron exportados.',
  EXPORT_RECONCILIATION_ERROR:
    'Un Corte no cumple la reconciliación financiera de sus snapshots.',
  EXPORT_BILLS_MISMATCH:
    'Los billetes y monedas de un Corte no coinciden con el efectivo retirado.',
  EXPORT_BATCH_NOT_FOUND: 'El lote de exportación no existe.',
  EXPORT_BATCH_ALREADY_CONFIRMED:
    'El lote ya fue confirmado y no puede modificarse.',
  EXPORT_BATCH_CANCELLED: 'El lote fue cancelado.',
  EXPORT_BATCH_ID_CONFLICT:
    'El identificador del lote ya se utilizó con otra selección.',
}

export class ExportDomainError extends Error {
  constructor(readonly code: ExportDomainErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'ExportDomainError'
  }
}

function mapCandidate(row: ExportCandidateRow, cachedAt: string): ExportCandidate {
  return {
    id: row.id,
    storeId: row.store_id,
    storeName: row.store_name,
    businessDate: row.business_date,
    sequenceNumber: row.sequence_number,
    grossCash: Number(row.gross_cash),
    expensesTotal: Number(row.expenses_total),
    cashExpensesTotal: Number(row.cash_expenses_total),
    storeCashPaymentsTotal: Number(row.store_cash_payments_total),
    netCash: Number(row.net_cash),
    cashBalance: Number(row.cash_balance),
    physicalCashAmount: Number(row.physical_cash_amount),
    transfersTotal: Number(row.transfers_total),
    closedAt: row.closed_at,
    cachedAt,
  }
}

function mapBatch(row: ExportBatchRow): ExportBatch {
  const payload = assertValidOperationsExportFile(row.payload_snapshot)
  if (payload.lote_exportacion_id !== row.id) {
    throw new Error('El payload no corresponde al lote que lo contiene.')
  }
  return {
    id: row.id,
    contractVersion: OPERATIONS_EXPORT_VERSION,
    status: row.status,
    payloadSnapshot: payload,
    createdBy: row.created_by,
    createdAt: row.created_at,
    confirmedBy: row.confirmed_by ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
    cancelledBy: row.cancelled_by ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
  }
}

function domainError(cause: unknown): ExportDomainError | undefined {
  if (!cause || typeof cause !== 'object') return undefined
  const text = [
    'message' in cause ? cause.message : '',
    'details' in cause ? cause.details : '',
  ].join(' ')
  const code = Object.keys(ERROR_MESSAGES).find((candidate) =>
    text.includes(candidate),
  ) as ExportDomainErrorCode | undefined
  return code ? new ExportDomainError(code) : undefined
}

function requireDefinitiveOperation(): void {
  if (!supabase || !connectivityService.isNetworkAvailable()) {
    throw new ExportDomainError('EXPORT_REQUIRES_ONLINE')
  }
}

export function serializeExportFile(payload: OperationsExportFile): string {
  assertValidOperationsExportFile(payload)
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function buildExportFilename(batch: ExportBatch): string {
  const date = getOperationalDate(new Date(batch.createdAt))
  return `operaciones_${date}_${batch.id.slice(0, 8)}.json`
}

export function downloadExportFile(batch: ExportBatch): void {
  const blob = new Blob([serializeExportFile(batch.payloadSnapshot)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = buildExportFilename(batch)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

class ExportService {
  async listCandidates(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<ExportQueryResult<ExportCandidate>> {
    if (!supabase || !connectivityService.isNetworkAvailable()) {
      return {
        items: await operationsRepository.listExportCandidates(
          storeId,
          dateFrom,
          dateTo,
        ),
        fromCache: true,
      }
    }

    try {
      const { data, error } = await supabase.rpc('get_export_candidates', {
        p_store_id: storeId ?? null,
        p_date_from: dateFrom ?? null,
        p_date_to: dateTo ?? null,
      })
      if (error) throw error
      const cachedAt = new Date().toISOString()
      const candidates = data.map((row) => mapCandidate(row, cachedAt))
      await operationsRepository.replaceExportCandidatesForScope(
        candidates,
        storeId,
        dateFrom,
        dateTo,
      )
      return { items: candidates, fromCache: false }
    } catch (cause: unknown) {
      const known = domainError(cause)
      if (known) throw known
      console.error('No fue posible actualizar los Cortes exportables', cause)
      return {
        items: await operationsRepository.listExportCandidates(
          storeId,
          dateFrom,
          dateTo,
        ),
        fromCache: true,
      }
    }
  }

  async listBatches(): Promise<ExportQueryResult<ExportBatch>> {
    if (!supabase || !connectivityService.isNetworkAvailable()) {
      return {
        items: await operationsRepository.listExportBatches(),
        fromCache: true,
      }
    }

    try {
      const { data, error } = await supabase
        .from('export_batches')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      const batches = data.map(mapBatch)
      await operationsRepository.replaceExportBatches(batches)
      return { items: batches, fromCache: false }
    } catch (cause: unknown) {
      const known = domainError(cause)
      if (known) throw known
      console.error('No fue posible actualizar el historial de exportaciones', cause)
      return {
        items: await operationsRepository.listExportBatches(),
        fromCache: true,
      }
    }
  }

  async prepare(closingIds: readonly string[]): Promise<ExportBatch> {
    requireDefinitiveOperation()
    if (closingIds.length === 0) {
      throw new ExportDomainError('EXPORT_CLOSING_NOT_FOUND')
    }
    const { data, error } = await supabase!.rpc('prepare_export_batch', {
      p_batch_id: crypto.randomUUID(),
      p_closing_ids: [...closingIds],
    })
    if (error) throw domainError(error) ?? error
    if (!data) throw new ExportDomainError('EXPORT_BATCH_NOT_FOUND')
    const batch = mapBatch(data)
    await Promise.all([
      operationsRepository.saveExportBatch(batch),
      operationsRepository.deleteExportCandidates(closingIds),
    ])
    return batch
  }

  async confirm(batchId: string): Promise<ExportBatch> {
    requireDefinitiveOperation()
    const { data, error } = await supabase!.rpc('confirm_export_batch', {
      p_batch_id: batchId,
    })
    if (error) throw domainError(error) ?? error
    if (!data) throw new ExportDomainError('EXPORT_BATCH_NOT_FOUND')
    const batch = mapBatch(data)
    await operationsRepository.saveExportBatch(batch)
    return batch
  }

  async cancel(batchId: string): Promise<ExportBatch> {
    requireDefinitiveOperation()
    const { data, error } = await supabase!.rpc('cancel_export_batch', {
      p_batch_id: batchId,
    })
    if (error) throw domainError(error) ?? error
    if (!data) throw new ExportDomainError('EXPORT_BATCH_NOT_FOUND')
    const batch = mapBatch(data)
    await operationsRepository.saveExportBatch(batch)
    return batch
  }
}

export const exportService = new ExportService()
