/* =========================================================
   AURA — Paciente de demostración con historial real
   Crea (o rellena) una cuenta de prueba con 21 días de datos:
   curva de ánimo con recaída y recuperación, uso de ejercicios,
   activaciones del SOS, menciones clínicas y un diario cifrado.

   No usa el Admin SDK a propósito: entra como el propio paciente,
   así que todo lo que escribe pasa por las reglas de Firestore.
   Si el script funciona, las reglas están bien.

   Uso:
     node tools/seed-demo.mjs                 # solo la cuenta y su historial
     node tools/seed-demo.mjs AUR-XXXXXX      # además la vincula a tu panel

   Se corre en la Terminal del Mac, dentro de la carpeta del proyecto.
   ========================================================= */
import { initializeApp } from "firebase/app";
import {
  getAuth, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile
} from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const crypto = webcrypto;

/* ---------- credenciales del paciente de prueba ---------- */
const CORREO = "paciente.demo@aura.mx";
const CLAVE  = "AuraDemo2026";
const NOMBRE = "Paciente de prueba";
const PIN    = "1234";                       // para abrir el diario

const codigo = (process.argv[2] || "").trim().toUpperCase() || null;

/* ---------- configuración: se lee del mismo archivo que usa la app ---------- */
const src = readFileSync(new URL("../www/js/aura-config.js", import.meta.url), "utf8");
const ventana = {};
new Function("window", src)(ventana);
const CFG = ventana.AURA_CONFIG.firebase;

const app  = initializeApp(CFG);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ---------- utilidades ---------- */
const b64 = (buf) => Buffer.from(buf).toString("base64");
const fecha = (diasAtras) => {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10);
};
const isoHora = (diasAtras, hora, min) => {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  d.setHours(hora, min, 0, 0);
  return d.toISOString();
};

/* ---------- cifrado v2, el mismo que www/js/aura-cripto.js ----------
   Si este bloque y aquel archivo se separan, el usuario demo deja de
   abrirse en la app. Cualquier cambio alla hay que reflejarlo aca. */
const ITERACIONES = 600000;
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

async function derivarKEK(codigo, sal) {
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(codigo), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: sal, iterations: ITERACIONES, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

async function envolver(dek, kek) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.wrapKey("raw", dek, kek, { name: "AES-GCM", iv });
  return { iv: b64(iv), ct: b64(ct) };
}

function codigoRecuperacion() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  let s = "", acc = 0, bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; s += ALFABETO[(acc >> bits) & 31]; }
  }
  return s.replace(/(.{4})(?=.)/g, "$1-");
}

/** Crea la boveda igual que AuraCripto.crear(). */
async function crearBoveda(codigo) {
  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const salCodigo = crypto.getRandomValues(new Uint8Array(16));
  const salRec = crypto.getRandomValues(new Uint8Array(16));
  const rec = codigoRecuperacion();
  const cripto = {
    v: 2, kdf: "PBKDF2-SHA-256", iteraciones: ITERACIONES, cifrado: "AES-256-GCM",
    salCodigo: b64(salCodigo), salRecuperacion: b64(salRec),
    dek: await envolver(dek, await derivarKEK(codigo, salCodigo)),
    dekRecuperacion: await envolver(dek, await derivarKEK(rec.replace(/-/g, ""), salRec)),
    creado: new Date().toISOString()
  };
  return { cripto, dek, recuperacion: rec };
}

async function cifrar(llave, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, llave, new TextEncoder().encode(texto));
  return { iv: b64(iv), ct: b64(ct) };
}

/* ---------- la historia de 30 días ----------
   Treinta porque es justo lo que dibujan la gráfica de la app y la
   vista larga del panel: así la curva llena el ancho completo en vez
   de dejar la mitad vacía.

   El arco: cuatro semanas de fondo, una mejora sostenida, una recaída
   hace cinco días y la recuperación. Es lo que se ve en una terapia
   real, y hace que la gráfica cuente algo en vez de ser una línea plana. */
const GUION = [
  1, 1, 2, 1, 1, 2,      // días 30 a 25: el fondo
  2, 2, 1, 2, 3, 2,      // días 24 a 19: sigue abajo, con un respiro
  3, 2, 3, 3, 4, 3,      // días 18 a 13: empieza a levantar
  4, 3, 4, 4, 3, 4,      // días 12 a 7: mejora sostenida
  2, 2, 3, 4, 4, 5       // días 6 a 1: recaída y recuperación
];

const moodLogs = GUION.map((value, i) => ({ date: fecha(GUION.length - 1 - i), value }));

const sosEvents = [
  { at: isoHora(28, 3, 20),  origen: "boton_sos" },
  { at: isoHora(26, 2, 5),   origen: "mencion_en_chat" },
  { at: isoHora(22, 1, 45),  origen: "boton_sos" },
  { at: isoHora(19, 23, 30), origen: "boton_sos" },
  { at: isoHora(16, 0, 15),  origen: "llamada_linea" },
  { at: isoHora(11, 2, 10),  origen: "boton_sos" },
  { at: isoHora(5, 22, 50),  origen: "boton_sos" },
  { at: isoHora(5, 23, 10),  origen: "llamada_linea" },
  { at: isoHora(4, 1, 35),   origen: "mencion_en_chat" }
];

