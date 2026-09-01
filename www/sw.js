/* Aura — service worker
   App shell precacheada; todo lo de red (Firebase, Google Fonts, Spotify)
   se deja pasar sin tocar, porque cachear respuestas de API rompe la app. */
const CACHE = 'aura-v4';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './js/aura-config.js', './js/aura-auth.js', './js/aura-ai.js', './js/aura-sync.js',
  './vendor/aura-firebase.js',
  './icon-192.png', './icon-512.png', './favicon-32.png',
  './icons/maskable-192.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
  './assets/aurorIA-avatar.png',
  './assets/iconstar.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si un archivo falta; así solo se pierde ese
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Nada de otro origen entra al caché: Firestore, Auth, Gemini, Spotify, Fonts.
  if (url.origin !== self.location.origin) return;

  // Navegación: red primero para no servir un index viejo tras un deploy.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return r;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Estáticos: caché primero, y se refresca en segundo plano.
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(r => {
        if (r && r.status === 200 && r.type === 'basic') {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
