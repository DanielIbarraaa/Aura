/* =========================================================
   AURA — Cloud Functions
   Dos trabajos, nada más:
     1. Avisarle al especialista cuando su paciente activa el SOS.
     2. Publicar en el directorio público al especialista cuya
        cédula quedó verificada (a mano, desde la consola).
   Ninguna función lee ni toca el diario: no existe en Firestore.
   ========================================================= */
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";

/* aurorIA con Claude vive en su propio archivo: guarda la llave de
   Anthropic y por eso no puede correr en el teléfono. */
export * from "./auroria.js";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });
const db = getFirestore();

const TEXTO_ORIGEN = {
  boton_sos:        "abrió el módulo SOS",
  mencion_en_chat:  "expresó una señal de riesgo en aurorIA",
  llamada_linea:    "marcó la línea de apoyo desde la app"
};

/* ---------- 1. Alerta de SOS ---------- */
export const alertaSos = onDocumentCreated("alerts/{alertId}", async (event) => {
  const alerta = event.data?.data();
  if (!alerta?.therapistUid) return;

  const pacienteSnap = await db.doc(`patients/${alerta.patientId}`).get();
  const alias = pacienteSnap.get("alias") || `Paciente ${alerta.patientId.slice(0, 4).toUpperCase()}`;
  const que = TEXTO_ORIGEN[alerta.origen] || "activó el SOS";

  const tokens = (await db.doc(`therapists/${alerta.therapistUid}`).get()).get("fcmTokens") || [];
  if (!tokens.length) {
    logger.info(`Sin tokens FCM para ${alerta.therapistUid}; la alerta queda solo en el panel.`);
    return;
  }

  try {
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: `${alias} ${que}`,
        body: "Revísalo en tu panel antes de la próxima sesión. Aura no atiende urgencias."
      },
      data: { patientId: alerta.patientId, origen: alerta.origen || "", tipo: "sos" },
      android: { priority: "high" },
      apns: { headers: { "apns-priority": "10" } }
    });

    // Limpia los tokens que ya no existen, o la lista crece para siempre.
    const muertos = res.responses
      .map((r, i) => (!r.success && ["messaging/registration-token-not-registered",
        "messaging/invalid-registration-token"].includes(r.error?.code) ? tokens[i] : null))
      .filter(Boolean);
    if (muertos.length) {
      await db.doc(`therapists/${alerta.therapistUid}`)
        .update({ fcmTokens: FieldValue.arrayRemove(...muertos) });
    }
  } catch (e) {
    logger.error("No se pudo enviar la alerta de SOS", e);
  }
});

/* ---------- 2. Publicar en el directorio al verificar la cédula ---------- */
export const publicarDirectorio = onDocumentUpdated("therapists/{uid}", async (event) => {
  const antes = event.data?.before.data() || {};
  const ahora = event.data?.after.data() || {};
  const uid = event.params.uid;
  const ref = db.doc(`directory/${uid}`);

  const debeEstar = ahora.verified === true && ahora.activo !== false;
  const estaba = antes.verified === true && antes.activo !== false;
  if (debeEstar === estaba && antes.name === ahora.name && antes.whatsapp === ahora.whatsapp) return;

  if (!debeEstar) {
    await ref.delete().catch(() => {});
    return;
  }

  // Solo los campos que un paciente puede ver. Correo y notas nunca salen.
  await ref.set({
    name: ahora.name || null,
    cedula: ahora.cedula || null,
    especialidad: ahora.especialidad || null,
    institucion: ahora.institucion || null,
    ciudad: ahora.ciudad || null,
    modalidad: ahora.modalidad || null,
    whatsapp: ahora.whatsapp || null,
    tarifa: ahora.tarifa ?? null,
    code: ahora.code || null,
    publicadoEn: FieldValue.serverTimestamp()
  });
});
