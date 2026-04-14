// 3C Problem Solver — Service Worker
// Handles offline caching and background sync

const CACHE_NAME = '3c-app-v1';
const OFFLINE_QUEUE_KEY = '3c-offline-queue';

// Files to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap',
];

// ── INSTALL: cache static assets ─────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http')));
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean old caches ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: serve from cache, fall back to network ─────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Let Supabase API calls go through (don't cache API)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // If offline and it's a read, return empty success
        return new Response(JSON.stringify({ data: [], error: null }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // For HTML — network first, fall back to cache
  if (event.request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For everything else — cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});

// ── BACKGROUND SYNC: flush offline queue when back online ─────
self.addEventListener('sync', event => {
  if (event.tag === '3c-sync') {
    event.waitUntil(flushOfflineQueue());
  }
});

async function flushOfflineQueue() {
  // The main app handles queue flushing via its own online listener.
  // Notify all clients that connectivity is restored.
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'ONLINE_RESTORED' }));
}

// ── MESSAGE HANDLER ───────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_VERSION') {
    event.ports[0]?.postMessage(CACHE_NAME);
  }
});
