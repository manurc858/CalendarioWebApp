// Service worker de Agenda: guarda la interfaz (HTML, JS, CSS, iconos) para
// abrir al instante y sin conexión. Las llamadas a /api nunca se cachean.
const CACHE = 'agenda-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Página: primero la red (para recibir versiones nuevas); sin conexión, la copia guardada.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put('/', fresh.clone());
        return fresh;
      } catch {
        return (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Recursos con nombre único por versión (/assets/…) e iconos: primero la copia guardada.
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const fresh = await fetch(req);
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    })());
  }
});
