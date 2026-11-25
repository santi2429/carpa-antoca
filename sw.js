// Carpa Ántoca – guarda la app en el celular para que abra sin señal.
// Archivos propios: primero internet (para recibir actualizaciones) y, si no hay, la copia guardada.
// Librerías y fuentes externas: primero la copia guardada.
const CACHE = 'carpa-v2';
const PROPIOS = ['./', './index.html', './config.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
const EXTERNOS = [
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
];
const CACHEABLES = ['unpkg.com', 'cdnjs.cloudflare.com', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(
    // cache.add rechaza respuestas «opacas» de otros sitios: por eso se descarga y se guarda con put.
    [...PROPIOS.map(u => c.add(u).catch(() => {})),
     ...EXTERNOS.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {}))]
  )).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Primero internet; si falla, la copia guardada (ignorando ?v=… en la dirección).
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  if (CACHEABLES.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); return r;
    })));
  }
  // Todo lo demás (Firebase, Google, el script de correos) va directo a internet.
});
