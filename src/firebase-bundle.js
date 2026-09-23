/* Empaqueta solo lo que Aura usa del SDK de Firebase y lo expone en
   window.AuraFB, para que la app siga siendo scripts clásicos sin bundler
   en tiempo de ejecución y funcione dentro del WebView sin red.
   Regenerar con: npm run build:firebase                                */
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  getAuth, signInAnonymously, onAuthStateChanged, signOut,
  GoogleAuthProvider, signInWithPopup, signInWithCredential, linkWithCredential,
  setPersistence, browserLocalPersistence,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile, EmailAuthProvider
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
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

// El expediente sigue disponible sin señal y se sincroniza al volver.
try {
  initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn("[Aura] persistencia offline:", e.message);
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
