// ─── Recovr Service Worker ────────────────────────────────────────────────────
// Strategy overview:
//   App shell (HTML/JS/CSS/icons) → Cache-first, fall back to network
//   /api/fos/* GET requests       → Network-first, fall back to cache
//   All other /api/* routes       → Network-only (admin panel, etc.)
//   Offline FOS mutations         → Queue in IndexedDB, replay on reconnect

const SHELL_CACHE   = 'fos-shell-v2'
const API_CACHE     = 'fos-api-v2'
const OFFLINE_QUEUE_DB = 'fos-offline-queue'
const OFFLINE_QUEUE_STORE = 'mutations'

// App shell resources to pre-cache on install
const SHELL_URLS = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
  '/favicon-96x96.png'
]

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      return Promise.allSettled(
        SHELL_URLS.map(url => cache.add(url).catch(err => console.warn('[SW] Cache add failed:', url, err)))
      )
    })
  )
  self.skipWaiting()
})

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// ── Fetch: route requests to the right strategy ───────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  const isGoogleFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
  
  // Only handle same-origin requests (except Google Fonts)
  if (url.origin !== self.location.origin && !isGoogleFont) return

  const isFosApi    = url.pathname.startsWith('/api/fos/')
  const isAdminApi  = url.pathname.startsWith('/api/') && !isFosApi
  const isNavigation = request.mode === 'navigate'

  // Admin API: always network-only
  if (isAdminApi) return

  // FOS API mutations (PUT/POST/DELETE): queue if offline
  if (isFosApi && request.method !== 'GET') {
    event.respondWith(handleFosMutation(request))
    return
  }

  // FOS API GETs: network-first with cache fallback
  if (isFosApi && request.method === 'GET') {
    event.respondWith(networkFirst(request, API_CACHE))
    return
  }

  // Navigation requests (HTML page): network-first with cache fallback
  if (isNavigation) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match('/index.html', { ignoreSearch: true }) || await caches.match('/', { ignoreSearch: true })
        if (cached) return cached
        return new Response('Offline - No cache available for this page.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        })
      })
    )
    return
  }

  // Static assets (JS, CSS, images): cache-first
  event.respondWith(cacheFirst(request, SHELL_CACHE))
})

// ── Strategy: network-first with cache fallback ───────────────────────────────
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request.clone())
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    // Return a 503 so the frontend's fetch catch block executes
    return new Response('Offline', { status: 503 })
  }
}

// ── Strategy: cache-first with network fallback ───────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request.clone())
    if (response.ok || response.status === 0) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

// ── FOS Mutation handling: queue when offline ─────────────────────────────────
async function handleFosMutation(request) {
  try {
    // Try network first
    const response = await fetch(request.clone())
    return response
  } catch {
    // We're offline — queue the mutation
    const body = await request.clone().text()
    await enqueueMutation({
      url:       request.url,
      method:    request.method,
      body,
      headers:   Object.fromEntries(request.headers.entries()),
      queuedAt:  Date.now(),
    })

    // Return an optimistic 202 so the UI can proceed
    return new Response(JSON.stringify({ _queued: true, offline: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_QUEUE_DB, 1)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

async function enqueueMutation(mutation) {
  const db = await openQueueDB()
  return new Promise((resolve, reject) => {
    const tx   = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite')
    const store = tx.objectStore(OFFLINE_QUEUE_STORE)
    const req   = store.add(mutation)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

// ── Message handler: triggered by clients when coming online ─────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SYNC_QUEUE') {
    // The client will handle syncing directly using the IndexedDB queue.
    // This message just notifies us; actual sync is done client-side.
    event.ports?.[0]?.postMessage({ type: 'SYNC_ACKNOWLEDGED' })
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
