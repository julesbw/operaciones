const CACHE_PREFIX = 'la-piedad-operaciones-shell-'
const CACHE_NAME = `${CACHE_PREFIX}v4`
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

function assetsFromHtml(html) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith('/assets/'))
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  const indexResponse = await fetch('/index.html', { cache: 'reload' })
  if (!indexResponse.ok) {
    throw new Error('No fue posible descargar el app shell')
  }

  const html = await indexResponse.clone().text()
  const buildAssets = assetsFromHtml(html)
  await Promise.all([
    cache.put('/', indexResponse.clone()),
    cache.put('/index.html', indexResponse),
    cache.addAll([...APP_SHELL, ...buildAssets]),
  ])
}

async function isAppShellReady() {
  const cache = await caches.open(CACHE_NAME)
  const indexResponse = await cache.match('/index.html')
  if (!indexResponse) return false
  const html = await indexResponse.text()
  const requiredPaths = [...APP_SHELL, ...assetsFromHtml(html)]
  const cached = await Promise.all(
    requiredPaths.map((path) => cache.match(path)),
  )
  return cached.every(Boolean)
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
      event.ports[0]?.postMessage({ ready })
    }),
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
