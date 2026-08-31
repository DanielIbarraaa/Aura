/* =========================================================
   AURA — Configuración compartida (app móvil)
   Copia los valores de tu proyecto en Firebase Console →
   Configuración del proyecto → Tus apps → App web.
   Este archivo es público por naturaleza: la protección real
   son las reglas de Firestore y App Check, no ocultar esto.
   ========================================================= */
window.AURA_CONFIG = {
  firebase: {
    apiKey: "REEMPLAZA_API_KEY",
    authDomain: "aura-xxxxx.firebaseapp.com",
    projectId: "aura-xxxxx",
    storageBucket: "aura-xxxxx.firebasestorage.app",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:0000000000000000000000"
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
