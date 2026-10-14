/* =========================================================
   AURA — El puente con los widgets de Android

   EL PROBLEMA
   Un widget de Android no es web. Corre dentro del lanzador, en otro
   proceso, y no tiene WebView: no puede ejecutar nada de esta app ni
   leer su estado. Y al revés, la app no puede dibujar dentro de él.

   Lo único que comparten es el disco. Así que la app deja aquí un
   resumen y el widget lo lee cuando le toca redibujarse.

   POR QUÉ SharedPreferences Y NO OTRA COSA
   @capacitor/preferences ya está instalado en el proyecto, y en
   Android escribe exactamente en SharedPreferences. O sea que el
   puente ya existía sin instalar nada: solo había que usarlo con un
   formato que el lado nativo entienda.

   QUÉ SE GUARDA, Y QUÉ NO
   Solo lo que el widget necesita para dibujarse: el nombre de la
   constelación, sus puntos, cuántas estrellas van y el conteo de días.

   NADA de lo que se escribe aquí es privado en el sentido fuerte. Un
   widget vive en la pantalla de inicio, a la vista de cualquiera que
   levante el teléfono, y SharedPreferences no va cifrado. Por eso aquí
   NO va el ánimo registrado, ni una línea del diario, ni nada de
   aurorIA: el número de días y una figura de estrellas no le dicen a
   nadie cómo está la persona.

   EL CAMINO DE REGRESO
   El widget de ánimo escribe en la misma gaveta una marca con el valor
   y la fecha. La app la recoge al abrirse, la aplica y la borra. Por
   eso el registro hecho desde el widget aparece en la gráfica hasta el
   siguiente arranque: el widget no puede hablar con Firestore, no
   tiene sesión ni SDK.
   ========================================================= */
(function () {
  "use strict";

  /* La misma gaveta que usa @capacitor/preferences por omisión. El
     lado nativo la nombra igual; si algún día se cambia con
     Preferences.configure({group}), hay que cambiarla en los dos
     lados o el widget se queda mudo. */
  var LLAVE_CIELO = "aura_widget_cielo";
  var LLAVE_ANIMO = "aura_widget_animo";

  function enApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
              window.Capacitor.isNativePlatform());
  }

  function prefs() {
    var P = window.Capacitor && window.Capacitor.Plugins;
    return (P && P.Preferences) || null;
  }

  function disponible() { return enApp() && !!prefs(); }

  /**
   * Deja el resumen del cielo para el widget.
   * Los puntos van aplanados —"x,y;x,y"— en vez de como JSON anidado:
   * del lado nativo eso se parsea con un split y sin biblioteca.
   */
  async function publicarCielo(estado) {
    var P = prefs();
    var C = window.AuraCielo;
    if (!P || !C) return false;

    var cielo = C.leer(estado);
    var cons = C.actual(cielo);

    var datos = {
      nombre: cons.nombre,
      alias: cons.alias || "",
      puntos: cons.estrellas.map(function (p) { return p[0] + "," + p[1]; }).join(";"),
      lineas: cons.lineas.map(function (l) { return l[0] + "," + l[1]; }).join(";"),
      encendidas: cielo.estrellas,
      total: cons.estrellas.length,
      dias: cielo.total,
      completadas: cielo.completadas.length,
      // Para que el widget sepa si hoy ya quedó, sin tener que
      // interpretar la lista entera de días.
      hoy: cielo.dias.length ? cielo.dias[cielo.dias.length - 1] : ""
    };

    try {
      await P.set({ key: LLAVE_CIELO, value: JSON.stringify(datos) });
      await refrescar();
      return true;
    } catch (e) {
      console.warn("[Aura widget] no se pudo publicar:", e.message);
      return false;
    }
  }

  /**
   * Recoge el ánimo que se haya registrado desde el widget.
   * Devuelve { valor, fecha } o null. Lo BORRA al leerlo: si se
   * quedara, cada arranque volvería a aplicar el mismo registro.
   */
  async function recogerAnimo() {
    var P = prefs();
    if (!P) return null;
    try {
      var r = await P.get({ key: LLAVE_ANIMO });
      if (!r || !r.value) return null;
      await P.remove({ key: LLAVE_ANIMO });

      var d = JSON.parse(r.value);
      var valor = Number(d.valor);
      // Se valida aunque venga de nuestro propio widget: el archivo de
      // SharedPreferences es un archivo, y un archivo se puede editar.
      if (!(valor >= 1 && valor <= 5)) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || ""))) return null;
      return { valor: Math.round(valor), fecha: d.fecha };
    } catch (e) {
      return null;
    }
  }

  /** Le pide a Android que redibuje los widgets. */
  async function refrescar() {
    if (!enApp()) return;
    var P = window.Capacitor && window.Capacitor.Plugins;
    // El plugin propio que manda el broadcast. Si no está compilado
    // —por ejemplo en una versión vieja del APK— no se cae: los
    // widgets se actualizan solos cada media hora de todos modos.
    if (P && P.AuraWidget && P.AuraWidget.refrescar) {
      try { await P.AuraWidget.refrescar(); } catch (e) {}
    }
  }

  window.AuraWidget = {
    LLAVE_CIELO: LLAVE_CIELO,
    LLAVE_ANIMO: LLAVE_ANIMO,
    disponible: disponible,
    publicarCielo: publicarCielo,
    recogerAnimo: recogerAnimo,
    refrescar: refrescar
  };
})();
