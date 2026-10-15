/* =========================================================
   AURA — Escuchar a la persona (SpeechRecognition)

   LO QUE HAY QUE DECIR ANTES QUE NADA
   Esto NO es como el resto de Aura. El diario se cifra en el teléfono y
   ni el servidor puede leerlo; aurorIA manda texto a Google solo si la
   persona encendió ese interruptor. El reconocimiento de voz es otra
   cosa: el navegador toma el audio del micrófono y lo MANDA A UN
   SERVIDOR para convertirlo en texto. No corre en el aparato.

   En una app donde alguien puede estar describiendo en voz alta lo peor
   de su semana, eso es un tratamiento de datos de salud saliendo del
   dispositivo. Tiene que estar en el aviso de privacidad y la persona
   tiene que encenderlo a propósito. Por eso hay un aviso la primera vez
   y por eso nunca arranca solo.

   POR QUÉ DE A UNA FRASE Y NO CONTINUO
   La API tiene modo continuo. No se usa. Un micrófono abierto de forma
   permanente en una app de salud mental es otra cosa muy distinta de
   una app que escucha cuando le hablas, aunque técnicamente la
   diferencia sea una bandera. De a una frase: se abre, oye, se cierra.

   DOS MOTORES, SEGÚN DÓNDE CORRA
   En el navegador se usa SpeechRecognition de la web. Dentro de la app
   NO existe: el WebView de Android no trae el motor de Chrome, y el
   WKWebView de iOS no expone la API —funciona en Safari, no dentro de
   una app—. Ahí escucha un plugin nativo, que habla con SFSpeechRecognizer
   en iOS y con el reconocedor del sistema en Android.

   Que sea nativo NO lo vuelve privado: el audio sigue saliendo del
   teléfono hacia el servidor del fabricante. Cambia quién lo recibe
   —Apple en vez de Google—, no si sale. Para el aviso de privacidad es
   exactamente el mismo tratamiento.

   Si no hay ninguno de los dos, disponible() devuelve false y la
   interfaz esconde el botón en vez de ofrecer algo que va a fallar.
   ========================================================= */
