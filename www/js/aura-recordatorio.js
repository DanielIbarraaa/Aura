/* =========================================================
   AURA — Recordatorios en el teléfono

   QUÉ ES Y QUÉ NO ES
   Son notificaciones LOCALES: las programa el propio teléfono y salen
   aunque no haya señal. No pasan por ningún servidor, no cuestan nada
   y nadie de fuera sabe a qué hora las pusiste.

   Aquí solo hay dos, y la diferencia entre ellas importa:

     - EL RECORDATORIO lo pone la persona, a la hora que ella elija.
       No existe si no lo enciende. Nunca dice "llevas tres días sin
       entrar" ni nada que se le parezca: eso sería un reclamo, y todo
       el diseño del cielo se hizo para no reclamar.

     - LA CELEBRACIÓN salta al completar una constelación. Es
       consecuencia de algo que la persona acaba de hacer, no de una
       ausencia. Por eso se permite.

   LO QUE NUNCA VA A HABER AQUÍ: notificaciones por no entrar, por
   racha en riesgo, por "te extrañamos" o por cualquier otra cosa que
   convierta abrir la app en una deuda.

   EL TEXTO EN LA PANTALLA BLOQUEADA
   Una notificación que dice "¿Cómo te sientes hoy?" con el nombre
   Aura encima le avisa a quien pase junto al teléfono que esa persona
   usa una app de salud mental. Para alguien cuya familia no sabe que
   va a terapia, eso filtra justo lo que la app promete cuidar.

   Por eso el canal va con visibilidad privada: en la pantalla
   bloqueada Android muestra solo el nombre de la app, y el texto
   aparece cuando se desbloquea. El texto además es neutro — habla de
   un momento del día, no de síntomas.
   ========================================================= */
(function () {
  "use strict";

  var CANAL = "aura-recordatorios";
  var ID_DIARIO = 1001;         // fijo: reprogramar reemplaza, no acumula
  var ID_CELEBRA = 2000;        // + índice de la constelación

  function enApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
              window.Capacitor.isNativePlatform());
  }

  function plugin() {
    var P = window.Capacitor && window.Capacitor.Plugins;
    return (P && P.LocalNotifications) || null;
  }

  /** Solo hay recordatorios dentro del APK. En el navegador no existe. */
  function disponible() { return enApp() && !!plugin(); }

  /* ---------- permiso ----------
     Android 13 en adelante lo pide en tiempo de ejecución. Se pregunta
     cuando la persona enciende el interruptor, no al abrir la app:
     un permiso que se pide sin contexto casi siempre se niega, y una
     vez negado cuesta mucho recuperarlo. */
  async function permiso() {
    var LN = plugin();
    if (!LN) return "no-disponible";
    try {
      var r = await LN.checkPermissions();
      return r.display;                   // granted | denied | prompt
    } catch (e) { return "no-disponible"; }
  }

  async function pedirPermiso() {
    var LN = plugin();
    if (!LN) return false;
    try {
      var actual = await LN.checkPermissions();
      if (actual.display === "granted") return true;
      var r = await LN.requestPermissions();
      return r.display === "granted";
    } catch (e) { return false; }
  }

  /* ---------- el canal ----------
     Se crea una vez. La visibilidad privada es lo que mantiene el
     texto fuera de la pantalla bloqueada. */
  async function canal() {
    var LN = plugin();
    if (!LN || !LN.createChannel) return;
    try {
      await LN.createChannel({
        id: CANAL,
        name: "Recordatorios",
        description: "Los que tú programas. Aura no manda avisos por su cuenta.",
        importance: 3,          // sin sonido insistente ni interrupción
        visibility: 0,          // PRIVATE: en la pantalla bloqueada no se lee
        vibration: false
      });
    } catch (e) { /* en Android viejo no existe: no pasa nada */ }
  }

  /* ---------- el recordatorio diario ---------- */

  /* Textos neutros. Ninguno menciona ánimo, ansiedad ni terapia: si
     alguien alcanza a ver la pantalla, no se entera de nada. Se rota
     para que no se vuelva un ruido que el ojo aprende a ignorar. */
  var TEXTOS = [
    { titulo: "Aura", cuerpo: "Un momento para ti, si quieres." },
    { titulo: "Aura", cuerpo: "Aquí estoy cuando gustes." },
    { titulo: "Aura", cuerpo: "Tu momento del día." },
    { titulo: "Aura", cuerpo: "Un ratito, si te late." }
  ];

  /**
   * Programa (o reprograma) el recordatorio diario.
   * hora y minuto en hora local. Devuelve true si quedó.
   */
  async function programarDiario(hora, minuto) {
    var LN = plugin();
    if (!LN) return false;
    if (!(await pedirPermiso())) return false;
    await canal();
    await cancelarDiario();

    var t = TEXTOS[Math.floor(Math.random() * TEXTOS.length)];
    try {
      await LN.schedule({
        notifications: [{
          id: ID_DIARIO,
          channelId: CANAL,
          title: t.titulo,
          body: t.cuerpo,
          // "every: day" con hora y minuto repite todos los días a esa
          // hora local, y sigue el horario del teléfono si cambia de
          // zona. Calcular la próxima fecha a mano se rompe con los
          // cambios de horario.
          schedule: { on: { hour: hora, minute: minuto }, allowWhileIdle: false },
          smallIcon: "ic_stat_aura",
          autoCancel: true,
          extra: { origen: "recordatorio" }
        }]
      });
      return true;
    } catch (e) {
      console.warn("[Aura recordatorio] no se pudo programar:", e.message);
      return false;
    }
  }

  async function cancelarDiario() {
    var LN = plugin();
    if (!LN) return;
    try { await LN.cancel({ notifications: [{ id: ID_DIARIO }] }); } catch (e) {}
  }

  /** ¿Hay uno programado ahorita? */
  async function programado() {
    var LN = plugin();
    if (!LN) return false;
    try {
      var r = await LN.getPending();
      return (r.notifications || []).some(function (n) { return n.id === ID_DIARIO; });
    } catch (e) { return false; }
  }

  /* ---------- la celebración ----------
     Sale al completar una constelación, o sea justo después de algo
     que la persona hizo. Nunca por no hacer nada. */
  async function celebrar(nombreConstelacion, indice) {
    var LN = plugin();
    if (!LN) return false;
    if ((await permiso()) !== "granted") return false;   // no se pide permiso por esto
    await canal();
    try {
      await LN.schedule({
        notifications: [{
          id: ID_CELEBRA + (indice | 0),
          channelId: CANAL,
          title: "Aura",
          body: "Completaste " + nombreConstelacion + ".",
          schedule: { at: new Date(Date.now() + 1200) },   // que no tape el toast
          smallIcon: "ic_stat_aura",
          autoCancel: true,
          extra: { origen: "constelacion" }
        }]
      });
      return true;
    } catch (e) { return false; }
  }

  window.AuraRecordatorio = {
    CANAL: CANAL,
    disponible: disponible,
    permiso: permiso,
    pedirPermiso: pedirPermiso,
    programarDiario: programarDiario,
    cancelarDiario: cancelarDiario,
    programado: programado,
    celebrar: celebrar
  };
})();
