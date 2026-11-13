// Service worker: permite instalar la app y abrirla aunque falle la red.
// Los datos NO se guardan aquí: van a Firebase (o al navegador en modo local).
const CACHE = 'excel-hotel-v8';
const SHELL = ['./', 'index.html', 'css/excel.css', 'js/app.js', 'js/ui.js', 'js/formulas.js', 'js/store.js', 'js/xlsxstyles.js',
  'js/firebase-config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'img/hotel.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero (siempre la última versión); si no hay conexión, usa la copia guardada.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('.xlsx')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
