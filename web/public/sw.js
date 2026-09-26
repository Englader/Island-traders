// Island Traders service worker: lets the installed game start without a
// network connection (games against the computer work fully offline).
// Pages are fetched network-first so a new deploy shows up at once; the
// fingerprinted assets, icons and fonts are served from the cache.
const CACHE = 'island-traders-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
// Stored files are looked up by address alone: a server's Vary header (e.g.
// Vary: Origin) must not hide them when the page asks in a slightly different way.
const LOOKUP = { ignoreVary: true };

// Everything the game needs is stored while installing, so it works offline
// after a single visit (not only from the second one). Asset bundles from
// older versions are removed at the same time.
async function precache() {
  const cache = await caches.open(CACHE);
  const home = new URL('./', self.registration.scope).href;
  const page = await fetch(home, { cache: 'no-cache' });
  if (!page.ok) return;
  const html = await page.clone().text();
  await cache.put(home, page);
  const wanted = new Set(['manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'].map((u) => new URL(u, home).href));
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(m[1].replace(/&amp;/g, '&'), home);
    if (url.origin === self.location.origin || (url.hostname === 'fonts.googleapis.com' && url.pathname.startsWith('/css'))) wanted.add(url.href);
  }
  await Promise.all(
    [...wanted].map(async (href) => {
      try {
        const res = await remember(href, await fetch(href));
        // the font stylesheet points at the font files themselves
        if (res.ok && new URL(href).hostname === 'fonts.googleapis.com') {
          const css = await res.clone().text();
          await Promise.all([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(async (f) => remember(f[1], await fetch(f[1]))));
        }
      } catch {
        // offline or blocked: this file gets stored the next time it loads
      }
    }),
  );
  for (const req of await cache.keys()) {
    const url = new URL(req.url);
    if (url.origin === self.location.origin && url.pathname.includes('/assets/') && !wanted.has(url.href)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache()
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

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
        .catch(async () => (await caches.match(request, LOOKUP)) || (await caches.match(new URL('./', self.registration.scope).href, LOOKUP)) || Response.error()),
    );
    return;
  }
  event.respondWith(caches.match(request, LOOKUP).then((hit) => hit || fetch(request).then((response) => remember(request, response))));
});
