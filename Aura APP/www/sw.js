/* Aura — service worker
   App shell precacheada; todo lo de red (Firebase, Google Fonts, Spotify)
   se deja pasar sin tocar, porque cachear respuestas de API rompe la app. */
/* SUBE ESTE NUMERO EN CADA DEPLOY QUE CAMBIE UN ARCHIVO.
   El handler de 'activate' borra todo cache cuyo nombre no sea este; si el
   nombre no cambia, el cache viejo sobrevive y el navegador sigue sirviendo
   codigo anterior aunque el deploy haya salido bien. */
const CACHE = 'aura-v24';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './js/aura-config.js', './js/aura-auth.js', './js/aura-estado.js',
  './js/aura-cripto.js', './js/aura-foto.js', './js/aura-consentimiento.js', './js/aura-perfil.js', './js/aura-voz.js', './js/aura-timbre.js', './js/aura-escucha.js', './js/aura-mascota.js', './js/aura-cielo.js', './js/aura-recordatorio.js', './js/aura-widget.js', './js/aura-ai.js', './js/aura-sync.js', './js/aura-directorio.js',
  './vendor/aura-firebase.js',
  './icon-192.png', './icon-512.png', './favicon-32.png',
  './icons/maskable-192.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
  './assets/aurorIA-avatar.webp',
  './assets/aurorIA-mascota.webp', './assets/aurorIA-parpadeo.webp',
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

  /* Codigo (JS y CSS): RED PRIMERO, con el cache solo como red de
     seguridad sin conexion.

     Antes esto era cache primero. El resultado era que tras un deploy el
     navegador servia el index.html nuevo (que si es red primero) junto al
     app.js viejo del cache: una mezcla que no existe en ningun lado y que
     rompe la app de formas dificiles de diagnosticar. El costo de ir a la
     red por un par de archivos pequenos es mucho menor que el de servir
     una version que nadie probo. */
  const esCodigo = /\.(js|css)(\?|$)/.test(url.pathname + url.search);
  if (esCodigo) {
    e.respondWith(
      fetch(req).then(r => {
        if (r && r.status === 200 && r.type === 'basic') {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Imagenes, fuentes y demas: cache primero y refresco en segundo plano.
  // Estos si se pueden servir viejos sin romper nada.
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
