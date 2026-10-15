/* =========================================================
   AURA — Service worker de mensajería (avisos de SOS)

   Este archivo tiene que vivir en la RAÍZ del sitio. El navegador solo
   le entrega los mensajes en segundo plano a un service worker cuyo
   alcance cubre la página, y Firebase lo busca por nombre exacto en
   /firebase-messaging-sw.js. Moverlo a assets/ lo rompe en silencio:
   no da error, simplemente no llega nada.

   Usa el SDK "compat" a propósito. Un service worker no es un módulo
   ES, así que importScripts es la única vía, y solo el build compat
   funciona por ahí.

   Este archivo NO comparte nada con sw.js de la app del paciente: son
   orígenes distintos (aura-2027.web.app y aura-2027-app.web.app).
   ========================================================= */

importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js");

/* Estos valores son públicos por diseño, igual que en config.js. Van
   repetidos porque un service worker no puede importar el módulo. */
firebase.initializeApp({
  apiKey: "AIzaSyBb5QjOR4VF57pIog_oEzthzbNid-z86uY",
  authDomain: "aura-2027.firebaseapp.com",
  projectId: "aura-2027",
  storageBucket: "aura-2027.firebasestorage.app",
  messagingSenderId: "659707329464",
  appId: "1:659707329464:web:d78844c955e790883ced4d"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var n = payload.notification || {};
  var d = payload.data || {};

  self.registration.showNotification(n.title || "Alerta de Aura", {
    body: n.body || "Un paciente activó el botón SOS.",
    icon: "/assets/img/icon-192.png",
    badge: "/assets/img/favicon-32.png",
    tag: "sos-" + (d.patientId || "x"),   // no apila diez avisos del mismo paciente
    renotify: true,
    requireInteraction: true,             // no se desvanece sola: hay que verla
    data: d
  });
});

/* Al tocar el aviso: abrir el panel, y si ya estaba abierto, enfocarlo
   en vez de abrir otra pestaña encima. */
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var destino = "/panel.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].url.indexOf("/panel") !== -1 && "focus" in lista[i]) {
          return lista[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(destino);
    })
  );
});
