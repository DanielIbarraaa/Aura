/* =========================================================
   AURA — aurorIA
   Modelo en la nube (Gemini vía Firebase AI Logic) con dos
   salvaguardas que NO dependen del modelo:
     1. La detección de riesgo corre antes, en local y por reglas.
     2. Si no hay red, consentimiento o SDK, responde el guion local.
   ========================================================= */
(() => {
  "use strict";

  const CFG = window.AURA_CONFIG || {};
  const LINE = (CFG.crisisLine && CFG.crisisLine.tel) || "8009112000";

  /* ---- 1. Detección de riesgo: local, determinista, sin red ---- */
  const RISK = [
    "suicid", "quitarme la vida", "matarme", "me quiero morir", "ya no quiero vivir",
    "no quiero seguir", "acabar con todo", "desaparecer para siempre",
    "hacerme daño", "lastimarme", "cortarme", "autolesion", "autolesión",
    "me quiero ir de este mundo", "sobredosis", "no vale la pena vivir"
  ];
  const NEGATED = ["no quiero morir", "ya no pienso en morir", "dejé de pensar en"];

  function isCrisis(text) {
    const t = (text || "").toLowerCase();
    if (NEGATED.some(n => t.includes(n))) return false;
    return RISK.some(w => t.includes(w));
  }

  const CRISIS_REPLY =
    "Gracias por decírmelo. Lo que estás sintiendo es serio y no tienes que sostenerlo tú solo. " +
    "Yo no soy una persona ni un servicio de emergencia, así que quiero pasarte con alguien que sí puede acompañarte ahora mismo: " +
    "la Línea de la Vida, al " + LINE + ", atiende 24/7 y es gratuita. Si estás en peligro inmediato, marca 911. " +
    "Voy a abrirte el módulo SOS para que respires conmigo mientras decides a quién llamar.";

  /* ---- 2. Instrucción de sistema ---- */
  const SYSTEM = `Eres aurorIA, la voz de acompañamiento de la app Aura, en México.

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
- Si detectas dolor que excede una charla —violencia, abuso, consumo, pensamientos de muerte—, no lo manejas tú: lo nombras con cuidado y sugieres a la persona buscar a su especialista o llamar a la Línea de la Vida (${LINE}).`;

  /* ---- 3. Cliente Firebase AI Logic ---- */
  let model = null;
  let initError = null;

  function ensureModel() {
    if (model || initError) return model;
    try {
      const FB = window.AuraFB;
      if (!FB || !FB.getAI) throw new Error("SDK de Firebase no cargado (corre npm run build:firebase)");
      const app = FB.app();
      const ai = FB.getAI(app, { backend: new FB.GoogleAIBackend() });
      model = FB.getGenerativeModel(ai, {
        model: (CFG.ai && CFG.ai.model) || "gemini-3.7-flash",
        systemInstruction: SYSTEM,
        generationConfig: {
          temperature: (CFG.ai && CFG.ai.temperature) ?? 0.8,
          maxOutputTokens: (CFG.ai && CFG.ai.maxOutputTokens) || 320,
          topP: 0.95
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          // Ojo: bloquear "peligroso" de más corta conversaciones legítimas
          // sobre malestar. El filtro de riesgo real es isCrisis(), arriba.
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ]
      });
    } catch (e) {
      initError = e;
      console.warn("[aurorIA]", e.message);
    }
    return model;
  }

  /* memoria: los últimos turnos, en el formato que espera el SDK */
  function toHistory(memory) {
    const h = memory
      .filter(m => m && m.text)
      .map(m => ({ role: m.sender === "me" ? "user" : "model", parts: [{ text: m.text }] }));
    while (h.length && h[0].role !== "user") h.shift();   // el historial debe abrir con user
    return h.slice(0, -1);                                 // el último turno se manda aparte
  }

  async function reply(memory, ctx) {
    const m = ensureModel();
    if (!m) throw initError || new Error("modelo no disponible");

    const last = memory[memory.length - 1];
    if (!last || last.sender !== "me") throw new Error("nada que responder");

    const chat = m.startChat({ history: toHistory(memory) });
    const prefix = ctx && ctx.name ? `[La persona se llama ${ctx.name}.] ` : "";
    const res = await chat.sendMessage(prefix + last.text);
    const text = (res.response.text() || "").trim();
    if (!text) throw new Error("respuesta vacía");
    return text;
  }

  window.AuraAI = { reply, isCrisis, CRISIS_REPLY, SYSTEM, get ready() { return !!ensureModel(); } };
})();
