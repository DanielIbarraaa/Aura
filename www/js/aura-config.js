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
  appCheckSiteKey: "6Lf9Hq8tAAAAAO6um7gfxHvk2r1YxZizs0os-DCB",

  ai: {
    // "gemini" usa Firebase AI Logic desde el teléfono.
    // "claude" pasa por la Cloud Function, que es quien guarda la llave.
    proveedor: "gemini",
    model: "gemini-3.7-flash",   // alternativas: gemini-3.5-flash, gemini-3.5-flash-lite

    // Los modelos 3.x razonan antes de responder y ese razonamiento sale del
    // MISMO presupuesto de salida. Con 320 tokens el pensamiento se comía casi
    // todo y las respuestas salían cortadas a media frase. Por eso 1000.
    maxOutputTokens: 1000,
    temperature: 0.8
  },

  // Línea oficial de apoyo emocional (México). Verifica que siga vigente.
  crisisLine: { name: "Línea de la Vida", tel: "8009112000" }
};
