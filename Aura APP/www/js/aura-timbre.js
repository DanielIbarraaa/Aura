/* =========================================================
   AURA — El timbre de aurorIA: lo que la vuelve de otro mundo

   POR QUÉ NO SE PUEDE PROCESAR LA VOZ DIRECTAMENTE
   Lo obvio sería tomar el audio del sintetizador y pasarlo por un
   modulador en anillo o una reverberación: así se hace una voz
   alienígena de verdad. No se puede.

   speechSynthesis no expone su salida. No hay AudioNode, no hay
   MediaStream, no hay buffer — el navegador la manda a la tarjeta de
   sonido por un camino que JavaScript no toca. Con la API gratuita
   solo quedan dos perillas: pitch y rate. Se acabó.

   Para procesar la voz misma harían falta las muestras, y eso implica
   TTS de paga, que ya vimos que se come el margen.

   LO QUE SÍ SE PUEDE, Y ALCANZA
   Web Audio sí está disponible para audio PROPIO. Así que en vez de
   transformar la voz, se le construye un alrededor: un destello corto
   al empezar a hablar y un halo muy tenue mientras habla.

   Funciona porque el oído no separa las dos fuentes. Escucha una voz
   aguda, lenta y envuelta en armónicos que ninguna garganta produce, y
   concluye que quien habla no es de aquí. El truco es viejo y es el
   mismo del cine: el susurro de Darth Vader no está en la actuación,
   está en el respirador.

   SUTIL, NO ESPELUZNANTE
   Aquí alguien puede estar en crisis a las tres de la mañana. El halo
   va a 0.035 de ganancia —al borde de lo audible— y el destello dura
   seis décimas. Suficiente para teñir la voz, lejos de asustar. Si se
   sube, deja de acompañar y empieza a inquietar: probar antes de
   mover los números de abajo.

   Todas las envolventes son rampas. Una ganancia que salta de golpe
   produce un clic audible, y un clic en una app de calma es lo
   contrario de lo que se busca.
   ========================================================= */
(function () {
  "use strict";

  /* ---------- las perillas ---------- */
  var GANANCIA_DESTELLO = 0.16;   // el brillo inicial
  var GANANCIA_HALO     = 0.035;  // el fondo mientras habla: casi nada, a propósito
  var DURACION_DESTELLO = 0.6;    // segundos
  var DETUNE            = 14;     // cents de desafinación entre capas: de aquí sale el batido

  /* Un acorde abierto y agudo. Las quintas y octavas sin tercera no
     suenan ni alegres ni tristes: suenan a "no humano", que es justo el
     punto. La tercera las volvería una campanita de app. */
  var ACORDE = [523.25, 783.99, 1046.50];   // do5, sol5, do6

  var ctx = null;
  var halo = null;
  var encendido = true;

  function contexto() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    return ctx;
  }

  /* El navegador crea el contexto suspendido hasta que hay un gesto.
     Se llama desde el mismo toque que enciende la voz. */
  function despertar() {
    var c = contexto();
    if (!c) return false;
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    return c.state !== "closed";
  }

  function disponible() { return !!(window.AudioContext || window.webkitAudioContext); }

  /* ---------- el destello del principio ----------
     Tres senoidales desafinadas entre sí, con ataque de 40 ms y caída
     larga. El filtro pasabajos le quita el filo para que no pique. */
  function destello() {
    if (!encendido) return;
    var c = contexto();
    if (!c || c.state === "closed") return;
    despertar();

    var ahora = c.currentTime;
    var salida = c.createGain();
    salida.gain.setValueAtTime(0.0001, ahora);
    salida.gain.exponentialRampToValueAtTime(GANANCIA_DESTELLO, ahora + 0.04);
    salida.gain.exponentialRampToValueAtTime(0.0001, ahora + DURACION_DESTELLO);

    var filtro = c.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.setValueAtTime(3200, ahora);
    filtro.Q.value = 0.7;

    salida.connect(filtro);
    filtro.connect(c.destination);

    ACORDE.forEach(function (hz, i) {
      var osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, ahora);
      // Cada capa desafinada en sentido contrario: el batido entre ellas
      // es lo que se oye como "no es un instrumento".
      osc.detune.setValueAtTime((i % 2 ? 1 : -1) * DETUNE * (i + 1), ahora);

      var g = c.createGain();
      g.gain.value = 1 / (i + 1.4);      // los agudos más bajos, o chilla
      osc.connect(g);
      g.connect(salida);

      osc.start(ahora);
      osc.stop(ahora + DURACION_DESTELLO + 0.1);
      // Sin esto, cada frase deja tres osciladores colgados en memoria.
      osc.onended = function () { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
    });

    setTimeout(function () {
      try { salida.disconnect(); filtro.disconnect(); } catch (e) {}
    }, (DURACION_DESTELLO + 0.3) * 1000);
  }

  /* ---------- el halo que acompaña ----------
     Un fondo sostenido mientras habla, con un oscilador lento moviendo
     la afinación. Ese vaivén de medio hertz es lo que hace que no
     suene a sintetizador barato sino a algo respirando. */
  function abrirHalo() {
    if (!encendido || halo) return;
    var c = contexto();
    if (!c || c.state === "closed") return;
    despertar();

    var ahora = c.currentTime;
    var salida = c.createGain();
    salida.gain.setValueAtTime(0.0001, ahora);
    salida.gain.exponentialRampToValueAtTime(GANANCIA_HALO, ahora + 0.5);

    var filtro = c.createBiquadFilter();
    filtro.type = "bandpass";
    filtro.frequency.value = 900;
    filtro.Q.value = 0.6;

    salida.connect(filtro);
    filtro.connect(c.destination);

    var osciladores = [];
    [261.63, 392.00].forEach(function (hz, i) {
      var osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = hz;
      osc.detune.value = (i ? 1 : -1) * DETUNE;

      var lfo = c.createOscillator();
      lfo.frequency.value = 0.4 + i * 0.13;    // distinto para cada capa
      var prof = c.createGain();
      prof.gain.value = 9;                      // cents de vaivén
      lfo.connect(prof);
      prof.connect(osc.detune);

      var g = c.createGain();
      g.gain.value = 0.5;
      osc.connect(g);
      g.connect(salida);

      osc.start(ahora); lfo.start(ahora);
      osciladores.push(osc, lfo);
    });

    halo = { salida: salida, filtro: filtro, osciladores: osciladores };
  }

  function cerrarHalo() {
    if (!halo) return;
    var c = contexto();
    var h = halo;
    halo = null;
    if (!c) return;
    var ahora = c.currentTime;
    try {
      h.salida.gain.cancelScheduledValues(ahora);
      h.salida.gain.setValueAtTime(Math.max(h.salida.gain.value, 0.0001), ahora);
      h.salida.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.45);
    } catch (e) {}
    setTimeout(function () {
      h.osciladores.forEach(function (o) {
        try { o.stop(); o.disconnect(); } catch (e) {}
      });
      try { h.salida.disconnect(); h.filtro.disconnect(); } catch (e) {}
    }, 600);
  }

  function apagar(v) {
    encendido = !!v;
    if (!encendido) cerrarHalo();
  }

  window.AuraTimbre = {
    disponible: disponible,
    despertar: despertar,
    destello: destello,
    abrirHalo: abrirHalo,
    cerrarHalo: cerrarHalo,
    apagar: apagar,
    get encendido() { return encendido; }
  };
})();
