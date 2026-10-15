/* =========================================================
   AURA — La mascota de aurorIA

   POR QUÉ LA ILUSTRACIÓN Y NO UN SVG DIBUJADO
   Primero se redibujó con trazos a mano. Quedó mal, y con razón: una
   silueta correcta no es el dibujo, y la diferencia se nota de
   inmediato.

   Después se vectorizó automáticamente. Se midió el resultado y fue
   concluyente EN CONTRA: la versión de 472 KB —nueve veces el peso del
   original— seguía perdiendo la textura de galaxia, el degradado del
   cuerpo y el polvo de estrellas. Una ilustración pintada con
   aerógrafo no se vectoriza. Eso es justo lo que el mapa de bits hace
   bien y el vector no.

   Así que manda la ilustración. Va en WebP a 440 px de ancho: 59 KB,
   de sobra para pantallas de 3x al tamaño en que se muestra. Lo único
   que el mapa de bits no sabe hacer —moverse— se le monta encima.

   CÓMO SE LE DA VIDA A UNA IMAGEN PLANA
   Tres capas apiladas:

     1. EL ARTE. Respira y flota con transformaciones de CSS, que el
        navegador resuelve en el compositor sin despertar al hilo
        principal en cada cuadro.

     2. EL PARPADEO. Un recorte de 122x54 px —2 KB— con los ojos
        cerrados, generado a partir de la MISMA ilustración: se
        reconstruyó la piel de atrás interpolando el degradado de
        arriba y abajo del ojo, y encima se dibujó la línea del
        párpado. Aparece 150 ms y se va. Por eso coincide con el dibujo
        en vez de verse como una calcomanía pegada.

     3. LAS LUCES. Un SVG transparente con resplandores puestos EXACTO
        sobre las estrellas pintadas: la de la frente, la del pecho y
        las nueve de la corona. Esas coordenadas no se estimaron a ojo,
        se midieron sobre los píxeles de la imagen buscando los grupos
        de blanco y de dorado.

   CÓMO HABLA UNA CRIATURA SIN BOCA
   El dibujo no tiene boca, y ponérsela lo volvería otra cosa. Habla
   con la ESTRELLA DEL PECHO, que late con cada sílaba. Funciona mejor
   que una boca: se lee a cualquier tamaño —incluso a 90 px de ancho,
   donde una boca serían tres píxeles indistinguibles— y encaja con lo
   que es, algo que se comunica por luz y no por aire.

   ACCESIBILIDAD
   Con prefers-reduced-motion se apaga el vaivén continuo. El pulso al
   hablar se queda, porque ahí el movimiento ES la información: muestra
   quién está hablando. La criatura va aria-hidden — es decorativa, y
   todo lo que aurorIA dice está escrito en el chat.
   ========================================================= */
