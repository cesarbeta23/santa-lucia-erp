// Service worker del ERP de Santa Lucía.
//
// Guarda la app (el HTML, el JS y el CSS) para que abra rápido y sin depender de
// la red. Los datos NO se guardan: las peticiones a Supabase pasan derecho, para
// que nadie vea cifras viejas creyendo que son las de ahora. El ERP se usa en la
// oficina, así que aquí no hace falta trabajar sin señal como en Gestión de Obras.

const CACHE = 'erp-v1';
const BASICOS = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Datos y login: siempre a la red, nunca de caché.
  if (url.hostname.endsWith('supabase.co') || url.pathname.startsWith('/api/')) return;

  // Lo demás: primero la red (para tomar la versión nueva al desplegar),
  // y si no hay señal, lo que haya guardado.
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && url.origin === self.location.origin) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
  );
});
