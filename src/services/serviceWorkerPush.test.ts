import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const workerSource = readFileSync(
  new URL('../../public/sw.js', import.meta.url),
  'utf8',
)

const validPayload = {
  notificationId: '11111111-1111-4111-8111-111111111111',
  sourceApp: 'operaciones',
  eventType: 'PURCHASE_CREATED',
  entityType: 'purchase',
  entityId: '22222222-2222-4222-8222-222222222222',
  title: 'Compra registrada',
  body: 'Tienda Centro · $4,850',
}

function loadWorker() {
  const listeners = new Map<string, (event: any) => void>()
  const showNotification = vi.fn()
  const matchAll = vi.fn(async (): Promise<unknown[]> => [])
  const openWindow = vi.fn(async () => undefined)
  const self = {
    location: { origin: 'https://operaciones.example' },
    registration: { showNotification },
    clients: { matchAll, openWindow },
    addEventListener: (name: string, listener: (event: any) => void) => {
      listeners.set(name, listener)
    },
    skipWaiting: vi.fn(),
  }
  const context = createContext({
    self,
    URL,
    Promise,
    JSON,
    console,
    caches: {
      open: vi.fn(),
      keys: vi.fn(),
      match: vi.fn(),
    },
    fetch: vi.fn(),
  })
  new Script(workerSource).runInContext(context)
  return { listeners, showNotification, matchAll, openWindow, self }
}

describe('Operations service worker Push handlers', () => {
  it('shows valid payloads and ignores another application', async () => {
    const worker = loadWorker()
    let pushPromise: Promise<unknown> | undefined
    worker.listeners.get('push')?.({
      data: { text: () => JSON.stringify(validPayload) },
      waitUntil: (promise: Promise<unknown>) => { pushPromise = promise },
    })
    await pushPromise
    expect(worker.showNotification).toHaveBeenCalledWith(
      'Compra registrada',
      expect.objectContaining({
        body: 'Tienda Centro · $4,850',
        icon: '/pwa-192x192.png',
        badge: '/pwa-64x64.png',
      }),
    )

    const invalidWorker = loadWorker()
    invalidWorker.listeners.get('push')?.({
      data: { text: () => JSON.stringify({ ...validPayload, sourceApp: 'arrendamientos' }) },
      waitUntil: vi.fn(),
    })
    expect(invalidWorker.showNotification).not.toHaveBeenCalled()
  })

  it('focuses an existing same-origin window and sends a validated destination', async () => {
    const worker = loadWorker()
    const client = {
      url: 'https://operaciones.example/',
      focus: vi.fn(async () => undefined),
      postMessage: vi.fn(),
    }
    worker.matchAll.mockResolvedValue([client])
    let clickPromise: Promise<unknown> | undefined
    const close = vi.fn()
    worker.listeners.get('notificationclick')?.({
      notification: { data: validPayload, close },
      waitUntil: (promise: Promise<unknown>) => { clickPromise = promise },
    })
    await clickPromise
    expect(close).toHaveBeenCalledTimes(1)
    expect(client.focus).toHaveBeenCalledTimes(1)
    expect(client.postMessage).toHaveBeenCalledWith(
      {
        type: 'OPEN_NOTIFICATION',
        target: {
          notificationId: validPayload.notificationId,
          sourceApp: validPayload.sourceApp,
          eventType: validPayload.eventType,
          entityType: validPayload.entityType,
          entityId: validPayload.entityId,
        },
      },
      [],
    )
    expect(worker.openWindow).not.toHaveBeenCalled()
  })

  it('opens a validated URL when no window exists', async () => {
    const worker = loadWorker()
    let clickPromise: Promise<unknown> | undefined
    worker.listeners.get('notificationclick')?.({
      notification: { data: validPayload, close: vi.fn() },
      waitUntil: (promise: Promise<unknown>) => { clickPromise = promise },
    })
    await clickPromise
    expect(worker.openWindow).toHaveBeenCalledWith(
      'https://operaciones.example/?notificationId=11111111-1111-4111-8111-111111111111&entityType=purchase&entityId=22222222-2222-4222-8222-222222222222',
    )
  })
})
