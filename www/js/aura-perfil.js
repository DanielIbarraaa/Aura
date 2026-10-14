/* =========================================================
   AURA — Datos de la persona: nombre y fecha de nacimiento

   POR QUÉ SE PIDEN, Y POR QUÉ ESTOS DOS
   No es un formulario de relleno. Cada campo responde a algo:

     - NOMBRE: es como la app se dirige a la persona y es lo que ve su
       especialista cuando acepta la vinculación. Sin él, del otro lado
       aparece un identificador y nadie sabe a quién está atendiendo.

     - FECHA DE NACIMIENTO: dos motivos distintos.
         a) La NOM-004-SSA3-2012 exige que el expediente clínico
            identifique a la persona, y la edad es parte de eso. Si la
            app va a alimentar el seguimiento de un especialista, el
            dato tiene que estar.
         b) La LFPDPPP trata los datos de menores de edad de forma
            distinta: el consentimiento lo otorga quien ejerce la patria
            potestad o la tutela, no el menor. Sin saber la edad, Aura
            no puede ni siquiera plantear la pregunta, y estaría
            recabando datos de salud de un menor sin base legal.

   Se pide la FECHA y no la edad a propósito: la edad caduca sola y a
   los pocos meses el dato es falso.

   LO QUE ESTA CASILLA ES Y LO QUE NO
   Cuando la persona es menor de edad se pide una confirmación de que
   su madre, padre o tutor está enterado y consiente. Eso deja
   CONSTANCIA, no verifica nada: nadie está comprobando que del otro
   lado haya un adulto. Es la misma fuerza que tiene cualquier casilla
   de este tipo en cualquier app.

   Si se quiere eliminar el riesgo en lugar de documentarlo, la única
   vía real es no aceptar menores: poner SOLO_MAYORES en true, abajo.
   Es una decisión de producto, no técnica, y por eso está a la vista.
   ========================================================= */
