const CACHE_PREFIX = 'la-piedad-operaciones-shell-'
const RELEASE_ID = '__RELEASE_ID__'
const PRECACHE_ASSETS = []
const CACHE_NAME = `${CACHE_PREFIX}${RELEASE_ID}`
const APP_SHELL = [
  '/manifest.webmanifest',
  '/favicon.ico',
  '/pwa-64x64.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/maskable-icon-512x512.png',
  '/apple-touch-icon-180x180.png',
  '/la-piedad-operaciones-ui.png',
]
const PUSH_SOURCE_APP = 'operaciones'
const PUSH_ICON = '/pwa-192x192.png'
const PUSH_BADGE = '/pwa-64x64.png'
const PUSH_TARGETS = {
  PURCHASE_CREATED: 'purchase',
  TRANSFER_CREATED: 'merchandise_transfer',
  CASH_CLOSING_CLOSED: 'cash_closing',
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function validPushPayload(value) {
  if (!value || typeof value !== 'object') return undefined
  const expectedEntityType = PUSH_TARGETS[value.eventType]
  if (
    value.sourceApp !== PUSH_SOURCE_APP ||
    !expectedEntityType ||
    value.entityType !== expectedEntityType ||
    !isUuid(value.notificationId) ||
    !isUuid(value.entityId) ||
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    value.title.length > 160 ||
    typeof value.body !== 'string' ||
    value.body.trim().length === 0 ||
    value.body.length > 500
  ) {
    return undefined
  }
  return {
    notificationId: value.notificationId,
    sourceApp: PUSH_SOURCE_APP,
    eventType: value.eventType,
    entityType: value.entityType,
    entityId: value.entityId,
    title: value.title.trim(),
    body: value.body.trim(),
  }
}

function validNotificationTarget(value) {
  if (!value || typeof value !== 'object') return undefined
  const expectedEntityType = PUSH_TARGETS[value.eventType]
  if (
    value.sourceApp !== PUSH_SOURCE_APP ||
    !expectedEntityType ||
    value.entityType !== expectedEntityType ||
    !isUuid(value.notificationId) ||
    !isUuid(value.entityId)
  ) {
    return undefined
  }
  return {
    notificationId: value.notificationId,
    sourceApp: PUSH_SOURCE_APP,
    eventType: value.eventType,
    entityType: value.entityType,
    entityId: value.entityId,
  }
}

function readPushPayload(event) {
  if (!event.data) return undefined
  try {
    return validPushPayload(JSON.parse(event.data.text()))
  } catch {
    return undefined
  }
}

function targetFromNotificationData(data) {
  return validNotificationTarget(data)
}

function notificationTargetUrl(target) {
  const url = new URL('/', self.location.origin)
  url.searchParams.set('notificationId', target.notificationId)
  url.searchParams.set('entityType', target.entityType)
  url.searchParams.set('entityId', target.entityId)
  return url.toString()
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  const indexResponse = await fetch('/index.html', { cache: 'reload' })
  if (!indexResponse.ok) {
    throw new Error('No fue posible descargar el app shell')
  }

  await cache.addAll([...APP_SHELL, ...PRECACHE_ASSETS])
  await Promise.all([
    cache.put('/', indexResponse.clone()),
    cache.put('/index.html', indexResponse),
  ])
}

async function isAppShellReady() {
  const cache = await caches.open(CACHE_NAME)
  const requiredPaths = ['/', '/index.html', ...APP_SHELL, ...PRECACHE_ASSETS]
  const cached = await Promise.all(
    requiredPaths.map((path) => cache.match(path)),
  )
  return {
    ready: cached.every(Boolean),
    releaseId: RELEASE_ID,
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'VERIFY_APP_SHELL') return
  event.waitUntil(
    isAppShellReady().then((ready) => {
      event.ports[0]?.postMessage(ready)
    }),
  )
})

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event)
  if (!payload) return

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: PUSH_ICON,
      badge: PUSH_BADGE,
      data: payload,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = targetFromNotificationData(event.notification.data)
  if (!target) return

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const currentWindow = windows.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin
        } catch {
          return false
        }
      })

      if (currentWindow) {
        await currentWindow.focus()
        currentWindow.postMessage({
          type: 'OPEN_NOTIFICATION',
          target,
        }, [])
        return
      }

      await self.clients.openWindow(notificationTargetUrl(target))
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) =>
              Promise.all([
                cache.put('/', copy.clone()),
                cache.put('/index.html', copy),
              ]),
            )
          }
          return response
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  const isShellRequest =
    url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname)
  if (!isShellRequest) return

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
