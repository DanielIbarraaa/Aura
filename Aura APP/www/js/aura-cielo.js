/* =========================================================
   AURA — Tu cielo: constancia sin castigo

   POR QUÉ NO ES UNA RACHA
   Una racha motiva por aversión a la pérdida: no la sostienes porque
   sea agradable, la sostienes porque romperla duele. Ese es el
   mecanismo, y funciona — pero apuntado a alguien con ansiedad o
   depresión, "rompí mi racha de 40 días" se lee como una prueba más de
   que no puede sostener nada. La app se vuelve otra cosa en la que
   está fallando.

   Hay dos problemas más. Una racha premia ABRIR la app, no sentirse
   mejor: se puede entrar sesenta días seguidos y estar peor. Y castiga
   justo el desenlace bueno, porque si Aura sirve la persona termina
   necesitándola menos.

   Aquí el progreso solo sube. Cada día con registro enciende una
   estrella; siete estrellas forman una constelación que se guarda en
   el cielo y empieza otra. Faltar no resta, no apaga nada y no se
   menciona. Alguien que desaparece tres semanas —justo cuando peor la
   está pasando— vuelve y encuentra su cielo igual de grande.

   POR QUÉ CONSTELACIONES Y NO ESTRELLAS SUELTAS
   Una estrella por día son trescientas al año: la vista se vuelve un
   amasijo y deja de significar nada. Al cerrarse en grupos de siete,
   lo que se ve en pantalla nunca pasa de siete estrellas y el progreso
   no tiene techo. Se coleccionan constelaciones, no se amontonan
   puntos. Y cada siete días cae un hito real sin que nadie lo fuerce.

   Son constelaciones que de verdad se ven desde México, con los
   nombres con que se conocen aquí.

   LO QUE ESTE ARCHIVO NO HACE, A PROPÓSITO
   No manda notificaciones ni recordatorios. No dice "te extrañamos" ni
   "llevas X días sin entrar". No pone metas. No compara con nadie.
   Cualquiera de esas cosas convierte un registro en una deuda.
   ========================================================= */