(function () {
  "use strict";

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  var IDIOMA = "es-MX";
  var SIN_VOZ_MS = 9000;        // si nadie habla, se cierra solo

  var rec = null;               // el de la web
  var recNativo = null;         // el del plugin
  var activa = false;
  var cortadaAposta = false;

  function enApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
              window.Capacitor.isNativePlatform());
  }

  function nativo() {
    var P = window.Capacitor && window.Capacitor.Plugins;
    return (P && P.SpeechRecognition) || null;
  }

  /* Ojo con el orden. La versión anterior preguntaba primero por el
     SpeechRecognition de la web y, si no estaba, devolvía false de
     inmediato: dentro de la app eso escondía el botón aunque el plugin
     nativo estuviera instalado y funcionando. Dentro de la app manda el
     plugin; en el navegador, el de la web. */
  function disponible() {
    if (enApp()) return !!nativo();
    return typeof SR === "function" && !!window.isSecureContext;
  }

  var MOTIVOS = {
    "not-allowed":    "No diste permiso al micrófono. Se activa desde el candado de la barra de direcciones.",
    "not-allowed-app":"No diste permiso al micrófono. Se activa en los ajustes del teléfono, en la ficha de Aura.",
    "service-not-allowed": "El navegador bloqueó el micrófono para este sitio.",
    "audio-capture":  "No se encontró micrófono en este aparato.",
    "no-speech":      "No escuché nada. Toca otra vez y habla cerca del micrófono.",
    "network":        "El reconocimiento de voz necesita internet y no hubo conexión.",
    "aborted":        "",          // lo cortó la persona: no es un error que reportar
    "no-soportado":   "Este navegador no puede escuchar. Prueba con Chrome o Edge.",
    "ya-activa":      ""
  };

  function mensaje(codigo) {
    // Dentro de la app no hay candado en una barra de direcciones: el
    // permiso se recupera desde los ajustes del sistema.
    if (codigo === "not-allowed" && enApp()) codigo = "not-allowed-app";
    return MOTIVOS[codigo] != null ? MOTIVOS[codigo] : "No se pudo escuchar. Inténtalo de nuevo.";
  }

  /**
   * Escucha UNA intervención y devuelve { texto, motivo }.
   * texto viene vacío si no se entendió nada; motivo dice por qué.
   *
   * opciones:
   *   alParcial(texto)  — lo que va entendiendo, para mostrarlo en vivo
   *   alEmpezar()       — cuando el micrófono ya está abierto de verdad
   */
  function escuchar(opciones) {
    opciones = opciones || {};
    if (!disponible()) return Promise.resolve({ texto: "", motivo: "no-soportado" });
    if (activa) return Promise.resolve({ texto: "", motivo: "ya-activa" });
    // Misma forma de respuesta en los dos caminos, para que app.js no
    // tenga que enterarse de dónde está corriendo.
    return enApp() ? escucharNativo(opciones) : escucharWeb(opciones);
  }

  /* ---------- el camino nativo: iOS y Android dentro de la app ----------

     Las dos plataformas se comportan distinto y el código tiene que
     aguantar las dos:

       - iOS resuelve start() casi de inmediato y lo que entiende llega
         por el escucha de "partialResults". Hay que llamar a stop() a
         mano; si no, el micrófono se queda abierto.
       - Android suele resolver start() ya con lo que entendió.

     Por eso se escucha por los dos lados y gana el que llegue primero:
     terminar() tiene guardia para que solo cuente una vez. */
  function codigoDeError(e) {
    var m = String((e && (e.message || e.errorMessage)) || "").toLowerCase();
    if (/permis|denied|denegad|autoriz/.test(m)) return "not-allowed";
    if (/network|internet|conexi/.test(m))       return "network";
    if (/no match|no speech|no se|sin voz/.test(m)) return "no-speech";
    if (/not available|unavailable|no dispon/.test(m)) return "no-soportado";
    return "desconocido";
  }

  async function escucharNativo(opciones) {
    var SRN = nativo();
    if (!SRN) return { texto: "", motivo: "no-soportado" };

    /* El permiso se pide AQUÍ, cuando la persona acaba de tocar el
       botón del micrófono. Pedirlo al abrir la app lo convierte en una
       pregunta sin contexto, que casi todo el mundo niega, y una vez
       negado en iOS solo se recupera entrando a los ajustes. */
    try {
      var p = await SRN.checkPermissions();
      if (p && p.speechRecognition !== "granted") {
        var r = await SRN.requestPermissions();
        if (!r || r.speechRecognition !== "granted") {
          return { texto: "", motivo: "not-allowed" };
        }
      }
    } catch (e) { /* plugin viejo sin checkPermissions: se intenta igual */ }

    try {
      var d = await SRN.available();
      if (d && d.available === false) return { texto: "", motivo: "no-soportado" };
    } catch (e) {}

    return new Promise(function (resolve) {
      var texto = "", resuelto = false, descartado = false, reloj = null;
      activa = true;
      cortadaAposta = false;

      function parar() { try { SRN.stop(); } catch (e) {} }

      function terminar(motivo) {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(reloj);
        try { SRN.removeAllListeners(); } catch (e) {}
        activa = false;
        recNativo = null;
        resolve({ texto: descartado ? "" : (texto || "").trim(), motivo: motivo || null });
      }

      // Si nadie habla, no dejar el micrófono abierto para siempre.
      function rearmar() {
        clearTimeout(reloj);
        reloj = setTimeout(function () { cortadaAposta = true; parar(); }, SIN_VOZ_MS);
      }

      recNativo = {
        parar: function () { cortadaAposta = true; parar(); },
        cancelar: function () { descartado = true; cortadaAposta = true; parar(); }
      };

      try {
        SRN.addListener("partialResults", function (ev) {
          var m = ev && ev.matches && ev.matches[0];
          if (!m) return;
          texto = m;
          rearmar();
          if (typeof opciones.alParcial === "function") opciones.alParcial(texto);
        });

        SRN.addListener("listeningState", function (ev) {
          if (!ev) return;
          if (ev.status === "started") {
            rearmar();
            if (typeof opciones.alEmpezar === "function") opciones.alEmpezar();
          } else if (ev.status === "stopped") {
            terminar(texto ? null : (cortadaAposta ? "aborted" : "no-speech"));
          }
        });
      } catch (e) { /* si no acepta escuchas, queda el resultado de start() */ }

      Promise.resolve(SRN.start({
        language: IDIOMA,
        maxResults: 1,
        partialResults: true,
        popup: false            // sin la ventana del sistema de Android
      })).then(function (res) {
        if (res && res.matches && res.matches[0]) {   // camino de Android
          texto = res.matches[0];
          terminar(null);
        }
        // En iOS no llega nada aquí: lo bueno viene por los escuchas.
      }).catch(function (e) {
        terminar(texto ? null : codigoDeError(e));
      });

      rearmar();
    });
  }

  /* ---------- el camino de la web ---------- */
  function escucharWeb(opciones) {
    return new Promise(function (resolve) {
      var r;
      try { r = new SR(); } catch (e) { return resolve({ texto: "", motivo: "no-soportado" }); }

      rec = r;
      activa = true;
      cortadaAposta = false;

      r.lang = IDIOMA;
      r.continuous = false;          // una frase, no un micrófono abierto
      r.interimResults = true;       // para poder ir mostrando lo que oye
      r.maxAlternatives = 1;

      var finalTexto = "";
      var resuelto = false;
      var relojSilencio = null;

      function terminar(texto, motivo) {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(relojSilencio);
        activa = false;
        rec = null;
        try { r.onresult = r.onerror = r.onend = r.onstart = null; } catch (e) {}
        resolve({ texto: (texto || "").trim(), motivo: motivo || null });
      }

      // Si nadie habla, no dejar el micrófono abierto para siempre.
      function rearmarSilencio() {
        clearTimeout(relojSilencio);
        relojSilencio = setTimeout(function () {
          cortadaAposta = true;
          try { r.stop(); } catch (e) {}
          terminar(finalTexto, finalTexto ? null : "no-speech");
        }, SIN_VOZ_MS);
      }

      r.onstart = function () {
        rearmarSilencio();
        if (typeof opciones.alEmpezar === "function") opciones.alEmpezar();
      };

      r.onresult = function (ev) {
        var parcial = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalTexto += t;
          else parcial += t;
        }
        rearmarSilencio();
        if (typeof opciones.alParcial === "function") {
          opciones.alParcial((finalTexto + " " + parcial).trim());
        }
      };

      r.onerror = function (ev) {
        // "aborted" y "no-speech" llegan también cuando la persona cortó
        // a propósito; ahí no hay nada que reportar.
        var cod = ev && ev.error ? ev.error : "desconocido";
        if (cortadaAposta && (cod === "aborted" || cod === "no-speech")) cod = "aborted";
        terminar(finalTexto, finalTexto ? null : cod);
      };

      r.onend = function () {
        terminar(finalTexto, finalTexto ? null : (cortadaAposta ? "aborted" : "no-speech"));
      };

      try { r.start(); }
      catch (e) { terminar("", "no-soportado"); }
    });
  }

  /** Corta la escucha. Lo que alcanzó a entender se conserva. */
  function detener() {
    if (recNativo) { recNativo.parar(); return true; }
    if (!rec || !activa) return false;
    cortadaAposta = true;
    try { rec.stop(); } catch (e) { try { rec.abort(); } catch (e2) {} }
    return true;
  }

  /** Corta y descarta lo entendido. */
  function cancelar() {
    if (recNativo) { recNativo.cancelar(); return true; }
    if (!rec || !activa) return false;
    cortadaAposta = true;
    try { rec.abort(); } catch (e) {}
    return true;
  }

  /* Si se va de la pestaña, se cierra el micrófono. Dejarlo abierto en
     segundo plano en una app de salud mental no es aceptable. */
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) cancelar();
    });
  }
  if (typeof window !== "undefined") window.addEventListener("pagehide", cancelar);

  window.AuraEscucha = {
    IDIOMA: IDIOMA,
    disponible: disponible,
    escuchar: escuchar,
    detener: detener,
    cancelar: cancelar,
    mensaje: mensaje,
    get activa() { return activa; }
  };
})();