(function () {
  "use strict";

  var ESTADOS = ["reposo", "escuchando", "pensando", "hablando"];
  var ANIMOS = ["calma", "alegre", "atenta", "suave"];

  /* Intensidades del resplandor del pecho. La primera no es cero: en
     silencio la estrella sigue encendida, nomás tranquila. */
  var PULSOS = [0.9, 1.12, 1.3, 1.5];

  /* Medidas del lienzo y de cada pieza, en coordenadas de la imagen.
     Salieron de analizar los píxeles del dibujo, no de aproximar. */
  var LIENZO = { ancho: 440, alto: 614 };
  var PARCHE = { x: 86.7, y: 139.4, ancho: 122 };
  var FRENTE = { x: 150.1, y: 129.0, r: 16.5 };
  var PECHO  = { x: 144.6, y: 274.6, r: 18.9 };
  var CORONA = [
    { x: 208.0, y: 22.7 },  { x: 284.2, y: 55.7 },  { x: 271.5, y: 227.1 },
    { x: 54.9,  y: 228.7 }, { x: 386.3, y: 130.6 }, { x: 131.3, y: 38.0 },
    { x: 73.8,  y: 73.9 },  { x: 328.4, y: 179.0 }, { x: 78.0,  y: 62.9 }
  ];

  var ARTE = "assets/aurorIA-mascota.webp";
  var OJOS_CERRADOS = "assets/aurorIA-parpadeo.webp";

  var menosMovimiento = function () {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  };

  function pct(v, total) { return (v / total * 100).toFixed(4) + "%"; }

  function dibujo() {
    var glints = CORONA.map(function (s, i) {
      return '    <circle class="m-glint" data-i="' + i + '" cx="' + s.x + '" cy="' + s.y +
             '" r="7" fill="url(#GLoro)"/>';
    }).join("\n");

    return [
      '<img class="m-arte" src="' + ARTE + '" alt="" draggable="false"',
      '     width="' + LIENZO.ancho + '" height="' + LIENZO.alto + '">',
      '<img class="m-parpado" src="' + OJOS_CERRADOS + '" alt="" aria-hidden="true" draggable="false"',
      '     style="left:' + pct(PARCHE.x, LIENZO.ancho) + ';top:' + pct(PARCHE.y, LIENZO.alto) +
      ';width:' + pct(PARCHE.ancho, LIENZO.ancho) + '">',
      '<svg class="m-luces" viewBox="0 0 ' + LIENZO.ancho + ' ' + LIENZO.alto + '"',
      '     aria-hidden="true" focusable="false">',
      '  <defs>',
      '    <radialGradient id="GLblanco">',
      '      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity=".95"/>',
      '      <stop offset="42%"  stop-color="var(--c-cyan-bright, #B3EBF2)" stop-opacity=".5"/>',
      '      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>',
      '    </radialGradient>',
      '    <radialGradient id="GLoro">',
      '      <stop offset="0%"   stop-color="var(--c-gold-soft, #EEDAA2)" stop-opacity=".95"/>',
      '      <stop offset="100%" stop-color="var(--c-gold-soft, #EEDAA2)" stop-opacity="0"/>',
      '    </radialGradient>',
      '  </defs>',
      /* Los resplandores se SUMAN a las estrellas ya pintadas, no las
         sustituyen: por eso el modo de fusión es screen y por eso van
         centrados exactamente donde están las del dibujo. */
      '  <g transform="translate(' + FRENTE.x + ',' + FRENTE.y + ')"><g id="mDestello">',
      '    <circle r="' + (FRENTE.r * 1.35).toFixed(1) + '" fill="url(#GLblanco)"/>',
      '  </g></g>',
      '  <g transform="translate(' + PECHO.x + ',' + PECHO.y + ')"><g id="mPecho">',
      '    <circle r="' + (PECHO.r * 1.3).toFixed(1) + '" fill="url(#GLblanco)"/>',
      '  </g></g>',
      glints,
      '</svg>'
    ].join("\n");
  }

  /* =========================================================
     La instancia
     ========================================================= */

  function crear(contenedor) {
    if (!contenedor) return null;
    contenedor.innerHTML = dibujo();
    contenedor.classList.add("mascota");
    contenedor.style.setProperty("--m-proporcion", LIENZO.ancho + " / " + LIENZO.alto);

    var parpado = contenedor.querySelector(".m-parpado");
    var pecho = contenedor.querySelector("#mPecho");
    var glints = [].slice.call(contenedor.querySelectorAll(".m-glint"));

    var estado = "reposo";
    var relojParpadeo = null;
    var relojPulso = null;
    var relojCierre = null;
    var vivo = true;

    /* ---------- parpadeo ----------
       A intervalos irregulares, entre 2.6 y 7 segundos. Si parpadeara
       cada N exactos se notaría el metrónomo, y eso mata la ilusión
       más rápido que no parpadear. */
    function programarParpadeo() {
      if (!vivo) return;
      clearTimeout(relojParpadeo);
      relojParpadeo = setTimeout(function () {
        parpadear();
        programarParpadeo();
      }, 2600 + Math.random() * 4400);
    }

    function parpadear() {
      if (!vivo || !parpado || menosMovimiento()) return;
      parpado.classList.add("cerrado");
      clearTimeout(relojCierre);
      relojCierre = setTimeout(function () {
        parpado.classList.remove("cerrado");
        // A veces dos seguidos, como de verdad pasa.
        if (Math.random() < 0.22) setTimeout(parpadear, 220);
      }, 150);
    }

    /* ---------- el pulso del pecho: la voz ---------- */
    function pulso(nivel) {
      if (!pecho) return;
      var n = Math.max(0, Math.min(PULSOS.length - 1, nivel | 0));
      pecho.style.transform = "scale(" + PULSOS[n] + ")";
      pecho.style.opacity = n === 0 ? ".2" : String(Math.min(.82, 0.34 + n * 0.16));
    }

    /** Una sílaba: destella a una altura al azar y vuelve a bajar. */
    function silaba() {
      if (!vivo) return;
      // Nunca el máximo dos veces seguidas ni apagado a media palabra:
      // el rango 1-3 es lo que suena a habla continua.
      var n = 1 + Math.floor(Math.random() * 3);
      pulso(n);
      clearTimeout(relojPulso);
      relojPulso = setTimeout(function () { pulso(0); }, 90 + Math.random() * 80);
    }

    /* ---------- estados ---------- */
    function ponerEstado(nuevo) {
      if (ESTADOS.indexOf(nuevo) === -1) return;
      estado = nuevo;
      ESTADOS.forEach(function (e) { contenedor.classList.toggle("es-" + e, e === nuevo); });
      if (nuevo !== "hablando") { clearTimeout(relojPulso); pulso(0); }
      // Las estrellas de la corona se encienden en cascada al pensar;
      // el retardo por índice es lo que hace la ola.
      glints.forEach(function (g, i) { g.style.animationDelay = (i * 0.09) + "s"; });
    }

    function ponerAnimo(a) {
      if (ANIMOS.indexOf(a) === -1) return;
      ANIMOS.forEach(function (x) { contenedor.classList.toggle("an-" + x, x === a); });
    }

    function destruir() {
      vivo = false;
      clearTimeout(relojParpadeo);
      clearTimeout(relojPulso);
      clearTimeout(relojCierre);
      contenedor.innerHTML = "";
      contenedor.classList.remove("mascota");
    }

    ponerEstado("reposo");
    ponerAnimo("calma");
    pulso(0);
    programarParpadeo();

    return {
      elemento: contenedor.querySelector(".m-arte"),
      estado: ponerEstado,
      animo: ponerAnimo,
      silaba: silaba,
      boca: pulso,          // el nombre viejo sigue sirviendo
      pulso: pulso,
      parpadear: parpadear,
      destruir: destruir,
      get estadoActual() { return estado; }
    };
  }

  window.AuraMascota = {
    ESTADOS: ESTADOS,
    ANIMOS: ANIMOS,
    BOCAS: PULSOS,          // compatibilidad con el nombre anterior
    PULSOS: PULSOS,
    LIENZO: LIENZO,
    ARCHIVOS: [ARTE, OJOS_CERRADOS],
    crear: crear,
    menosMovimiento: menosMovimiento
  };
})();
