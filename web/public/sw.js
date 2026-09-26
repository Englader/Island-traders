// Island Traders service worker: lets the installed game start without a
// network connection (games against the computer work fully offline).
// Pages are fetched network-first so a new deploy shows up at once; the
// fingerprinted assets, icons and fonts are served from the cache.
const CACHE = 'island-traders-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function remember(request, response) {
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => remember(request, response))
        .catch(async () => (await caches.match(request)) || (await caches.match(new URL('./', self.registration.scope).href)) || Response.error()),
    );
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => remember(request, response))));
});
