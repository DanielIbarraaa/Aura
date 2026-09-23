/* =========================================================
   AURA — Consentimiento informado (RF-15)

   POR QUÉ EXISTE
   El ánimo, el diario y las conversaciones son datos personales
   SENSIBLES: revelan estado de salud. El artículo 8 de la LFPDPPP
   exige para ellos "consentimiento expreso y por escrito", y el 16
   fracción II obliga a mostrar en el punto de captura un aviso
   simplificado con las fracciones I a IV del artículo 15.

   Un aviso publicado en el sitio no cumple eso por sí solo. Lo que
   la autoridad revisa es el acto de consentir: que la casilla sea
   específica, que no venga marcada, y que exista registro de cuándo
   se otorgó y sobre qué versión del aviso.

   DOS CASILLAS, NO UNA
   Mezclar "acepto los términos" con "consiento el tratamiento de mis
   datos de salud" convierte el consentimiento en un trámite y lo
   debilita justo donde más importa. Van separadas, y la de datos
   sensibles se puede rechazar sin perder la app entera: quien la
   rechaza conserva Calma, el directorio y el botón SOS.
   ========================================================= */
(function () {
  "use strict";

  /* Subir esto cuando el aviso cambie de forma que afecte finalidades
     o datos tratados. Al subirlo, a todos se les vuelve a pedir. Un
     cambio de redacción no lo amerita; uno de fondo, sí. */
  var VERSION_AVISO = "1.1";

  var URL_AVISO = "https://aura-2027.web.app/aviso-privacidad";
  var URL_TERMINOS = "https://aura-2027.web.app/terminos";

  /* ---------- lectura del estado ---------- */

  function registro(state) {
    return (state && state.consentimiento) || null;
  }

  /** ¿Hay que mostrar la pantalla? */
  function requiere(state) {
    var c = registro(state);
    if (!c || !c.terminos) return true;
    // Aviso con cambios de fondo: se vuelve a pedir.
    return c.versionAviso !== VERSION_AVISO;
  }

  /** ¿Consintió el tratamiento de datos de salud? */
  function tieneSensibles(state) {
    var c = registro(state);
    return !!(c && c.datosSensibles && c.versionAviso === VERSION_AVISO);
  }

  /* ---------- la pantalla ---------- */

  function plantilla() {
    return '' +
'<div class="consent-card glass" role="dialog" aria-modal="true" aria-labelledby="consentTitulo">' +
  '<div class="brand-mark" style="width:42px;height:42px;margin:0 auto 14px;"></div>' +
  '<h2 id="consentTitulo">Antes de empezar</h2>' +
  '<p class="consent-intro">Aura guarda cosas que escribes sobre cómo te sientes. Eso cuenta como información de salud, así que antes de empezar queremos decirte qué guardamos, quién puede verlo y pedirte permiso.</p>' +

  '<div class="consent-cuerpo">' +
    '<h3>Quién responde por tus datos</h3>' +
    '<p><strong id="consentResponsable">Aura</strong><span id="consentDomicilio"></span>. Contacto: <span id="consentCorreo">el correo publicado en el aviso</span>.</p>' +

    '<h3>Qué guardamos</h3>' +
    '<ul>' +
      '<li>Tu nombre y correo.</li>' +
      '<li class="sensible">Tu registro diario de ánimo. <span class="tag-salud">información de salud</span></li>' +
      '<li class="sensible">Tu diario y tus conversaciones con aurorIA, <strong>cifrados en tu teléfono</strong>: llegan a nuestro servidor convertidos en algo que nadie puede leer sin tu código. <span class="tag-salud">información de salud</span></li>' +
      '<li class="sensible">La fecha y hora en que usas el botón SOS. <span class="tag-salud">información de salud</span></li>' +
      '<li>Cuántas veces haces los ejercicios de calma.</li>' +
    '</ul>' +
    '<p class="consent-nota">Lo etiquetado así es <strong>dato personal sensible</strong> para la ley, porque habla de tu salud. Por eso te lo preguntamos aparte.</p>' +

    '<h3>Para qué</h3>' +
    '<ul>' +
      '<li>Para mostrarte tu propio historial y tus gráficas.</li>' +
      '<li>Para que aurorIA pueda responderte.</li>' +
      '<li>Para compartir <strong>solo números</strong> con el especialista que tú elijas: tu promedio de ánimo, cuántas veces respiraste. <strong>Nunca lo que escribiste.</strong></li>' +
    '</ul>' +

    '<h3>Qué puedes hacer en cualquier momento</h3>' +
    '<ul>' +
      '<li>Desvincularte de tu especialista.</li>' +
      '<li>Apagar el modelo de IA en la nube.</li>' +
      '<li>Borrar todos tus datos desde Ajustes.</li>' +
      '<li>Retirar este permiso.</li>' +
    '</ul>' +

    '<p class="consent-enlaces">' +
      '<a href="' + URL_AVISO + '" target="_blank" rel="noopener">Leer el aviso de privacidad completo</a> · ' +
      '<a href="' + URL_TERMINOS + '" target="_blank" rel="noopener">Términos y condiciones</a>' +
    '</p>' +
  '</div>' +

  '<label class="consent-check">' +
    '<input type="checkbox" id="consentTerminos">' +
    '<span>He leído y acepto el <a href="' + URL_AVISO + '" target="_blank" rel="noopener">aviso de privacidad</a> y los <a href="' + URL_TERMINOS + '" target="_blank" rel="noopener">términos</a>. Entiendo que Aura no sustituye a una persona profesional.</span>' +
  '</label>' +

  '<label class="consent-check consent-check-sensible">' +
    '<input type="checkbox" id="consentSensibles">' +
    '<span><strong>Doy mi consentimiento expreso</strong> para que Aura guarde mi ánimo, mi diario y mis conversaciones. Sé que es información de salud, y que el diario y las conversaciones van cifrados: <strong>nadie más puede abrirlos.</strong></span>' +
  '</label>' +
  '<p class="consent-nota">Es tu decisión y puedes cambiarla en Ajustes. Sin marcarla entras igual, con Calma, el directorio y el botón SOS.</p>' +

  '<div class="consent-acciones">' +
    '<button class="glass-btn primary" id="consentAceptar" disabled>Continuar</button>' +
  '</div>' +

  '<button class="consent-sos" id="consentSos" type="button">¿Necesitas ayuda ahora? Abrir apoyo en crisis</button>' +
'</div>';
  }

  var contenedor = null;

  function montar() {
    if (contenedor) return contenedor;
    contenedor = document.createElement("div");
    contenedor.className = "consent-overlay";
    contenedor.id = "consentOverlay";
    contenedor.innerHTML = plantilla();
    document.body.appendChild(contenedor);
    return contenedor;
  }

  /**
   * Muestra la pantalla y espera. Resuelve con el registro a guardar.
   * No se puede cerrar de otra forma: no hay botón de descartar ni
   * cierre por clic fuera. Consentir o no consentir son las opciones;
   * "ignorar" no es una de ellas.
   */
  function pedir(opciones) {
    opciones = opciones || {};
    var raiz = montar();
    raiz.classList.add("abierto");
    document.body.style.overflow = "hidden";

    // El contenedor se reutiliza entre aperturas: sin esto conserva el
    // scroll de la vez anterior y la persona abre a media pagina, sin ver
    // el titulo ni de que se trata.
    var tarjeta = raiz.querySelector(".consent-card");
    var cuerpo = raiz.querySelector(".consent-cuerpo");
    if (tarjeta) tarjeta.scrollTop = 0;
    if (cuerpo) cuerpo.scrollTop = 0;

    // Datos del responsable, si la app los tiene configurados.
    var cfg = (window.AURA_CONFIG && window.AURA_CONFIG.responsable) || null;
    if (cfg) {
      if (cfg.nombre) raiz.querySelector("#consentResponsable").textContent = cfg.nombre;
      if (cfg.domicilio) raiz.querySelector("#consentDomicilio").textContent = ", " + cfg.domicilio;
      if (cfg.correo) raiz.querySelector("#consentCorreo").textContent = cfg.correo;
    }

    var chkT = raiz.querySelector("#consentTerminos");
    var chkS = raiz.querySelector("#consentSensibles");
    var btn = raiz.querySelector("#consentAceptar");
    var sos = raiz.querySelector("#consentSos");

    // Nunca vienen marcadas. Si un dia alguien las premarca en el HTML,
    // esto lo deshace: una casilla premarcada no es consentimiento.
    chkT.checked = false;
    chkS.checked = false;
    btn.disabled = true;

    function revisar() { btn.disabled = !chkT.checked; }
    chkT.addEventListener("change", revisar);

    if (sos && typeof opciones.alPedirSos === "function") {
      sos.addEventListener("click", opciones.alPedirSos);
    }

    return new Promise(function (resolve) {
      btn.addEventListener("click", function () {
        if (!chkT.checked) return;
        var ahora = new Date().toISOString();
        raiz.classList.remove("abierto");
        document.body.style.overflow = "";
        resolve({
          versionAviso: VERSION_AVISO,
          terminos: true,
          datosSensibles: !!chkS.checked,
          aceptadoEn: ahora,
          actualizadoEn: ahora
        });
      });
    });
  }

  /** Cambia solo la casilla de datos sensibles, desde Ajustes.
      Devuelve un objeto NUEVO: mutar el registro que vive en el estado
      hace que el valor viejo y el nuevo sean el mismo objeto, y entonces
      no hay forma de comparar antes/despues ni de deshacer. */
  function actualizarSensibles(state, valor) {
    var previo = registro(state);
    var base = previo
      ? { versionAviso: previo.versionAviso, terminos: previo.terminos,
          datosSensibles: previo.datosSensibles, aceptadoEn: previo.aceptadoEn }
      : { versionAviso: VERSION_AVISO, terminos: true,
          aceptadoEn: new Date().toISOString() };
    base.datosSensibles = !!valor;
    base.versionAviso = VERSION_AVISO;
    base.actualizadoEn = new Date().toISOString();
    return base;
  }

  /** Texto para mostrar en Ajustes. */
  function resumen(state) {
    var c = registro(state);
    if (!c || !c.aceptadoEn) return "Sin registro de consentimiento";
    var f = new Date(c.aceptadoEn);
    var fecha = isNaN(f) ? c.aceptadoEn
      : f.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    return "Aceptado el " + fecha + " · aviso v" + (c.versionAviso || "?");
  }

  window.AuraConsentimiento = {
    VERSION_AVISO: VERSION_AVISO,
    URL_AVISO: URL_AVISO,
    URL_TERMINOS: URL_TERMINOS,
    requiere: requiere,
    tieneSensibles: tieneSensibles,
    pedir: pedir,
    actualizarSensibles: actualizarSensibles,
    resumen: resumen
  };
})();
