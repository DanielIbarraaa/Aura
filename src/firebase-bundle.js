/* Empaqueta solo lo que Aura usa del SDK de Firebase y lo expone en
   window.AuraFB, para que la app siga siendo scripts clásicos sin bundler
   en tiempo de ejecución y funcione dentro del WebView sin red.
   Regenerar con: npm run build:firebase                                */
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection,
  serverTimestamp, deleteField
} from "firebase/firestore";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";

const cfg = window.AURA_CONFIG || {};
const firebaseApp = initializeApp(cfg.firebase);

// App Check es obligatorio para Firebase AI Logic desde el cliente.
if (cfg.appCheckSiteKey && !String(cfg.appCheckSiteKey).startsWith("REEMPLAZA")) {
  try {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(cfg.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  } catch (e) {
    console.warn("[Aura] App Check no inicializado:", e.message);
  }
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
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection,
  serverTimestamp, deleteField,
  getAI, getGenerativeModel, GoogleAIBackend
};
