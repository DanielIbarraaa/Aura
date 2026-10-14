/* =========================================================
   AURA — La voz de aurorIA (Web Speech API)

   POR QUÉ LA VOZ DEL NAVEGADOR Y NO UNA DE PAGO
   Gemini TTS suena mejor, sin discusión. Pero el audio se cobra por
   token —25 tokens por segundo— y una respuesta hablada de medio minuto
   sale en unos siete milésimos de dólar. Un usuario que platique a
   diario se va a dos o cuatro dólares al mes, contra un plan de 99
   pesos que son como cinco, y contra 49.50 del plan de estudiante.
   La voz sola se comería el margen antes de pagar el texto, Firestore
   y la comisión de la tienda.

   speechSynthesis cuesta cero, funciona sin internet y usa las voces en
   español que el teléfono ya trae. Cuando haya con qué pagar la voz
   buena, el lugar donde se conecta es hablar(): lo de afuera no cambia.

   APAGADA POR DEFECTO, A PROPÓSITO
   Esta es una app de salud mental. Alguien la abre en el camión, en la
   oficina o en la cama a las dos de la mañana. Un teléfono que empieza
   a hablar solo en cualquiera de esos tres lugares es un problema, no
   una función. Se enciende desde Configuración y ya.

   TRES FALLAS CONOCIDAS QUE ESTE ARCHIVO ESQUIVA
   La Web Speech API tiene fama de frágil, y con razón:

     1. getVoices() devuelve [] en la primera llamada. La lista carga
        asíncrona y avisa por el evento voiceschanged. Quien lee la
        lista de inmediato concluye que no hay voces en español.
     2. Chrome corta el audio a los ~15 segundos si el texto es largo.
        Es un error viejo del motor. Se esquiva partiendo el texto en
        frases y llamando a resume() en intervalos.
     3. iOS no deja sonar nada hasta que hubo un toque de la persona.
        Por eso existe desbloquear(), que se llama desde el interruptor.
   ========================================================= */
