/* =========================================================
   AURA — Avisos de SOS para el especialista

   QUÉ ESTABA ROTO
   La Cloud Function alertaSos ya hacía su trabajo entero: leía los
   tokens del especialista, mandaba el multicast y limpiaba los que
   habían caducado. Pero nadie guardaba nunca un token, así que la
   función encontraba la lista vacía, escribía "sin tokens FCM" en el
   log y terminaba sin enviar nada. La alerta se guardaba en Firestore
   y ahí se quedaba.

   Eso hacía que Aura prometiera algo que no ocurría. Este archivo es
   el tramo que faltaba.

   LA RED DE RESPALDO, Y POR QUÉ NO ES OPCIONAL
   Una notificación push falla de formas que nadie ve: permiso
   denegado, token caducado, el navegador la descarta, el sistema en
   ahorro de batería, el especialista con el celular en silencio. Si la
   única señal fuera el push, cada fallo sería una alerta perdida sin
   rastro.

   Por eso el panel también escucha la colección alerts directamente.
   Las que no se han leído se muestran como un aviso persistente que no
   se va hasta que alguien las marca. El push avisa rápido; la lista
   garantiza que nada se pierda callado.

   NO ES UN SISTEMA DE URGENCIAS
   Ni con todo esto. Depende de que haya red, de que el sistema
   operativo entregue y de que alguien esté mirando. Se dice en la app,
   en el aviso de privacidad y en los términos, y se repite aquí para
   quien lea el código.
   ========================================================= */

import { db, F } from "./firebase.js";
import { FIREBASE_CONFIG, SDK, VAPID_KEY } from "./config.js";

var messaging = null;
var getTokenFn = null;
var onMessageFn = null;

/* ---------- ¿se puede siquiera? ---------- */

export function soportado() {
  return typeof Notification !== "undefined" &&
         "serviceWorker" in navigator &&
         "PushManager" in window;
}

export function configurado() {
  return !!VAPID_KEY && VAPID_KEY.indexOf("REEMPLAZA") !== 0;
}

export function permiso() {
  if (!soportado()) return "no-soportado";
  return Notification.permission;   // "default" | "granted" | "denied"
}

/* ---------- arranque perezoso del SDK de mensajería ----------
   Se carga solo cuando hace falta: el panel funciona sin avisos, y
   traer el SDK en cada carga por algo que quizá nunca se active sería
   cobrarle el peso a todos por una funcion de algunos. */
async function iniciar() {
  if (messaging) return messaging;
  if (!soportado() || !configurado()) return null;

  var base = "https://www.gstatic.com/firebasejs/" + SDK;
  var mod = await import(base + "/firebase-messaging.js");
  var appMod = await import(base + "/firebase-app.js");

  getTokenFn = mod.getToken;
  onMessageFn = mod.onMessage;
  messaging = mod.getMessaging(appMod.getApp());
  return messaging;
}

/* ---------- registro del service worker ----------
   Firebase lo busca en la raíz por nombre exacto. Se registra a mano
   para poder pasarle la registración a getToken y no depender de que
   el SDK adivine bien el alcance. */
async function registrarSW() {
  try {
    return await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  } catch (e) {
    console.warn("[Aura avisos] no se pudo registrar el service worker:", e.message);
    return null;
  }
}

/* =========================================================
   Activación
   ========================================================= */

/**
 * Pide permiso, obtiene el token y lo guarda en el perfil.
 * Devuelve { ok, motivo } — el motivo sirve para decirle a la persona
 * qué pasó, en vez de dejar un botón que no hace nada.
 */
