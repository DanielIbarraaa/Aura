/* Empaqueta solo lo que Aura usa del SDK de Firebase y lo expone en
   window.AuraFB, para que la app siga siendo scripts clásicos sin bundler
   en tiempo de ejecución y funcione dentro del WebView sin red.
   Regenerar con: npm run build:firebase                                */
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  getAuth, initializeAuth, indexedDBLocalPersistence,
  signInAnonymously, onAuthStateChanged, signOut,
  GoogleAuthProvider, signInWithPopup, signInWithCredential, linkWithCredential,
  setPersistence, browserLocalPersistence,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile, EmailAuthProvider
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  persistentSingleTabManager, memoryLocalCache,
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection,
  query, where, orderBy, limit, onSnapshot,
  serverTimestamp, deleteField
} from "firebase/firestore";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
import { getFunctions, httpsCallable } from "firebase/functions";

const cfg = window.AURA_CONFIG || {};
const firebaseApp = initializeApp(cfg.firebase);

/* ---------- App Check ----------
   Obligatorio para Firebase AI Logic a partir del 2 de noviembre de 2026.
   Sin él, aurorIA deja de responder y cae al guion local.

   Hay tres entornos y cada uno necesita un proveedor distinto:
     - Navegador en producción  → reCAPTCHA Enterprise.
     - Navegador en desarrollo  → token de depuración; reCAPTCHA no valida
                                  localhost contra una llave de producción.
     - Dentro del APK           → Play Integrity, por el plugin nativo. En el
                                  WebView de Android el origen es
                                  capacitor://localhost, que reCAPTCHA rechaza. */
const enCapacitor = !!(typeof window !== "undefined" && window.Capacitor
                       && window.Capacitor.isNativePlatform
                       && window.Capacitor.isNativePlatform());
const enLocal = typeof location !== "undefined"
  && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

if (enCapacitor) {
  // El plugin nativo se registra solo; aquí únicamente se le pide arrancar.
  const nativo = window.Capacitor?.Plugins?.FirebaseAppCheck;
  if (nativo) {
    nativo.initialize({ provider: "playIntegrity", isTokenAutoRefreshEnabled: true })
      .catch((e) => console.warn("[Aura] App Check nativo:", e.message));
  } else {
    console.warn("[Aura] Falta @capacitor-firebase/app-check; el APK irá sin App Check.");
  }
} else if (cfg.appCheckSiteKey && !String(cfg.appCheckSiteKey).startsWith("REEMPLAZA")) {
  try {
    // En local, imprime un token de depuración en la consola. Ese token se
    // registra a mano en la consola de Firebase para poder seguir probando.
    if (enLocal) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(cfg.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  } catch (e) {
    console.warn("[Aura] App Check no inicializado:", e.message);
  }
} else {
  console.warn("[Aura] App Check SIN configurar. Obligatorio para la IA el 2 de noviembre de 2026.");
}

/* ---------- Auth dentro de la app ----------
   getAuth() arma de paso el resolvedor de ventanas emergentes, y ese
   resolvedor carga un iframe desde <proyecto>.firebaseapp.com para
   validar el dominio ANTES de emitir el primer estado de sesión.

   En iOS el WebView sirve la app desde capacitor://localhost. Ese origen
   no es https, el iframe nunca termina de cargar, y Auth se queda sin
   emitir nada: onAuthStateChanged no dispara NUNCA. No hay error ni
   rechazo, solo una espera eterna — por eso la pantalla de registro se
   quedaba cargando. En Android no se notaba porque ahí el esquema por
   omisión es https://localhost, que sí pasa como origen seguro.

   initializeAuth deja escoger las piezas: se piden las de persistencia y
   NO se pide el resolvedor. Dentro de la app no hace falta, porque el
   login por ventana emergente no existe ahí de todas formas — Google va
   por el plugin nativo o no va.

   Tiene que correr ANTES que cualquier getAuth(): el primero que llega
   fija la instancia y los getAuth() siguientes devuelven esa misma. */
if (enCapacitor) {
  try {
    initializeAuth(firebaseApp, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence]
    });
  } catch (e) {
    console.warn("[Aura] Auth dentro de la app:", e.message);
  }
}

/* ---------- La caché del expediente ----------
   El expediente sigue disponible sin señal y se sincroniza al volver.

   PERO EL GESTOR DE PESTAÑAS NO PUEDE SER EL MISMO EN TODOS LADOS.
   persistentMultipleTabManager coordina varias pestañas del navegador
   entre sí con IndexedDB y bloqueos web. Dentro de una app no hay
   pestañas que coordinar, y el WKWebView de iOS no implementa bien esos
   bloqueos: la coordinación se queda esperando a un dueño que nunca
   llega. Firestore no tira un error —se queda pendiente—, así que la
   PRIMERA escritura nunca resuelve su promesa y la pantalla se queda
   cargando para siempre. Eso es justo lo que pasaba al crear cuenta.

   Un try/catch no salva de esto: no hay excepción que atrapar, hay una
   promesa que no termina. La única salida es no pedir el gestor
   equivocado. */
try {
  initializeFirestore(firebaseApp, {
    localCache: enCapacitor
      ? persistentLocalCache({ tabManager: persistentSingleTabManager({}) })
      : persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  // Si ni la caché de una pestaña se puede abrir, se sigue en memoria:
  // se pierde el offline, no la app.
  console.warn("[Aura] persistencia offline:", e.message);
  try { initializeFirestore(firebaseApp, { localCache: memoryLocalCache() }); } catch (e2) {}
}

/** window.AuraFB.app() → la instancia ya inicializada */
export const app = () => firebaseApp;

export {
  getAuth, signInAnonymously, onAuthStateChanged, signOut,
  GoogleAuthProvider, signInWithPopup, signInWithCredential, linkWithCredential,
  setPersistence, browserLocalPersistence,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile, EmailAuthProvider,
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection,
  query, where, orderBy, limit, onSnapshot,
  serverTimestamp, deleteField,
  getAI, getGenerativeModel, GoogleAIBackend,
  getFunctions, httpsCallable
};
