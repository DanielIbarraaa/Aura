/* =========================================================
   AURA — aurorIA con Claude (Anthropic)
   Esta función existe por una sola razón: la llave de Anthropic
   no puede estar en el teléfono. Aquí vive, en un secreto de
   Firebase, y el teléfono solo habla con esta función.

   Reglas que esta función respeta y que sostienen la promesa
   de privacidad de Aura:
     - NO guarda la conversación en Firestore.
     - NO escribe el texto del usuario en los logs. Ni en error.
     - Vuelve a correr la detección de riesgo del lado del
       servidor: la del teléfono se puede saltar manipulando el
       cliente, esta no.
   ========================================================= */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const MODELO = "claude-haiku-4-5-20251001";  // el más rápido; para más matiz: claude-sonnet-5
const MAX_TOKENS = 320;
const MAX_TURNOS = 16;
const LINEA = "8009112000";

/* ---- Detección de riesgo, espejo de la del cliente ----
   Se repite a propósito. La del teléfono responde al instante y
   sin red; esta cubre el caso de un cliente manipulado. */
const RIESGO = [
  "suicid", "quitarme la vida", "matarme", "me quiero morir", "ya no quiero vivir",
  "no quiero seguir", "acabar con todo", "desaparecer para siempre",
  "hacerme daño", "lastimarme", "cortarme", "autolesion", "autolesión",
  "me quiero ir de este mundo", "sobredosis", "no vale la pena vivir"
];
const NEGADAS = ["no quiero morir", "ya no pienso en morir", "dejé de pensar en"];

function esCrisis(texto) {
  const t = String(texto || "").toLowerCase();
  if (NEGADAS.some(n => t.includes(n))) return false;
  return RIESGO.some(w => t.includes(w));
}

const RESPUESTA_CRISIS =
  "Gracias por decírmelo. Lo que estás sintiendo es serio y no tienes que sostenerlo tú solo. " +
  "Yo no soy una persona ni un servicio de emergencia, así que quiero pasarte con alguien que sí puede " +
  "acompañarte ahora mismo: la Línea de la Vida, al " + LINEA + ", atiende 24/7 y es gratuita. " +
  "Si estás en peligro inmediato, marca 911. Voy a abrirte el módulo SOS para que respires conmigo " +
  "mientras decides a quién llamar.";

const SISTEMA = `Eres aurorIA, la voz de acompañamiento de la app Aura, en México.

QUÉ ERES
- Un apoyo conversacional de primera línea. No eres terapeuta, no eres médico y no eres un servicio de emergencia.
- Nunca diagnosticas, nunca nombras trastornos como si fueran un dictamen, nunca hablas de medicamentos ni de dosis.
- Si alguien te pregunta si eres humano, lo dices con claridad: eres una IA.

CÓMO HABLAS
- Español de México, cálido y directo, de tú. Sin solemnidad, sin frases de folleto.
- Dos o tres frases. La persona está en el teléfono, quizá mal: no le des un ensayo.
- Reflejas lo que te dijo con SUS palabras antes de proponer nada. Nada de "entiendo cómo te sientes" genérico.
- No repites la misma fórmula dos veces seguidas. No abres siempre con la misma frase.
- Una sola pregunta por respuesta, cuando ayude. A veces no hace falta preguntar nada.

QUÉ OFRECES
Cuando encaje —y solo entonces— puedes sugerir una herramienta que la persona ya tiene en la app:
- Módulo Calma → habilidades TIPP (agua fría, activación física, respiración pausada, relajación muscular) para activación alta.
- Meditación 9 a 0 → conteo con exhalación larga, para rumiación nocturna e insomnio.
- Kit de los 5 Sentidos → anclaje al entorno, para disociación o pensamiento acelerado.
- Lienzo de dibujo y burbujas → descarga táctil cuando no hay palabras.
- Diario → cuando lo que hay es algo que necesita salir por escrito.
Propón UNA, no un menú.

LÍMITES
- No prometes confidencialidad absoluta ni que "esto queda entre nosotros".
- No haces evaluaciones de riesgo con preguntas tipo cuestionario.
- No opinas sobre diagnósticos, tratamientos ni sobre el trabajo del terapeuta de la persona.
- Si te piden algo fuera de acompañamiento emocional, lo dices y regresas al tema.
- Si detectas dolor que excede una charla —violencia, abuso, consumo, pensamientos de muerte—, no lo manejas tú: lo nombras con cuidado y sugieres a la persona buscar a su especialista o llamar a la Línea de la Vida (${LINEA}).`;

/* Claude exige que el historial empiece con "user" y alterne.
   Un historial mal formado devuelve 400, así que se normaliza aquí. */
function normalizar(mensajes) {
  const limpios = mensajes
    .filter(m => m && typeof m.text === "string" && m.text.trim())
    .slice(-MAX_TURNOS)
    .map(m => ({
      role: m.sender === "me" ? "user" : "assistant",
      content: m.text.trim().slice(0, 2000)
    }));

  while (limpios.length && limpios[0].role !== "user") limpios.shift();

  const alternados = [];
  for (const m of limpios) {
    const prev = alternados[alternados.length - 1];
    if (prev && prev.role === m.role) prev.content += "\n" + m.content;
    else alternados.push(m);
  }
  return alternados;
}

export const auroria = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    timeoutSeconds: 30,
    memory: "256MiB",
    // Cuando actives App Check, cambia esto a true y nadie fuera de
    // tu app podrá gastarte la cuota.
    enforceAppCheck: false
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Inicia sesión para hablar con aurorIA.");
    }

    const { mensajes, nombre } = request.data || {};
    if (!Array.isArray(mensajes) || mensajes.length === 0) {
      throw new HttpsError("invalid-argument", "No hay nada que responder.");
    }

    const ultimo = mensajes[mensajes.length - 1];
    if (!ultimo || ultimo.sender !== "me") {
      throw new HttpsError("invalid-argument", "El último turno debe ser del usuario.");
    }

    // Segunda barrera: si el cliente fue manipulado, aquí se corta igual.
    if (esCrisis(ultimo.text)) {
      return { texto: RESPUESTA_CRISIS, crisis: true };
    }

    const historial = normalizar(mensajes);
    if (!historial.length) {
      throw new HttpsError("invalid-argument", "Historial vacío tras normalizar.");
    }
    if (nombre) {
      const i = historial.length - 1;
      historial[i] = { ...historial[i], content: `[La persona se llama ${nombre}.] ${historial[i].content}` };
    }

    try {
      const cliente = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const respuesta = await cliente.messages.create({
        model: MODELO,
        max_tokens: MAX_TOKENS,
        temperature: 0.8,
        system: SISTEMA,
        messages: historial
      });

      const texto = (respuesta.content || [])
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("")
        .trim();

      if (!texto) throw new Error("respuesta vacía del modelo");
      return { texto, crisis: false };
    } catch (e) {
      // Se registra el tipo de fallo, NUNCA el contenido de la conversación.
      logger.error("aurorIA no pudo responder", { tipo: e?.name, status: e?.status });
      throw new HttpsError("unavailable", "aurorIA no está disponible ahora.");
    }
  }
);