const auroriaMemory = [
  { sender: "me",  text: "no puedo dormir, siento mucha ansiedad por la junta de mañana" },
  { sender: "ai",  text: "Suena a una noche pesada. ¿Quieres que hagamos una respiración juntos?" },
  { sender: "me",  text: "me da miedo que me juzguen cuando hablo en el trabajo" },
  { sender: "ai",  text: "Ese miedo al juicio es de los más comunes. ¿Qué crees que pasaría si sí te juzgaran?" },
  { sender: "me",  text: "prefiero evitar la reunión, me tiembla la voz y me da vergüenza" },
  { sender: "ai",  text: "Evitar alivia hoy y pesa mañana. ¿Probamos algo más pequeño que ir a la reunión completa?" },
  { sender: "me",  text: "hoy fui y hablé, todavía con nervios pero no me bloqueé" },
  { sender: "ai",  text: "Eso es exposición real, no un ensayo. ¿Cómo se sintió el cuerpo después?" }
];

const TERMINOS = ["ansiedad", "miedo", "nervios", "pánico", "bloqueo", "evitar", "temblor", "vergüenza", "juzgar"];
const clinicalTermFreq = {};
let clinicalTermTotal = 0;
for (const m of auroriaMemory) {
  if (m.sender !== "me") continue;
  const t = m.text.toLowerCase();
  for (const w of TERMINOS) {
    if (t.includes(w)) { clinicalTermFreq[w] = (clinicalTermFreq[w] || 0) + 1; clinicalTermTotal++; }
  }
}

const DIARIO = [
  [27, "Otra noche sin dormir. Di vueltas repasando lo que dije en la comida y cómo me habrán visto."],
  [23, "Hoy no contesté una llamada del trabajo. Me quedé viendo el teléfono hasta que dejó de sonar."],
  [18, "Fui al café y pedí en la barra sin ensayarlo antes. Suena a nada y para mí no lo fue."],
  [12, "Usé la respiración antes de entrar a clase. No se me quitó el nervio pero pude entrar."],
  [8,  "Van tres días seguidos saliendo. Todavía me cuesta pero ya no me cuesta lo mismo."],
  [5,  "Recaída. Cancelé la salida a última hora y me sentí fatal por hacerlo otra vez."],
  [3,  "Hablé con la psicóloga de lo del viernes. Dice que una recaída no borra las tres semanas."],
  [1,  "Hablé en la junta. Me temblaba la voz al principio y luego se me olvidó que me temblaba."]
];

/* ---------- métricas: exactamente lo que calcula la app ---------- */
function metricas() {
  const ultimos14 = moodLogs.slice(-14);
  const vals = ultimos14.map(m => m.value);
  const media = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varianza = vals.reduce((a, b) => a + Math.pow(b - media, 2), 0) / vals.length;
  const etiqueta = varianza < 0.6 ? "Alta / Regulación Favorable"
                 : varianza < 1.4 ? "Moderada / Fluctuación Habitual"
                 : "Baja / Alta Inestabilidad Reactiva";
  return {
    moodAvg14: Number(media.toFixed(1)),
    moodCurve: moodLogs.slice(-30),
    stabilityLabel: etiqueta,
    stabilityVariance: Number(varianza.toFixed(3)),
    clinicalTermFreq,
    clinicalTermTotal,
    breathingCycles: 34,
    tippUses: 9,
    sensoryUses: 6,
    bubblesPopped: 218,
    diaryEntryCount: DIARIO.length,
    sosEvents,
    updatedAt: new Date().toISOString()
  };
}