(function () {
  "use strict";

  /* Cuántos días de historial se guardan para la vista. El total
     histórico se lleva en un contador aparte, así que recortar esto no
     pierde progreso: solo limita cuánto calendario se puede dibujar. */
  var DIAS_GUARDADOS = 140;

  /* ---------- el catálogo ----------
     Coordenadas en una caja de 0 a 100. Las formas son aproximadas pero
     reconocibles: la idea es que alguien que sepa de estrellas las
     identifique, no levantar una carta celeste. */
  var CONSTELACIONES = [
    {
      id: "pleyades", nombre: "Las Pléyades", alias: "Las Cabrillas",
      nota: "Siete hermanas. A simple vista se ven seis; la séptima hay que buscarla.",
      estrellas: [[30,42],[45,32],[58,39],[50,54],[37,57],[66,49],[23,60]],
      lineas: [[0,1],[1,2],[2,5],[0,4],[4,3],[3,2],[6,4]]
    },
    {
      id: "casiopea", nombre: "Casiopea", alias: "La W",
      nota: "Nunca se oculta: gira alrededor del norte toda la noche.",
      estrellas: [[8,34],[30,66],[52,34],[72,68],[94,38]],
      lineas: [[0,1],[1,2],[2,3],[3,4]]
    },
    {
      id: "orion", nombre: "Orión", alias: "Los Tres Reyes",
      nota: "El cinturón son tres estrellas en línea. Es lo más fácil de encontrar del cielo.",
      estrellas: [[28,20],[68,22],[40,50],[50,50],[60,50],[34,82],[72,80]],
      lineas: [[0,2],[1,4],[2,3],[3,4],[2,5],[4,6],[0,1]]
    },
    {
      id: "carro", nombre: "El Carro", alias: "La Osa Mayor",
      nota: "Sus dos estrellas del frente apuntan siempre a la Estrella Polar.",
      estrellas: [[72,30],[72,52],[56,56],[58,40],[44,36],[30,32],[15,26]],
      lineas: [[0,1],[1,2],[2,3],[3,0],[3,4],[4,5],[5,6]]
    },
    {
      id: "cisne", nombre: "El Cisne", alias: "La Cruz del Norte",
      nota: "Vuela a lo largo de la Vía Láctea.",
      estrellas: [[50,8],[50,44],[50,92],[10,46],[90,40],[50,68]],
      lineas: [[0,1],[1,5],[5,2],[3,1],[1,4]]
    },
    {
      id: "corona", nombre: "La Corona Boreal", alias: "",
      nota: "Un semicírculo de siete estrellas. Se ve pequeña y perfecta.",
      estrellas: [[12,56],[22,38],[36,28],[52,26],[68,32],[80,45],[88,62]],
      lineas: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]]
    },
    {
      id: "escorpion", nombre: "El Escorpión", alias: "",
      nota: "Su corazón es Antares, una estrella roja que se ve a ojo pelón.",
      estrellas: [[20,20],[34,24],[26,34],[42,40],[52,54],[62,68],[74,72]],
      lineas: [[0,2],[1,2],[2,3],[3,4],[4,5],[5,6]]
    },
    {
      id: "lira", nombre: "La Lira", alias: "",
      nota: "Vega, su estrella principal, es de las más brillantes del verano.",
      estrellas: [[46,10],[30,44],[62,50],[38,80],[70,86]],
      lineas: [[0,1],[1,2],[1,3],[2,4],[3,4]]
    }
  ];

  /* ---------- estado ---------- */

  function vacio() {
    return { constelacion: 0, estrellas: 0, completadas: [], dias: [], total: 0 };
  }

  /** Normaliza lo que venga del servidor: nunca confiar en la forma. */
  function leer(estado) {
    var c = (estado && estado.cielo) || {};
    return {
      constelacion: Math.max(0, Math.min(CONSTELACIONES.length - 1, c.constelacion | 0)),
      estrellas: Math.max(0, c.estrellas | 0),
      completadas: Array.isArray(c.completadas) ? c.completadas.slice(0, 400) : [],
      dias: Array.isArray(c.dias) ? c.dias.filter(function (d) {
        return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
      }) : [],
      total: Math.max(0, c.total | 0)
    };
  }

  function actual(cielo) { return CONSTELACIONES[cielo.constelacion] || CONSTELACIONES[0]; }
  function faltan(cielo) { return actual(cielo).estrellas.length - cielo.estrellas; }

  /* ---------- registrar un día ----------
     Devuelve { cielo, nuevaEstrella, completada } — completada trae la
     constelación recién terminada, para poder celebrarla. Si el día ya
     estaba contado no pasa nada: entrar dos veces el mismo día no suma
     dos veces, pero tampoco es un error. */
  function marcarDia(estado, fechaISO) {
    var cielo = leer(estado);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaISO || ""))) {
      return { cielo: cielo, nuevaEstrella: false, completada: null };
    }
    if (cielo.dias.indexOf(fechaISO) !== -1) {
      return { cielo: cielo, nuevaEstrella: false, completada: null };
    }

    cielo.dias = cielo.dias.concat([fechaISO]).sort().slice(-DIAS_GUARDADOS);
    cielo.total += 1;
    cielo.estrellas += 1;

    var completada = null;
    var cons = actual(cielo);
    if (cielo.estrellas >= cons.estrellas.length) {
      completada = { id: cons.id, nombre: cons.nombre, i: cielo.constelacion };
      cielo.completadas = cielo.completadas.concat([{ i: cielo.constelacion, fecha: fechaISO }]);
      cielo.estrellas = 0;
      // Al acabarse el catálogo se vuelve a empezar. Se conserva el
      // registro de las completadas, así que la segunda vuelta no borra
      // nada: se acumulan repetidas, como quien vuelve a ver la misma
      // constelación en otra temporada del año.
      cielo.constelacion = (cielo.constelacion + 1) % CONSTELACIONES.length;
    }
    return { cielo: cielo, nuevaEstrella: true, completada: completada };
  }

  /* ---------- lecturas para la interfaz ---------- */

  function registradoHoy(estado, fechaISO) {
    return leer(estado).dias.indexOf(fechaISO) !== -1;
  }

  /** Cuántos de los últimos N días tienen registro. Se dice así —"4 de
      los últimos 7"— y no como racha: no hay nada que romper. */
  function ultimos(estado, n, hastaISO) {
    var cielo = leer(estado);
    var set = {};
    cielo.dias.forEach(function (d) { set[d] = true; });
    var hasta = new Date(hastaISO + "T12:00:00");
    var cuenta = 0, marcas = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(hasta);
      d.setDate(d.getDate() - i);
      var k = d.getFullYear() + "-" +
              String(d.getMonth() + 1).padStart(2, "0") + "-" +
              String(d.getDate()).padStart(2, "0");
      var hay = !!set[k];
      if (hay) cuenta++;
      marcas.push({ fecha: k, hay: hay, dia: d.getDay() });
    }
    return { cuenta: cuenta, de: n, marcas: marcas };
  }

  /* ---------- dibujo de una constelación ----------
     encendidas = cuántas estrellas van prendidas. Las que faltan se
     dibujan igual pero tenues: se ve a dónde va la cosa sin que la
     ausencia parezca un hueco. */
  function svg(cons, encendidas, opciones) {
    opciones = opciones || {};
    var todas = opciones.todas === true;
    var n = todas ? cons.estrellas.length : encendidas;

    var lineas = cons.lineas.map(function (l) {
      var viva = l[0] < n && l[1] < n;
      var a = cons.estrellas[l[0]], b = cons.estrellas[l[1]];
      return '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] +
             '" class="cielo-linea' + (viva ? " viva" : "") + '"/>';
    }).join("");

    var astros = cons.estrellas.map(function (p, i) {
      var viva = i < n;
      return '<g class="cielo-astro' + (viva ? " viva" : "") + '" data-i="' + i + '"' +
             ' transform="translate(' + p[0] + ',' + p[1] + ')">' +
             '<circle r="6" class="cielo-halo"/>' +
             '<path d="M0 -4.2 C.5 -1.1, 1.1 -.5, 4.2 0 C1.1 .5, .5 1.1, 0 4.2' +
             ' C-.5 1.1, -1.1 .5, -4.2 0 C-1.1 -.5, -.5 -1.1, 0 -4.2 Z" class="cielo-punta"/>' +
             '</g>';
    }).join("");

    /* El encuadre se ajusta a CADA constelación. Con un viewBox fijo,
       las que ocupan una esquina —El Carro— se veían diminutas al lado
       de las que cruzan la caja entera, y la tarjeta parecía mal hecha
       unos días sí y otros no. Se toma el recuadro real y se le deja
       margen para el halo de las estrellas. */
    var xs = cons.estrellas.map(function (p) { return p[0]; });
    var ys = cons.estrellas.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var m = 11;                                  // margen para el halo
    var w = (x1 - x0) + m * 2, h = (y1 - y0) + m * 2;
    // Se cuadra el encuadre para que no se deforme dentro de una caja
    // cuadrada: la constelación se centra en el lado más largo.
    var lado = Math.max(w, h);
    var vx = x0 - m - (lado - w) / 2;
    var vy = y0 - m - (lado - h) / 2;

    return '<svg class="cielo-svg" viewBox="' +
           vx.toFixed(1) + ' ' + vy.toFixed(1) + ' ' + lado.toFixed(1) + ' ' + lado.toFixed(1) +
           '" aria-hidden="true" focusable="false">' + lineas + astros + '</svg>';
  }

  window.AuraCielo = {
    CONSTELACIONES: CONSTELACIONES,
    DIAS_GUARDADOS: DIAS_GUARDADOS,
    vacio: vacio,
    leer: leer,
    actual: actual,
    faltan: faltan,
    marcarDia: marcarDia,
    registradoHoy: registradoHoy,
    ultimos: ultimos,
    svg: svg
  };
})();