(function () {
  "use strict";

  /* Ponlo en true para rechazar el registro de menores de 18 en vez de
     pedir el consentimiento de quien ejerce la patria potestad. */
  var SOLO_MAYORES = false;

  var MAYORIA = 18;
  var EDAD_MAX = 120;
  var NOMBRE_MIN = 2;
  var NOMBRE_MAX = 80;   // el mismo tope que valida firestore.rules

  /* ---------- fechas ---------- */

  function hoyISO() {
    var d = new Date();
    // No se usa toISOString: convierte a UTC y en México adelanta el día
    // durante la tarde, con lo que el tope "máximo" aceptaría un mañana.
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + dia;
  }

  function menosAnios(n) {
    var d = new Date();
    d.setFullYear(d.getFullYear() - n);
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + dia;
  }

  /** Edad cumplida a día de hoy. null si la fecha no sirve. */
  function edad(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
    var p = iso.split("-");
    var a = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
    var f = new Date(a, m - 1, d);
    // Rechaza fechas que el constructor "corrige" sola (31 de febrero).
    if (f.getFullYear() !== a || f.getMonth() !== m - 1 || f.getDate() !== d) return null;

    var hoy = new Date();
    var e = hoy.getFullYear() - a;
    var cumplioYa = (hoy.getMonth() > m - 1) ||
                    (hoy.getMonth() === m - 1 && hoy.getDate() >= d);
    if (!cumplioYa) e--;
    return e;
  }

  function esMenor(iso) {
    var e = edad(iso);
    return e !== null && e < MAYORIA;
  }

  /** Revisa nombre y fecha. Devuelve "" si todo está bien, o el motivo. */
  function validar(nombre, nacimiento) {
    var n = String(nombre || "").trim();
    if (n.length < NOMBRE_MIN) return "Escribe tu nombre.";
    if (n.length > NOMBRE_MAX) return "Ese nombre es demasiado largo.";
    if (!/[^\d\s]/.test(n)) return "Ese nombre no parece un nombre.";

    var e = edad(nacimiento);
    if (e === null) return "Revisa tu fecha de nacimiento.";
    if (e < 0) return "Esa fecha todavía no llega.";
    if (e > EDAD_MAX) return "Revisa el año: esa fecha no parece correcta.";
    if (SOLO_MAYORES && e < MAYORIA) {
      return "Aura es para mayores de " + MAYORIA + " años. Si necesitas ayuda ahora, usa el botón SOS.";
    }
    return "";
  }

  /* ---------- ¿hace falta pedirlo? ----------
     Se pregunta por lo que falta, no por cómo entró la persona: quien se
     registró con Google nunca pasó por el formulario de correo, y quien
     creó su cuenta antes de que este paso existiera tampoco. */
  function requiere(estado) {
    if (!estado) return true;
    // Se reutilizan los campos que Configuración ya usaba (name y birth)
    // en vez de crear unos nuevos: dos lugares con el mismo dato terminan
    // siempre en que uno de los dos miente.
    return !String(estado.name || "").trim() || !estado.birth;
  }

  /* ---------- el formulario ---------- */

  var raiz = null;

  function montar() {
    if (raiz) return raiz;
    raiz = document.createElement("div");
    raiz.className = "consent-overlay perfil-overlay";
    raiz.id = "perfilOverlay";
    raiz.innerHTML = [
      '<div class="consent-card glass" role="dialog" aria-modal="true" aria-labelledby="perfilTitulo">',
      '  <h2 id="perfilTitulo">Antes de entrar</h2>',
      '  <p class="consent-intro">Dos datos y listo. Los necesitamos para dirigirnos a ti y para que tu especialista sepa a quién atiende.</p>',
      '',
      '  <label class="perfil-campo">',
      '    <span>¿Cómo te llamas?</span>',
      '    <input type="text" id="perfilNombre" class="input-field" placeholder="Tu nombre" maxlength="' + NOMBRE_MAX + '" autocomplete="name" required>',
      '  </label>',
      '',
      '  <label class="perfil-campo">',
      '    <span>Fecha de nacimiento</span>',
      '    <input type="date" id="perfilNacimiento" class="input-field" required',
      '           min="' + menosAnios(EDAD_MAX) + '" max="' + hoyISO() + '">',
      '    <small id="perfilEdad" class="perfil-edad"></small>',
      '  </label>',
      '',
      '  <div class="perfil-menor" id="perfilMenor" hidden>',
      '    <p><b>Eres menor de edad.</b> La ley pide que quien ejerce la patria potestad o la tutela dé el permiso para tratar tus datos de salud, no tú.</p>',
      '    <label class="consent-check consent-check-sensible">',
      '      <input type="checkbox" id="perfilTutor">',
      '      <span>Mi madre, padre o tutor está enterado de que uso Aura y autoriza el tratamiento de mis datos.</span>',
      '    </label>',
      '  </div>',
      '',
      '  <p class="perfil-error" id="perfilError" role="alert"></p>',
      '',
      '  <div class="consent-acciones">',
      '    <button type="button" class="glass-btn primary block" id="perfilGuardar">Continuar</button>',
      '  </div>',
      '</div>'
    ].join("\n");
    document.body.appendChild(raiz);
    return raiz;
  }

  /**
   * Muestra el formulario y no se resuelve hasta que los datos sirven.
   * No se puede cerrar: es un paso del registro, no un aviso.
   */
  function pedir(previos) {
    var r = montar();
    r.classList.add("abierto");
    document.body.style.overflow = "hidden";

    var iNombre = r.querySelector("#perfilNombre");
    var iFecha  = r.querySelector("#perfilNacimiento");
    var lblEdad = r.querySelector("#perfilEdad");
    var cajaMenor = r.querySelector("#perfilMenor");
    var chkTutor  = r.querySelector("#perfilTutor");
    var elError = r.querySelector("#perfilError");
    var btn = r.querySelector("#perfilGuardar");

    iNombre.value = (previos && previos.nombre) || "";
    iFecha.value  = (previos && previos.nacimiento) || "";
    chkTutor.checked = false;
    elError.textContent = "";

    function pintarEdad() {
      var e = edad(iFecha.value);
      var menor = e !== null && e >= 0 && e < MAYORIA;
      lblEdad.textContent = (e === null || e < 0 || e > EDAD_MAX) ? "" : (e + " años");
      cajaMenor.hidden = !menor || SOLO_MAYORES;
      if (!menor) chkTutor.checked = false;
    }

    iFecha.addEventListener("input", pintarEdad);
    iFecha.addEventListener("change", pintarEdad);
    pintarEdad();

    return new Promise(function (resolve) {
      function intentar() {
        var nombre = iNombre.value.trim();
        var nacimiento = iFecha.value;

        var motivo = validar(nombre, nacimiento);
        if (motivo) { elError.textContent = motivo; return; }

        if (!SOLO_MAYORES && esMenor(nacimiento) && !chkTutor.checked) {
          elError.textContent = "Falta la autorización de tu madre, padre o tutor.";
          return;
        }

        r.classList.remove("abierto");
        document.body.style.overflow = "";

        var persona = {
          nombre: nombre,
          nacimiento: nacimiento,
          menorDeEdad: esMenor(nacimiento),
          registrado: new Date().toISOString()
        };
        // Solo se guarda constancia cuando de verdad aplica: un adulto no
        // arrastra un campo de tutor que no significa nada.
        if (persona.menorDeEdad) persona.tutorAutoriza = true;
        resolve(persona);
      }

      btn.addEventListener("click", intentar);
      iNombre.addEventListener("keydown", function (ev) { if (ev.key === "Enter") intentar(); });
      iFecha.addEventListener("keydown", function (ev) { if (ev.key === "Enter") intentar(); });
      setTimeout(function () { iNombre.focus(); }, 80);
    });
  }

  window.AuraPerfil = {
    MAYORIA: MAYORIA,
    SOLO_MAYORES: SOLO_MAYORES,
    hoyISO: hoyISO,
    edad: edad,
    esMenor: esMenor,
    validar: validar,
    requiere: requiere,
    pedir: pedir
  };
})();