(function () {
  "use strict";

  var IDIOMAS = ["es-MX", "es-US", "es-419", "es-ES", "es"];

  /* ---------- las voces de broma de macOS ----------
     El sistema trae dos familias de voces y getVoices() las devuelve
     revueltas. Están las de verdad —Paulina en México, Mónica en
     España— y están las de caricatura: Eddy, Grandma, Rocko, Bubbles,
     Zarvox. Todas dicen ser es-MX y todas son locales, así que por
     idioma y disponibilidad quedan empatadas.

     En la Mac de prueba había dieciocho voces en español y la primera
     de la lista del sistema era "Eddy (Spanish (Mexico))". Aura tomaba
     esa. Para un lector de noticias sería un detalle gracioso; aquí no:
     alguien escribe que lleva la semana con un nudo en el pecho y le
     contesta la voz de la abuelita de caricatura.

     Por eso las voces de broma van al final. Si no hay ninguna seria
     instalada se usan igual —mejor una voz rara que el silencio—, pero
     nunca por encima de una normal. */
  var BROMA = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|princess|deranged|hysterical|bruce|agnes|victoria|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

  function esBroma(v) { return BROMA.test(String(v && v.name || "")); }

  /* ---------- femenina ----------
     La Web Speech API no dice el género de una voz. No hay campo, no hay
     manera de preguntarlo: lo único que da es el nombre. Así que se va
     por nombre, con las listas de cada sistema.

     Es una heurística y como tal falla con voces que no estén en la
     lista. Por eso hay dos listas y no una: la de nombres femeninos
     elige, y la de masculinos descarta. Una voz desconocida queda en
     medio — se usa si no hay nada mejor, pero nunca por encima de una
     que sí sabemos que es femenina. */
  var FEMENINAS = /^(paulina|m[oó]nica|marisol|angelica|ang[eé]lica|isabela|soledad|esperanza|carmela|sabina|helena|laura|elena|lucia|luc[ií]a|penelope|pen[eé]lope|camila|valentina|sof[ií]a|sofia|ximena|renata|regina|flo|grandma|sandy|shelley|karen|samantha|victoria|allison|ava|susan|zoe|google espa[nñ]ol|female|mujer)\b/i;
  var MASCULINAS = /^(jorge|diego|juan|carlos|pablo|ra[uú]l|raul|enrique|miguel|javier|andr[eé]s|mateo|eddy|grandpa|reed|rocko|alex|daniel|fred|ralph|tom|aaron|male|hombre)\b/i;

  function esFemenina(v) {
    var n = String(v && v.name || "");
    if (MASCULINAS.test(n)) return false;
    return FEMENINAS.test(n) ? true : null;   // null = no se sabe
  }
  var TROZO_MAX = 180;        // Chrome se atora con frases más largas

  /* ---------- el registro de aurorIA ----------
     pitch y rate son lo ÚNICO que la Web Speech API deja tocar de la
     voz. Con eso hay que construir una criatura.

     1.6 de tono la levanta bastante por encima de una voz humana sin
     llegar a la ardilla, que empieza como en 1.9 y ahí deja de
     entenderse. 0.86 de velocidad le quita la cadencia de locutora: una
     voz aguda y apurada suena a caricatura, una aguda y pausada suena a
     algo que está midiendo las palabras.

     El resto del efecto no vive aquí: lo pone js/aura-timbre.js
     alrededor de la voz, porque el audio del sintetizador no se puede
     tocar desde JavaScript. */
  var VELOCIDAD = 0.86;
  var TONO = 1.6;
  var LATIDO_MS = 8000;       // cada cuánto se le da resume() a Chrome

  var vocesCache = null;
  var vozElegida = null;
  var hablando = false;
  var latido = null;
  var desbloqueada = false;
  var cancelando = false;

  /* ---------- disponibilidad ---------- */

  function disponible() {
    return typeof window !== "undefined" &&
           "speechSynthesis" in window &&
           typeof window.SpeechSynthesisUtterance === "function";
  }

  /* ---------- catálogo de voces ----------
     La lista llega tarde. Se resuelve con el evento y con un sondeo de
     respaldo, porque hay navegadores donde voiceschanged no dispara
     nunca y la lista aparece sola al segundo intento. */
  function voces() {
    if (!disponible()) return Promise.resolve([]);
    if (vocesCache && vocesCache.length) return Promise.resolve(vocesCache);

    return new Promise(function (resolve) {
      var intentos = 0;
      function revisar() {
        var lista = window.speechSynthesis.getVoices() || [];
        if (lista.length) {
          vocesCache = lista;
          window.speechSynthesis.onvoiceschanged = null;
          resolve(lista);
          return true;
        }
        return false;
      }
      if (revisar()) return;

      window.speechSynthesis.onvoiceschanged = revisar;
      var t = setInterval(function () {
        intentos++;
        if (revisar() || intentos > 20) { clearInterval(t); resolve(vocesCache || []); }
      }, 100);
    });
  }

  /** Voces en español, la más adecuada primero. */
  function vocesEspanol(lista) {
    var es = (lista || []).filter(function (v) { return /^es/i.test(v.lang || ""); });
    return es.sort(function (a, b) {
      // 1. Femenina primero: aurorIA tiene una voz y es esa. Las que no
      //    se pueden identificar quedan en medio, por delante de las que
      //    sabemos que son masculinas.
      var fa = esFemenina(a), fb = esFemenina(b);
      var pa = fa === true ? 0 : (fa === null ? 1 : 2);
      var pb = fb === true ? 0 : (fb === null ? 1 : 2);
      if (pa !== pb) return pa - pb;

      // 2. Una voz seria antes que una de caricatura. Va DESPUÉS del
      //    género a propósito: se busca algo de otro mundo, no un chiste,
      //    y el efecto de otro mundo lo pone el timbre de aquí abajo.
      var ba = esBroma(a) ? 1 : 0, bb = esBroma(b) ? 1 : 0;
      if (ba !== bb) return ba - bb;

      // 2. Lo más cercano al español de México.
      var ia = IDIOMAS.indexOf(a.lang), ib = IDIOMAS.indexOf(b.lang);
      if (ia === -1) ia = 99;
      if (ib === -1) ib = 99;
      if (ia !== ib) return ia - ib;

      // 3. La que el sistema marca como predeterminada de ese idioma.
      if (!!a.default !== !!b.default) return a.default ? -1 : 1;

      // 4. La local antes que la de nube: no depende de la red.
      return (a.localService === b.localService) ? 0 : (a.localService ? -1 : 1);
    });
  }

  async function elegirVoz(nombrePreferido) {
    var lista = await voces();
    if (!lista.length) return null;

    if (nombrePreferido) {
      var exacta = lista.find(function (v) { return v.name === nombrePreferido; });
      if (exacta) { vozElegida = exacta; return exacta; }
    }
    var es = vocesEspanol(lista);
    vozElegida = es[0] || null;     // sin voz en español, mejor callar
    return vozElegida;
  }

  /* ---------- limpieza del texto ----------
     El modelo devuelve markdown y emojis. Leídos en voz alta suenan a
     "asterisco asterisco" o al nombre del emoji, que es peor que no
     decir nada. */
  function limpiar(texto) {
    return String(texto || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*([^*]*)\*\*/g, "$1")
      .replace(/[*_#>|]/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Parte en frases que el motor sí aguanta, sin cortar a media palabra. */
  function trozos(texto) {
    var frases = texto.match(/[^.!?¡¿…\n]+[.!?…]*[\s]*/g) || [texto];
    var salida = [], actual = "";

    for (var i = 0; i < frases.length; i++) {
      var f = frases[i].trim();
      if (!f) continue;

      if (f.length > TROZO_MAX) {
        if (actual) { salida.push(actual); actual = ""; }
        // Frase kilométrica sin puntuación: se parte por comas y, si aun
        // así no cabe, por palabras. Nunca a media palabra.
        var partes = f.split(/,\s*/);
        var buf = "";
        for (var j = 0; j < partes.length; j++) {
          var p = partes[j];
          while (p.length > TROZO_MAX) {
            var corte = p.lastIndexOf(" ", TROZO_MAX);
            if (corte <= 0) corte = TROZO_MAX;
            salida.push(p.slice(0, corte).trim());
            p = p.slice(corte);
          }
          if ((buf + " " + p).trim().length > TROZO_MAX) { salida.push(buf.trim()); buf = p; }
          else buf = (buf ? buf + ", " : "") + p;
        }
        if (buf.trim()) salida.push(buf.trim());
        continue;
      }

      if ((actual + " " + f).trim().length > TROZO_MAX) { salida.push(actual.trim()); actual = f; }
      else actual = (actual ? actual + " " : "") + f;
    }
    if (actual.trim()) salida.push(actual.trim());
    return salida.filter(Boolean);
  }

  /* ---------- el error de los 15 segundos ----------
     Chrome de escritorio pausa el sintetizador solo cuando el texto se
     alarga. Llamar a resume() cada tantos segundos lo mantiene vivo.
     En los navegadores donde no pasa, resume() sobre algo que no está
     pausado no hace nada: es inofensivo. */
  function iniciarLatido() {
    detenerLatido();
    latido = setInterval(function () {
      if (!window.speechSynthesis.speaking) { detenerLatido(); return; }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, LATIDO_MS);
  }
  function detenerLatido() { if (latido) { clearInterval(latido); latido = null; } }

  /* ---------- desbloqueo en iOS ----------
     Safari exige que el primer sonido salga de un gesto de la persona.
     La receta que circula por todos lados es decir algo vacío con
     volumen cero al tocar el botón, para "abrir" el canal.

     Aquí hacía daño. Esa locución muda queda encolada, y la frase de
     bienvenida llega milisegundos después llamando a cancel() para
     limpiar. Ese cancel() pegado a un speak() recién hecho deja el
     motor de macOS trabado: sigue disparando onstart y onboundary
     —parece que habla— pero no sale audio y onend no llega nunca.

     Y no se arregla solo. El sintetizador vive en el proceso del
     navegador, no en la pestaña: una vez trabado, recargar no lo
     revive. Alguien que tocara el interruptor una vez se quedaba sin
     voz hasta cerrar el navegador entero, sin ninguna pista de por qué.

     La locución muda sobra: el saludo YA se dice desde el gesto del
     toque, así que él mismo abre el canal en iOS. Se hace una sola cosa
     en vez de dos, y la que se quitó era justamente la que rompía. */
  function desbloquear() {
    // Se conserva la función para no cambiarle la forma a quien la llama.
    // Ya no encola nada: el primer hablar() sale del mismo gesto.
    desbloqueada = true;
    return true;
  }

  /* =========================================================
     Hablar
     ========================================================= */

  /**
   * Lee el texto en voz alta. Devuelve una promesa que se cumple al
   * terminar (o al cancelar; nunca se rechaza — que la voz falle no
   * debe tumbar la conversación, que es lo que de verdad importa).
   *
   * opciones:
   *   alEmpezar()          — antes del primer sonido
   *   alPalabra(indice)    — en cada palabra: es lo que mueve la boca
   *   alTerminar()         — al final o al cancelar
   *   velocidad, tono      — 0.1 a 2
   */
  async function hablar(texto, opciones) {
    opciones = opciones || {};
    var limpio = limpiar(texto);
    if (!disponible() || !limpio) return false;

    var habiaAlgo = callar();
    cancelando = false;
    // Solo se espera cuando de verdad se cortó algo. En el caso normal
    // —nadie hablando— no hay ninguna demora.
    if (habiaAlgo) await pausa(PAUSA_TRAS_CORTAR);

    if (!vozElegida) await elegirVoz(opciones.voz);
    // Sin voz en español preferimos el silencio: una voz en inglés
    // leyendo español no se entiende y suena a error.
    if (!vozElegida) return false;

    var partes = trozos(limpio);
    if (!partes.length) return false;

    hablando = true;
    if (typeof opciones.alEmpezar === "function") opciones.alEmpezar();
    iniciarLatido();

    // El destello y el halo. Es una dependencia opcional: si el archivo
    // no está cargado, la voz funciona igual, solo que sin ambiente.
    var T = window.AuraTimbre;
    if (T && opciones.timbre !== false) { T.destello(); T.abrirHalo(); }

    var palabras = 0;

    try {
      for (var i = 0; i < partes.length; i++) {
        if (cancelando) break;
        await decir(partes[i], opciones, function () { palabras++; });
      }
    } finally {
      hablando = false;
      detenerLatido();
      if (T) T.cerrarHalo();
      if (typeof opciones.alTerminar === "function") opciones.alTerminar();
    }
    return !cancelando;
  }

  function decir(fragmento, opciones, contar) {
    return new Promise(function (resolve) {
      var u = new SpeechSynthesisUtterance(fragmento);
      u.voice = vozElegida;
      u.lang = vozElegida.lang || "es-MX";
      u.rate = opciones.velocidad || VELOCIDAD;
      u.pitch = opciones.tono != null ? opciones.tono : TONO;
      u.volume = opciones.volumen != null ? opciones.volumen : 1;

      var terminado = false;
      function fin() {
        if (terminado) return;
        terminado = true;
        clearTimeout(salvavidas);
        resolve();
      }

      u.onboundary = function (ev) {
        if (ev.name && ev.name !== "word") return;
        contar();
        if (typeof opciones.alPalabra === "function") opciones.alPalabra(ev.charIndex);
      };
      u.onend = fin;
      u.onerror = fin;      // "interrupted" al cancelar entra por aquí

      /* Red de seguridad: si el motor se queda callado sin avisar —pasa
         en WebViews viejos— nadie resolvería la promesa y la boca se
         quedaría abierta para siempre. Se calcula por largo del texto,
         con margen. */
      var esperado = (fragmento.length / 11) * 1000 + 4000;
      var salvavidas = setTimeout(function () {
        // Que este aviso aparezca significa que el motor se colgó: arrancó
        // y nunca avisó que terminó. Sin el aviso, el fallo es mudo en los
        // dos sentidos — no se oye nada y el código cree que salió bien.
        console.warn("[Aura voz] el motor no avisó el final; se continúa igual.");
        fin();
      }, Math.min(esperado, 30000));

      try { window.speechSynthesis.speak(u); } catch (e) { fin(); }
    });
  }

  /**
   * Corta lo que se esté diciendo.
   * Devuelve true si de verdad había algo que cortar — quien llame necesita
   * saberlo, porque después de un cancel() el motor necesita un respiro.
   */
  function callar() {
    cancelando = true;
    detenerLatido();
    hablando = false;
    if (window.AuraTimbre) window.AuraTimbre.cerrarHalo();
    if (!disponible()) return false;
    var habia = window.speechSynthesis.speaking || window.speechSynthesis.pending;
    // cancel() sobre un motor que ya está en reposo no es inofensivo: en
    // macOS deja el sintetizador en un estado del que no vuelve.
    if (habia) { try { window.speechSynthesis.cancel(); } catch (e) { /* ya estaba callada */ } }
    return habia;
  }

  /* ---------- la pausa después de cortar ----------
     Cuando de verdad hubo que interrumpir —la persona manda otro
     mensaje mientras aurorIA contesta— sigue habiendo un cancel()
     seguido de un speak(), y ese par pegado es lo que traba el motor.

     La primera versión de esto esperaba a que speaking y pending
     quedaran en falso. No funciona: las dos banderas bajan en el acto y
     el sintetizador sigue ocupado por dentro. Medido en una Mac, la
     espera salía en 0 ms y la frase se colgaba igual.

     Así que es una pausa fija. Un cuarto de segundo es imperceptible
     cuando acabas de interrumpir algo a propósito, y es la diferencia
     entre que suene y que no vuelva a sonar nunca. */
  var PAUSA_TRAS_CORTAR = 260;

  function pausa(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* Si la persona cambia de pantalla o cierra, que no siga hablando sola. */
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && hablando) callar();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", callar);
  }

  window.AuraVoz = {
    disponible: disponible,
    desbloquear: desbloquear,
    voces: voces,
    vocesEspanol: vocesEspanol,
    esBroma: esBroma,
    esFemenina: esFemenina,
    elegirVoz: elegirVoz,
    limpiar: limpiar,
    trozos: trozos,
    hablar: hablar,
    callar: callar,
    VELOCIDAD: VELOCIDAD,
    TONO: TONO,
    get hablando() { return hablando; },
    get voz() { return vozElegida; }
  };
})();