/* ---------- ejecución ---------- */
async function main() {
  console.log(`\n▸ Proyecto: ${CFG.projectId}\n`);

  let user;
  try {
    user = (await signInWithEmailAndPassword(auth, CORREO, CLAVE)).user;
    console.log(`✓ Cuenta existente, entrando: ${CORREO}`);
  } catch (e) {
    if (e.code !== "auth/user-not-found" && e.code !== "auth/invalid-credential") throw e;
    user = (await createUserWithEmailAndPassword(auth, CORREO, CLAVE)).user;
    await updateProfile(user, { displayName: NOMBRE });
    console.log(`✓ Cuenta creada: ${CORREO}`);
  }
  const uid = user.uid;
  console.log(`  uid: ${uid}`);

  // 1. perfil
  await setDoc(doc(db, "users", uid), {
    nombre: NOMBRE, email: CORREO, anonimo: false,
    proveedor: "password", ultimoAcceso: serverTimestamp()
  }, { merge: true });
  console.log("✓ Perfil escrito en users/");

  // 2. diario cifrado de verdad, con el mismo esquema que la app
  const boveda = await crearBoveda(PIN);
  const llave = boveda.dek;
  const diaryEntries = [];
  for (const [dias, texto] of DIARIO) {
    const { iv, ct } = await cifrar(llave, texto);
    diaryEntries.push({ id: Math.random().toString(36).slice(2, 10), date: fecha(dias), iv, ct });
  }
  console.log(`✓ Diario cifrado AES-256-GCM / PBKDF2 600k: ${diaryEntries.length} entradas (código ${PIN})`);
  console.log(`  código de recuperación del demo: ${boveda.recuperacion}`);

  // 3. estado de la app (lo que ve el propio paciente)
  //    Va ANTES del vínculo a propósito: si el código está mal, el paciente
  //    igual queda sembrado y solo hay que volver a correr el script con el
  //    código bueno, en vez de perder todo el historial.
  await setDoc(doc(db, "users", uid, "privado", "estado"), {
    name: NOMBRE, email: CORREO, phone: "", birth: "",
    theme: "light", moodLogs,
    breathingCycles: 34, bubblesPopped: 218, tippUses: 9, sensoryUses: 6,
    sosEvents, aiConsent: true, patientId: uid,
    actualizado: serverTimestamp()
  }, { merge: true });

  // La conversacion de aurorIA tambien va cifrada: es el punto entero
  // del esquema v2. En claro no sale nada de texto al servidor.
  const auroriaCifrada = await cifrar(llave, JSON.stringify(auroriaMemory));

  await setDoc(doc(db, "users", uid, "privado", "diario"), {
    cripto: boveda.cripto, diaryEntries, auroriaCifrada,
    actualizado: serverTimestamp()
  }, { merge: true });
  console.log(`✓ Historial del paciente: ${moodLogs.length} días de ánimo, ${sosEvents.length} eventos SOS`);

  // 4. vínculo con el terapeuta, si se pasó un código
  const m = metricas();
  if (!codigo) {
    console.log("\n⚠ No pasaste código, así que el panel todavía no lo verá.");
    console.log("  Tu código está arriba en el panel, junto a tu nombre. Vuelve a correr:");
    console.log("  node tools/seed-demo.mjs TU-CODIGO\n");
  } else {
    const snap = await getDoc(doc(db, "codes", codigo));
    if (!snap.exists()) {
      throw new Error(
        `El código ${codigo} no existe.\n` +
        `  Si escribiste AUR-XXXXXX tal cual, eso era un ejemplo: usa el tuyo,\n` +
        `  el que aparece arriba en tu panel junto a tu nombre.\n` +
        `  El historial del paciente YA quedó guardado; solo falta vincularlo.`);
    }
    const d = snap.data();
    if (d.active === false) throw new Error(`El código ${codigo} está inactivo.`);

    await setDoc(doc(db, "patients", uid), {
      therapistUid: d.therapistUid, code: codigo, alias: null,
      linkedAt: serverTimestamp(), lastSeen: serverTimestamp()
    }, { merge: true });

    await setDoc(doc(db, "users", uid, "privado", "estado"), {
      linkedTherapist: { code: codigo, name: d.name || "Especialista", therapistUid: d.therapistUid }
    }, { merge: true });
    console.log(`✓ Vinculado al especialista con el código ${codigo}`);

    // 5. métricas para el panel
    await setDoc(doc(db, "patients", uid, "metrics", "current"),
      Object.assign({}, m, { reason: "semilla", syncedAt: serverTimestamp() }), { merge: true });
    console.log("✓ Métricas publicadas al expediente del especialista");
  }

  console.log(`
──────────────────────────────────────────────
  Entra con:      ${CORREO}
  Contraseña:     ${CLAVE}
  PIN del diario: ${PIN}

  Días de ánimo:            ${moodLogs.length} (llena la gráfica completa)
  Ánimo promedio (14 días): ${m.moodAvg14} / 5
  Estabilidad:              ${m.stabilityLabel} (varianza ${m.stabilityVariance})
  Menciones clínicas:       ${m.clinicalTermTotal} en ${Object.keys(clinicalTermFreq).length} términos
  Entradas de diario:       ${diaryEntries.length}, cifradas con el PIN
  Activaciones del SOS:     ${m.sosEvents.length}, ${sosEvents.filter(e => Date.now() - new Date(e.at) < 7 * 864e5).length} en los últimos 7 días
──────────────────────────────────────────────
${codigo ? "  En el panel: haz clic en el paciente y cambia el selector a 30 días.\n" : ""}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗ Falló:", e.code || "", e.message);
  if (String(e.code).includes("permission-denied")) {
    console.error("  Las reglas rechazaron la escritura. Revisa que firestore.rules esté desplegado.");
  }
  if (String(e.code).includes("operation-not-allowed")) {
    console.error("  Activa Correo/contraseña en Firebase → Authentication → Métodos de acceso.");
  }
  process.exit(1);
});
