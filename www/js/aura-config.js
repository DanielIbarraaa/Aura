/* =========================================================
   AURA — Configuración compartida (app móvil)
   Copia los valores de tu proyecto en Firebase Console →
   Configuración del proyecto → Tus apps → App web.
   Este archivo es público por naturaleza: la protección real
   son las reglas de Firestore y App Check, no ocultar esto.
   ========================================================= */
window.AURA_CONFIG = {
  firebase: {
    apiKey: "AIzaSyBb5QjOR4VF57pIog_oEzthzbNid-z86uY",
    authDomain: "aura-2027.firebaseapp.com",
    projectId: "aura-2027",
    storageBucket: "aura-2027.firebasestorage.app",
    messagingSenderId: "659707329464",
    appId: "1:659707329464:web:d78844c955e790883ced4d"
  },
  // reCAPTCHA Enterprise (web) / DeviceCheck-Play Integrity (móvil)
  appCheckSiteKey: "REEMPLAZA_RECAPTCHA_SITE_KEY",

  ai: {
    model: "gemini-3.7-flash",   // alternativas: gemini-3.5-flash, gemini-3.5-flash-lite
    maxOutputTokens: 320,
    temperature: 0.8
  },

  // Línea oficial de apoyo emocional (México). Verifica que siga vigente.
  crisisLine: { name: "Línea de la Vida", tel: "8009112000" }
};
