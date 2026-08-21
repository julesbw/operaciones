import type {
  MerchandiseTransfer,
  MerchandiseTransferInput,
  SyncQueueItem,
} from '../domain/models'
import { operationsRepository } from '../repositories/operationsRepository'
import { getOperationalDate } from '../utils/date'

export class TransferValidationError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join('. '))
    this.name = 'TransferValidationError'
  }
}

export function validateMerchandiseTransfer(
  input: MerchandiseTransferInput,
  today = getOperationalDate(),
): string[] {
  const messages: string[] = []
  if (!input.originStoreId) messages.push('Selecciona la tienda de origen')
  if (!input.destinationStoreId) messages.push('Selecciona la tienda de destino')
  if (
    input.originStoreId &&
    input.destinationStoreId &&
    input.originStoreId === input.destinationStoreId
  ) {
    messages.push('La tienda de destino debe ser diferente al origen')
  }
  if (!input.ticketNumber.trim()) messages.push('Escribe el número de ticket')
  if (input.ticketNumber.trim().length > 80) {
    messages.push('El número de ticket no puede exceder 80 caracteres')
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    messages.push('El monto debe ser mayor a cero')
  }
  if (!input.businessDate) {
    messages.push('Selecciona una fecha')
  } else if (input.businessDate > today) {
    messages.push('La fecha no puede ser futura')
  }
  if ((input.notes?.trim().length ?? 0) > 500) {
    messages.push('Las notas no pueden exceder 500 caracteres')
  }
  return messages
}

export function normalizeTicketNumber(ticketNumber: string): string {
  return ticketNumber.trim()
}

export function filterTransfersByTicket(
  transfers: MerchandiseTransfer[],
  search: string,
): MerchandiseTransfer[] {
  const normalizedSearch = search.trim().toLocaleLowerCase('es-MX')
  if (!normalizedSearch) return transfers
  return transfers.filter((transfer) =>
    transfer.ticketNumber
      .toLocaleLowerCase('es-MX')
      .includes(normalizedSearch),
  )
}

export function sumTransferAmounts(
  transfers: readonly MerchandiseTransfer[],
): number {
  const cents = transfers.reduce(
    (total, transfer) => total + Math.round(transfer.amount * 100),
    0,
  )
  return cents / 100
}

class TransferService {
  async create(
    input: MerchandiseTransferInput,
    userId: string,
    operatorAccountId?: string | null,
  ): Promise<MerchandiseTransfer> {
    const messages = validateMerchandiseTransfer(input)
    if (messages.length > 0) throw new TransferValidationError(messages)

    const now = new Date().toISOString()
    const transfer: MerchandiseTransfer = {
      ...input,
      id: crypto.randomUUID(),
      ticketNumber: normalizeTicketNumber(input.ticketNumber),
      amount: Math.round(input.amount * 100) / 100,
      notes: input.notes?.trim() || undefined,
      createdBy: userId,
      operatorAccountId: operatorAccountId ?? null,
      createdAt: now,
      updatedAt: now,
      version: 0,
      syncStatus: 'pending',
    }
    const queueItem: SyncQueueItem = {
      id: `merchandiseTransfer:${transfer.id}`,
      entityType: 'merchandiseTransfer',
      entityId: transfer.id,
      operation: 'insert',
      createdAt: now,
      attempts: 0,
      operatorAccountId: operatorAccountId ?? null,
    }

    await operationsRepository.saveMerchandiseTransferWithQueue(
      transfer,
      queueItem,
    )
    return transfer
  }

  list(
    originStoreId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<MerchandiseTransfer[]> {
    return operationsRepository.listMerchandiseTransfers(
      originStoreId,
      dateFrom,
      dateTo,
    )
  }

  async totalForDay(
    originStoreId: string,
    businessDate: string,
  ): Promise<number> {
    const transfers = await this.list(originStoreId, businessDate)
    return sumTransferAmounts(transfers)
  }
}

export const transferService = new TransferService()