export async function activar(uid) {
  if (!soportado())   return { ok: false, motivo: "no-soportado" };
  if (!configurado()) return { ok: false, motivo: "sin-vapid" };

  var estado = Notification.permission;
  if (estado === "default") estado = await Notification.requestPermission();
  if (estado !== "granted") return { ok: false, motivo: "denegado" };

  var m = await iniciar();
  if (!m) return { ok: false, motivo: "sdk" };

  var reg = await registrarSW();
  if (!reg) return { ok: false, motivo: "service-worker" };

  var token;
  try {
    token = await getTokenFn(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  } catch (e) {
    console.warn("[Aura avisos] getToken falló:", e.message);
    return { ok: false, motivo: "token", detalle: e.message };
  }
  if (!token) return { ok: false, motivo: "token" };

  try {
    // arrayUnion: si el especialista entra desde dos aparatos, los dos
    // reciben. La regla limita la lista a 10, que es de sobra.
    await F.updateDoc(F.doc(db, "therapists", uid), { fcmTokens: F.arrayUnion(token) });
  } catch (e) {
    console.warn("[Aura avisos] no se pudo guardar el token:", e.message);
    return { ok: false, motivo: "guardar", detalle: e.message };
  }

  escucharPrimerPlano();
  return { ok: true, token: token };
}

/** Quita el token de este aparato, sin tocar los de los demás. */
export async function desactivar(uid) {
  if (!messaging || !getTokenFn) return { ok: true };
  try {
    var reg = await navigator.serviceWorker.getRegistration("/");
    var token = await getTokenFn(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) await F.updateDoc(F.doc(db, "therapists", uid), { fcmTokens: F.arrayRemove(token) });
  } catch (e) {
    console.warn("[Aura avisos] no se pudo quitar el token:", e.message);
  }
  return { ok: true };
}

/** ¿Este aparato ya está en la lista del perfil? */
export async function activoAqui(perfil) {
  if (!perfil || !Array.isArray(perfil.fcmTokens) || !perfil.fcmTokens.length) return false;
  if (permiso() !== "granted" || !configurado()) return false;
  var m = await iniciar();
  if (!m) return false;
  try {
    var reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return false;
    var token = await getTokenFn(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    return !!token && perfil.fcmTokens.indexOf(token) !== -1;
  } catch (e) { return false; }
}

/* ---------- mensajes con el panel abierto ----------
   onBackgroundMessage del service worker NO corre si la pestaña está
   en primer plano: ahí llega por aquí. Sin esto, el especialista con
   el panel abierto —justo quien está trabajando— es el único que no
   se entera. */
var yaEscucha = false;
export function escucharPrimerPlano(alLlegar) {
  if (yaEscucha || !messaging || !onMessageFn) return;
  yaEscucha = true;
  onMessageFn(messaging, function (payload) {
    var n = payload.notification || {};
    if (typeof alLlegar === "function") alLlegar(payload);
    // Aviso del sistema aunque la pestaña esté al frente: puede estar
    // abierta en otro monitor o detrás de otra ventana.
    if (Notification.permission === "granted") {
      try {
        new Notification(n.title || "Alerta de Aura", {
          body: n.body || "Un paciente activó el botón SOS.",
          tag: "sos-" + ((payload.data || {}).patientId || "x")
        });
      } catch (e) { /* algunos navegadores solo permiten desde el SW */ }
    }
  });
}

/* =========================================================
   Red de respaldo: alertas sin leer, directo de Firestore
   ========================================================= */

/**
 * Escucha las alertas no leídas del especialista. Llama a alCambiar con
 * el arreglo cada vez que cambia. Devuelve la función para desuscribir.
 */
export function escucharAlertas(uid, alCambiar) {
  var q = F.query(
    F.collection(db, "alerts"),
    F.where("therapistUid", "==", uid),
    F.where("read", "==", false)
  );
  return F.onSnapshot(q, function (snap) {
    var lista = snap.docs.map(function (d) {
      return Object.assign({ id: d.id }, d.data());
    });
    // Más recientes primero. Se ordena aquí y no en la consulta para no
    // obligar a crear un índice compuesto por tres campos.
    lista.sort(function (a, b) {
      var ta = a.at && a.at.toMillis ? a.at.toMillis() : 0;
      var tb = b.at && b.at.toMillis ? b.at.toMillis() : 0;
      return tb - ta;
    });
    alCambiar(lista);
  }, function (e) {
    console.warn("[Aura avisos] no se pudieron leer las alertas:", e.message);
    alCambiar([]);
  });
}

/** Marca una alerta como leída. */
export async function marcarLeida(id) {
  await F.updateDoc(F.doc(db, "alerts", id), { read: true, readAt: F.serverTimestamp() });
}

/** Marca todas las de la lista. */
export async function marcarTodas(lista) {
  for (var i = 0; i < lista.length; i++) {
    try { await marcarLeida(lista[i].id); } catch (e) { /* se reintenta al recargar */ }
  }
}

export var MOTIVOS = {
  "no-soportado":   "Este navegador no puede mostrar avisos. Prueba con Chrome o Edge.",
  "sin-vapid":      "Faltan las credenciales de notificaciones del proyecto.",
  "denegado":       "Bloqueaste los avisos. Permítelos desde el candado de la barra de direcciones.",
  "sdk":            "No se pudo cargar el módulo de avisos.",
  "service-worker": "No se pudo registrar el service worker de avisos.",
  "token":          "No se pudo obtener el identificador de este aparato.",
  "guardar":        "No se pudo guardar el aviso en tu perfil."
};
