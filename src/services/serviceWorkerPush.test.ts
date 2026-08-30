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

type WorkerOptions = {
  addAll?: (paths: string[]) => Promise<void>
  cachedPaths?: string[]
  fetch?: () => Promise<{ ok: boolean; clone: () => unknown }>
}

function loadWorker(options: WorkerOptions = {}) {
  const listeners = new Map<string, (event: any) => void>()
  const showNotification = vi.fn()
  const matchAll = vi.fn(async (): Promise<unknown[]> => [])
  const openWindow = vi.fn(async () => undefined)
  const cachedPaths = new Set(options.cachedPaths ?? [])
  const cache = {
    addAll: options.addAll ?? vi.fn(async (paths: string[]) => {
      for (const path of paths) cachedPaths.add(path)
    }),
    match: vi.fn(async (request: string) =>
      cachedPaths.has(request) ? {} : undefined,
    ),
    put: vi.fn(async (request: string) => {
      cachedPaths.add(request)
    }),
  }
  const self = {
    location: { origin: 'https://operaciones.example' },
    registration: { showNotification },
    clients: { claim: vi.fn(), matchAll, openWindow },
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
      open: vi.fn(async () => cache),
      keys: vi.fn(),
      match: vi.fn(),
    },
    fetch: options.fetch ?? vi.fn(),
  })
  new Script(workerSource).runInContext(context)
  return {
    cache,
    cachedPaths,
    listeners,
    showNotification,
    matchAll,
    openWindow,
    self,
  }
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

  it('reports the installed release and requires every precached path', async () => {
    const requiredPaths = [
      '/',
      '/index.html',
      '/manifest.webmanifest',
      '/favicon.ico',
      '/pwa-64x64.png',
      '/pwa-192x192.png',
      '/pwa-512x512.png',
      '/maskable-icon-512x512.png',
      '/apple-touch-icon-180x180.png',
      '/la-piedad-operaciones-ui.png',
    ]
    const worker = loadWorker({ cachedPaths: requiredPaths })
    const postMessage = vi.fn()
    let verifyPromise: Promise<unknown> | undefined
    worker.listeners.get('message')?.({
      data: { type: 'VERIFY_APP_SHELL' },
      ports: [{ postMessage }],
      waitUntil: (promise: Promise<unknown>) => { verifyPromise = promise },
    })
    await verifyPromise
    expect(postMessage).toHaveBeenCalledWith({
      ready: true,
      releaseId: '__RELEASE_ID__',
    })

    const incompleteWorker = loadWorker({ cachedPaths: requiredPaths.slice(1) })
    const incompletePostMessage = vi.fn()
    let incompletePromise: Promise<unknown> | undefined
    incompleteWorker.listeners.get('message')?.({
      data: { type: 'VERIFY_APP_SHELL' },
      ports: [{ postMessage: incompletePostMessage }],
      waitUntil: (promise: Promise<unknown>) => { incompletePromise = promise },
    })
    await incompletePromise
    expect(incompletePostMessage).toHaveBeenCalledWith({
      ready: false,
      releaseId: '__RELEASE_ID__',
    })
  })

  it('fails installation when one precached asset cannot be downloaded', async () => {
    const addAll = vi.fn(async () => {
      throw new Error('asset missing')
    })
    const indexResponse = {
      ok: true,
      clone: () => indexResponse,
      text: async () => '',
    }
    const worker = loadWorker({
      addAll,
      fetch: vi.fn(async () => indexResponse),
    })
    let installPromise: Promise<unknown> | undefined
    worker.listeners.get('install')?.({
      waitUntil: (promise: Promise<unknown>) => { installPromise = promise },
    })

    await expect(installPromise).rejects.toThrow('asset missing')
    expect(addAll).toHaveBeenCalledOnce()
  })
})
