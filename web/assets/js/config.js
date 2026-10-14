/* Configuración pública del proyecto Firebase.
   Estos valores son públicos por diseño: quien protege los datos son las
   reglas de Firestore (firestore.rules) y App Check, no esconder este archivo. */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBb5QjOR4VF57pIog_oEzthzbNid-z86uY",
  authDomain: "aura-2027.firebaseapp.com",
  projectId: "aura-2027",
  storageBucket: "aura-2027.firebasestorage.app",
  messagingSenderId: "659707329464",
  appId: "1:659707329464:web:d78844c955e790883ced4d"
};

export const APPCHECK_SITE_KEY = "6Lf9Hq8tAAAAAO6um7gfxHvk2r1YxZizs0os-DCB";
export const SDK = "12.18.0";

/* Clave publica de Web Push (VAPID). Sin ella el navegador no entrega
   notificaciones, y el boton de avisos del panel lo dice en vez de
   fallar callado.

   Se saca de: Firebase Console -> Configuracion del proyecto ->
   Cloud Messaging -> Certificados push web -> Generar par de claves.
   Es publica, como el resto de este archivo. */
export const VAPID_KEY = "BACmzyrpIc587lqf1-fkMntBc5sfzWbjSJA4UYJ-XCYn4lwwCf-1VIksNlHFnB-gQyBD-C4eKywScNYwlhu2EFo";
