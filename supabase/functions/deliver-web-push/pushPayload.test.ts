import { describe, expect, it } from 'vitest'
import {
  buildWebPushPayload,
  type PersistedPushNotification,
} from './pushPayload'

const base: PersistedPushNotification = {
  notificationId: '11111111-1111-4111-8111-111111111111',
  sourceApp: 'operaciones',
  eventType: 'PURCHASE_CREATED',
  entityType: 'purchase',
  entityId: '22222222-2222-4222-8222-222222222222',
  title: 'Compra registrada',
}

describe('buildWebPushPayload', () => {
  it('builds the compact purchase message from persisted references', () => {
    expect(buildWebPushPayload({
      ...base,
      storeName: 'Tienda Centro',
      amount: 4850,
    })).toMatchObject({
      title: 'Compra registrada',
      body: 'Tienda Centro · $4,850',
      entityType: 'purchase',
    })
  })

  it('builds the compact transfer message', () => {
    expect(buildWebPushPayload({
      ...base,
      eventType: 'TRANSFER_CREATED',
      entityType: 'merchandise_transfer',
      originStoreName: 'Tienda A',
      destinationStoreName: 'Tienda B',
      amount: 2300,
    })).toMatchObject({
      body: 'Tienda A → Tienda B · $2,300',
      entityType: 'merchandise_transfer',
    })
  })

  it('builds the compact closing message', () => {
    expect(buildWebPushPayload({
      ...base,
      eventType: 'CASH_CLOSING_CLOSED',
      entityType: 'cash_closing',
      storeName: 'Tienda B',
      cashToWithdraw: 18750,
    })).toMatchObject({
      body: 'Tienda B · Efectivo a retirar $18,750',
      entityType: 'cash_closing',
    })
  })

  it('rejects a notification from another application', () => {
    expect(() => buildWebPushPayload({
      ...base,
      sourceApp: 'arrendamientos',
      storeName: 'Tienda Centro',
      amount: 100,
    })).toThrow('push_notification_invalid')
  })

  it('does not silently send a payload without its authoritative amount', () => {
    expect(() => buildWebPushPayload({
      ...base,
      storeName: 'Tienda Centro',
    })).toThrow('push_amount_missing')
  })

  it('builds Arrendamientos Push only from the persisted notification message', () => {
    const message = 'Local 7 · Arrendatario · $3,500 · Periodo: 09/2026 · Registró: Ana'
    expect(buildWebPushPayload({
      ...base,
      sourceApp: 'arrendamientos',
      eventType: 'PAYMENT_REGISTERED',
      entityType: 'payment',
      message,
      storeName: 'No debe consultarse',
      amount: 999,
    })).toMatchObject({
      sourceApp: 'arrendamientos',
      eventType: 'PAYMENT_REGISTERED',
      entityType: 'payment',
      body: message,
    })

    expect(buildWebPushPayload({
      ...base,
      sourceApp: 'arrendamientos',
      eventType: 'PAYMENT_REGISTERED',
      entityType: 'payment',
      message: 'x'.repeat(700),
    }).body).toHaveLength(500)
  })

  it('rejects crossed application, event and entity combinations', () => {
    expect(() => buildWebPushPayload({
      ...base,
      sourceApp: 'arrendamientos',
      eventType: 'PAYMENT_REGISTERED',
      entityType: 'purchase',
      message: 'Pago registrado',
    })).toThrow('push_notification_invalid')
    expect(() => buildWebPushPayload({
      ...base,
      sourceApp: 'operaciones',
      eventType: 'PAYMENT_REGISTERED',
      entityType: 'payment',
      message: 'Pago registrado',
    })).toThrow('push_notification_invalid')
  })
})
