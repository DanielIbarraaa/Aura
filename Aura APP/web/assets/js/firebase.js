/* Inicialización compartida por registro.html, ingresar.html y panel.html */
import { FIREBASE_CONFIG, APPCHECK_SITE_KEY, SDK } from "./config.js";

const base = `https://www.gstatic.com/firebasejs/${SDK}`;

const [appMod, authMod, fsMod, acMod] = await Promise.all([
  import(`${base}/firebase-app.js`),
  import(`${base}/firebase-auth.js`),
  import(`${base}/firebase-firestore.js`),
  import(`${base}/firebase-app-check.js`)
]);

export const app = appMod.initializeApp(FIREBASE_CONFIG);

const enLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

if (APPCHECK_SITE_KEY && !APPCHECK_SITE_KEY.startsWith("REEMPLAZA")) {
  try {
    // En local, token de depuración: reCAPTCHA no valida localhost.
    if (enLocal) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    acMod.initializeAppCheck(app, {
      provider: new acMod.ReCaptchaEnterpriseProvider(APPCHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (e) { console.warn("[Aura] App Check:", e.message); }
}

export const auth = authMod.getAuth(app);
export const db = fsMod.getFirestore(app);
export const A = authMod;
export const F = fsMod;

/** Redirige a ingresar.html si no hay sesión; devuelve el user si la hay. */
export function requireAuth(redirect = "ingresar.html") {
  return new Promise((resolve) => {
    A.onAuthStateChanged(auth, (user) => {
      if (user) resolve(user);
      else location.replace(`${redirect}?volver=${encodeURIComponent(location.pathname.split("/").pop())}`);
    });
  });
}

/** Mensajes de error de Firebase Auth en español, no el código crudo. */
export function mensajeAuth(code) {
  const m = {
    "auth/invalid-email": "Ese correo no tiene un formato válido.",
    "auth/user-not-found": "No encontramos una cuenta con ese correo.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Ingresa en vez de registrarte.",
    "auth/weak-password": "La contraseña necesita al menos 6 caracteres.",
    "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
    "auth/network-request-failed": "Sin conexión. Revisa tu internet.",
    "auth/popup-closed-by-user": "Cerraste la ventana de Google antes de terminar."
  };
  return m[code] || "Algo falló. Inténtalo otra vez.";
}
