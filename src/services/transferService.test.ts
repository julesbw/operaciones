import { describe, expect, it } from 'vitest'
import type { MerchandiseTransfer } from '../domain/models'
import {
  filterTransfersByTicket,
  normalizeTicketNumber,
  sumTransferAmounts,
  validateMerchandiseTransfer,
} from './transferService'

const validInput = {
  originStoreId: 'origin-id',
  destinationStoreId: 'destination-id',
  ticketNumber: '0018452',
  amount: 2_350,
  businessDate: '2026-08-12',
  notes: '',
}

function transfer(
  ticketNumber: string,
  amount: number,
): MerchandiseTransfer {
  return {
    id: ticketNumber,
    originStoreId: 'origin-id',
    destinationStoreId: 'destination-id',
    ticketNumber,
    amount,
    businessDate: '2026-08-12',
    createdBy: 'user-id',
    createdAt: '2026-08-12T12:00:00.000Z',
    updatedAt: '2026-08-12T12:00:00.000Z',
    version: 0,
    syncStatus: 'pending',
  }
}

describe('validateMerchandiseTransfer', () => {
  it('accepts the minimum transfer data and preserves string tickets', () => {
    expect(validateMerchandiseTransfer(validInput, '2026-08-12')).toEqual([])
    expect(normalizeTicketNumber(' 0018452 ')).toBe('0018452')
  })

  it('rejects equal stores, blank tickets and non-positive amounts', () => {
    expect(
      validateMerchandiseTransfer(
        {
          ...validInput,
          destinationStoreId: validInput.originStoreId,
          ticketNumber: '  ',
          amount: 0,
        },
        '2026-08-12',
      ),
    ).toEqual([
      'La tienda de destino debe ser diferente al origen',
      'Escribe el número de ticket',
      'El monto debe ser mayor a cero',
    ])
  })

  it('rejects future business dates', () => {
    expect(
      validateMerchandiseTransfer(
        { ...validInput, businessDate: '2026-08-13' },
        '2026-08-12',
      ),
    ).toContain('La fecha no puede ser futura')
  })
})

describe('transfer summaries', () => {
  it('filters tickets without converting them to numbers', () => {
    const transfers = [transfer('0018452', 100), transfer('ABC-9', 200)]

    expect(filterTransfersByTicket(transfers, '184')).toMatchObject([
      { ticketNumber: '0018452' },
    ])
    expect(filterTransfersByTicket(transfers, 'abc')).toMatchObject([
      { ticketNumber: 'ABC-9' },
    ])
  })

  it('totals integer cents without accumulating floating-point residue', () => {
    expect(sumTransferAmounts([transfer('1', 0.1), transfer('2', 0.2)])).toBe(
      0.3,
    )
  })
})
