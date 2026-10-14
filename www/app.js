/* =========================================================
   AURA — Logic, Clinical Engine, Calma & SOS Upgrades
   ========================================================= */
(() => {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $all = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  /* toISOString() convierte a UTC, y México va seis horas atrás. Con
     eso, todo lo registrado después de las 18:00 hora local se guardaba
     con la fecha del DÍA SIGUIENTE: la gráfica mostraba el ánimo de la
     noche en la barra de mañana, y un registro a las 8 de la noche del
     lunes y otro a las 9 de la mañana del martes contaban como el mismo
     día. Se arma a mano con los componentes locales. */
  const todayKey = (d = new Date()) => {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + dia;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const STORAGE_KEY = "aura_state_v8";

  const defaultState = () => ({
    name: "",
    email: "",
    phone: "",
    birth: "",
    isLoggedIn: false,
    theme: "light",
    moodLogs: [],
    // Esquema viejo (v1). Se conservan solo para poder migrar; una vez
    // migrado quedan en null y no se vuelven a usar.
    diarySalt: null,
    diaryCheck: null,
    // Boveda v2: DEK envuelta por el codigo de acceso. Ver js/aura-cripto.js
    cripto: null,
    diaryEntries: [],
    auroriaMemory: [],      // EN CLARO, solo en memoria. Nunca se persiste.
    auroriaCifrada: null,   // {iv, ct} — esto si viaja al servidor.
    breathingCycles: 0,
    bubblesPopped: 0,
    tippUses: 0,
    sensoryUses: 0,
    sosEvents: [],
    linkedTherapist: null,
    aiConsent: false,
    // Registro del consentimiento informado (art. 8 y 15 LFPDPPP).
    // { versionAviso, terminos, datosSensibles, aceptadoEn, actualizadoEn }
    consentimiento: null,
    // Se calcula de birth al registrarse. Se guarda aparte porque la edad
    // cambia sola: un menor deja de serlo sin que nadie toque la app, y
    // recalcularlo en cada lectura evita tratarlo como menor de por vida.
    menorDeEdad: false,
    tutorAutoriza: null,    // fecha ISO de la constancia, solo si aplica
    // Apagada a proposito. Esta app se abre en el camion, en la oficina
    // y en la cama de madrugada; en los tres casos un telefono que
    // empieza a hablar solo es un problema, no una funcion.
    vozActiva: false,
    avisoVozVisto: false,
    // Conversar por voz: el micrófono manda audio a un servicio externo,
    // así que va apagado y con su propio aviso la primera vez.
    vozAVoz: false,
    avisoMicVisto: false,
    // Tu cielo: progreso que solo sube. Ver js/aura-cielo.js.
    cielo: null,
    // Recordatorio diario. Lo pone la persona; apagado de fábrica.
    recordatorio: { activo: false, hora: 21, minuto: 0 },
    // Qué se hizo HOY. Solo para palomear la lista; nada de esto
    // condiciona la estrella, que la da el registro de ánimo.
    actividad: { fecha: null, calma: false, chat: false },
    patientId: null
  });

  let state = loadState();
  let diaryKey = null;
  let diaryUnlocked = false;
  let breatheTimer = null;
  let sosBreatheTimer = null;
  let pinBuffer = "";
  let count90Val = 9;

  /* El estado arranca en blanco y se hidrata desde Firestore en cuanto hay
     sesión (ver hidratar()). Lo único que se lee del navegador es el tema,
     porque tiene que aplicarse antes de que Auth resuelva o la pantalla
     parpadea. */
  function loadState() {
    const s = defaultState();
    const t = window.AuraEstado?.tema.leer();
    if (t) s.theme = t;
    return s;
  }

  function saveState() {
    window.AuraEstado?.tema.escribir(state.theme);
    window.AuraEstado?.guardar(state);
  }

  /* Trae lo que hay en la nube y, la primera vez, sube lo que quedó en el
     teléfono de la versión anterior. Si la nube ya tiene datos, gana la nube:
     el usuario pudo haber seguido en otro dispositivo. */
  async function hidratar(u) {
    if (!u || !u.uid || !window.AuraEstado) return;
    try {
      const nube = await window.AuraEstado.cargar(u.uid);
      const r = await window.AuraEstado.migrar(nube);
      if (r.estado) Object.assign(state, r.estado);
      if (r.migrado) toast("Tus datos se movieron a tu cuenta");

      state.isLoggedIn = true;
      state.patientId = u.uid;
      if (u.nombre && !state.name) state.name = u.nombre;
      if (u.email) state.email = u.email;

      diaryKey = null;
      diaryUnlocked = false;
      pinBuffer = "";

      // El consentimiento va ANTES de pintar nada: si la persona no ha
      // consentido el tratamiento de sus datos de salud, no tiene por que
      // ver primero sus graficas y despues el formulario.
      await revisarConsentimiento();
      await revisarPerfil();
      await recogerAnimoDelWidget();
      await escucharEnlaces();
      aplicarAnimoPendiente();   // por si el enlace llegó antes de la sesión
      window.AuraWidget?.publicarCielo(state);

      applyTheme(state.theme);
      renderHome();
      renderSettings();
      renderLink();
      renderDiary();
      drawChart();
      computeClinicalData();
      pintarSesion();
      saveState();
      pintarFoto();            // no se espera: la app ya es usable sin ella
    } catch (e) {
      console.warn("[Aura] no se pudo cargar el estado:", e.message);
      toast("Sin conexión: tus cambios se guardarán al volver la señal");
    }
  }

  /* El puente con el vigilante de index.html. Desde aquí ya hay toast,
     así que los fallos que se guardaron durante la carga —y los que
     lleguen después— se pueden enseñar en vez de quedarse en la consola
     de un teléfono que nadie está mirando. */
  window.__auraMostrarFallo = function (que, detalle) {
    try { toast((que === "promesa" ? "Algo falló: " : "Error: ") + detalle); } catch (e) {}
  };

  function toast(msg) {
    const wrap = $("#toastWrap");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span>${msg}</span>`;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  /* Gestión de Temas */
  function applyTheme(theme) {
    const isDark = theme === "dark";
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    const sw = $("#themeSwitch");
    if (sw) sw.classList.toggle("on", isDark);

    $all(".theme-icon-sun").forEach(e => e.classList.toggle("hidden", isDark));
    $all(".theme-icon-moon").forEach(e => e.classList.toggle("hidden", !isDark));
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    saveState();
    applyTheme(state.theme);
  }

  /* Autenticación real (Firebase Auth) con respaldo local */
  function pintarSesion() {
    const u = window.AuraAuth?.usuario;
    const correo = $("#userSessionEmail");
    const estado = $("#userSessionStatus");
    if (correo) correo.textContent = u?.email || state.name || "Cuenta conectada";
    if (estado) {
      estado.textContent = !u ? "Sin sesión"
        : u.proveedor === "local" ? "Sesión local, sin sincronizar"
        : u.anonimo ? "Sesión antigua sin cuenta · crea una para no perder tus datos"
        : "Sesión con Google";
    }
  }

  function cerrarOverlay() {
    $("#authOverlay")?.classList.add("hidden");
    renderHome();
    renderSettings();
    renderLink();
    pintarSesion();
  }

  function errorAuth(e) {
    const m = String(e?.code || e?.message || e);
    if (m.includes("popup-closed") || m.includes("cancelled")) return "Cerraste la ventana de Google.";
    if (m.includes("popup-blocked")) return "El navegador bloqueó la ventana. Permite las emergentes e inténtalo de nuevo.";
    if (m.includes("network")) return "Sin conexión. Puedes entrar como invitado.";
    if (m.includes("operation-not-allowed")) return "Falta activar Google en Firebase → Authentication.";
    if (m.includes("plugin nativo")) return "En la app de Android entra con tu correo; Google solo funciona en el navegador.";
    if (m.includes("email-already-in-use")) return "Ya existe una cuenta con ese correo. Entra en vez de crearla.";
    if (m.includes("invalid-credential") || m.includes("wrong-password") || m.includes("user-not-found")) return "Correo o contraseña incorrectos.";
    if (m.includes("invalid-email")) return "Ese correo no tiene un formato válido.";
    if (m.includes("weak-password")) return "La contraseña necesita al menos 6 caracteres.";
    if (m.includes("too-many-requests")) return "Demasiados intentos. Espera unos minutos.";
    if (m.includes("provider-already-linked") || m.includes("credential-already-in-use")) return "Ese correo ya está vinculado a otra cuenta.";
    if (m.includes("no está configurado")) return "Firebase aún no está configurado. Entra como invitado.";
    return "No se pudo entrar. Inténtalo otra vez.";
  }

  function initAuth() {
    const authOverlay = $("#authOverlay");
    if (!authOverlay) return;

    authOverlay.classList.toggle("hidden", !!state.isLoggedIn);

    // Si Firebase ya tiene sesión de una apertura anterior, se respeta.
    window.AuraAuth?.alCambiar((u) => {
      if (u) {
        state.isLoggedIn = true;
        cerrarOverlay();
        hidratar(u);
      }
      pintarSesion();
    });
    window.AuraAuth?.init();

    const btnG = $("#googleLoginBtn");
    btnG?.addEventListener("click", async () => {
      const txt = btnG.querySelector("span");
      const antes = txt ? txt.textContent : "";
      btnG.disabled = true;
      if (txt) txt.textContent = "Conectando…";
      try {
        const u = await window.AuraAuth.entrarConGoogle();
        cerrarOverlay();
        await hidratar(u);
        toast("Sesión iniciada con Google");
      } catch (e) {
        toast(errorAuth(e));
      } finally {
        btnG.disabled = false;
        if (txt) txt.textContent = antes;
      }
    });

    // Google no existe dentro del APK sin el plugin nativo: se oculta en vez
    // de dejar un botón que solo sabe fallar.
    if (window.AuraAuth && !window.AuraAuth.googleDisponible) {
      btnG?.classList.add("hidden");
      $("#dividerCorreo")?.classList.add("hidden");
    }

    // Correo y contraseña: mismo comportamiento en navegador y en el APK.
    let modoRegistro = false;
    const campoNombre = $("#loginNombre");
    const campoFecha = $("#loginNacimientoCampo");
    const inputFecha = $("#loginNacimiento");
    const btnEnviar = $("#emailSubmitBtn");
    const btnToggle = $("#toggleRegistro");

    // Sin tope, el selector de fecha acepta el año 3025. Se pone aqui y no
    // en el HTML porque depende de que dia es hoy.
    const Perfil = () => window.AuraPerfil;
    if (Perfil()) {
      const tope = Perfil().hoyISO();
      if (inputFecha) inputFecha.max = tope;
      const sb = $("#settingsBirth");
      if (sb) sb.max = tope;
    }

    function pintarModo() {
      campoNombre?.classList.toggle("hidden", !modoRegistro);
      campoFecha?.classList.toggle("hidden", !modoRegistro);
      if (btnEnviar) btnEnviar.textContent = modoRegistro ? "Crear cuenta" : "Entrar";
      if (btnToggle) btnToggle.textContent = modoRegistro ? "Ya tengo cuenta" : "Crear una cuenta";
      const pass = $("#loginPass");
      if (pass) pass.autocomplete = modoRegistro ? "new-password" : "current-password";
    }

    btnToggle?.addEventListener("click", () => { modoRegistro = !modoRegistro; pintarModo(); });

    $("#emailLoginForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#loginEmail")?.value.trim();
      const pass = $("#loginPass")?.value;
      const nombre = campoNombre?.value.trim();
      const nacimiento = inputFecha?.value || "";
      if (!email || !pass) return;

      // Al registrarse los dos datos son obligatorios. Se revisan ANTES de
      // crear la cuenta: si se validaran despues, un nombre en blanco
      // dejaria una cuenta ya creada a medio llenar.
      if (modoRegistro && Perfil()) {
        const motivo = Perfil().validar(nombre, nacimiento);
        if (motivo) { toast(motivo); return; }
      }

      const antes = btnEnviar ? btnEnviar.textContent : "";
      if (btnEnviar) { btnEnviar.disabled = true; btnEnviar.textContent = "Un momento…"; }
      try {
        const u = modoRegistro
          ? await window.AuraAuth.registrarConCorreo(nombre, email, pass, { nacimiento })
          : await window.AuraAuth.entrarConCorreo(email, pass);
        state.isLoggedIn = true;
        state.patientId = u.uid || state.patientId;
        if (u.nombre) state.name = u.nombre;
        if (modoRegistro && nacimiento) {
          state.birth = nacimiento;
          state.menorDeEdad = Perfil() ? Perfil().esMenor(nacimiento) : false;
        }
        saveState();
        cerrarOverlay();
        await hidratar(u);
        toast(modoRegistro ? "Cuenta creada" : "Sesión iniciada");
      } catch (err) {
        toast(errorAuth(err));
      } finally {
        if (btnEnviar) { btnEnviar.disabled = false; btnEnviar.textContent = antes; }
      }
    });

    $("#olvidePass")?.addEventListener("click", async () => {
      const email = $("#loginEmail")?.value.trim();
      if (!email) { toast("Escribe tu correo arriba y vuelve a tocar aquí."); return; }
      try {
        await window.AuraAuth.recuperarContrasena(email);
        toast("Te enviamos un enlace para restablecerla.");
      } catch (err) {
        toast(errorAuth(err));
      }
    });

    $("#btnLogout")?.addEventListener("click", async () => {
      if (!confirm("Cerrar sesión. Tu diario cifrado se queda en este teléfono, no se borra. ¿Continuar?")) return;
      await window.AuraEstado?.sincronizarYa();
      await window.AuraAuth?.salir();
      state = defaultState();
      state.isLoggedIn = false;
      saveState();
      $("#authOverlay")?.classList.remove("hidden");
      pintarSesion();
      toast("Sesión cerrada");
    });

    pintarSesion();
  }

  const SCREENS = ["inicio", "diario", "auroria", "calma", "especialistas", "ajustes"];
  function showScreen(name) {
    if (!SCREENS.includes(name)) name = "inicio";
    // Cambiar de pantalla calla a aurorIA. Sin esto sigue hablando sola
    // desde una pantalla que ya nadie esta viendo.
    if (name !== "auroria") {
      callarMascota();
      // El micrófono no se queda abierto en una pantalla que nadie ve.
      window.AuraEscucha?.cancelar();
      if (typeof pintarEscucha === "function") pintarEscucha(false);
    }
    SCREENS.forEach(s => {
      const el = $(`#screen-${s}`);
      if (el) el.classList.toggle("active", s === name);
    });
    $all(".tabbar button:not(.tabbar-sos-btn)").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
    $all(".desktop-nav button").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

    if (name === "inicio") renderHome();
    if (name === "diario") renderDiary();
    if (name === "auroria") renderAurorIA();
    if (name === "calma") initCanvasOnce();
    if (name === "especialistas") window.AuraDirectorio?.render();
    if (name === "ajustes") renderSettings();
    location.hash = "#/" + name;
  }

  /* =========================================================
     Tu cielo
     ========================================================= */

  const Cielo = () => window.AuraCielo;

  /** Pone en cero la actividad del día cuando cambia la fecha. */
  function actividadDeHoy() {
    const hoy = todayKey();
    if (!state.actividad || state.actividad.fecha !== hoy) {
      state.actividad = { fecha: hoy, calma: false, chat: false };
    }
    return state.actividad;
  }

  /** Marca que hoy se usó Calma o se habló con aurorIA. */
  function marcarActividad(cual) {
    const a = actividadDeHoy();
    if (a[cual]) return;            // ya estaba: no se vuelve a guardar
    a[cual] = true;
    saveState();
    if ($("#screen-inicio")?.classList.contains("active")) renderCielo();
  }

  /**
   * Enciende la estrella del día. Se llama SOLO al registrar el ánimo.
   * Entrar dos veces el mismo día no suma dos veces y tampoco es error.
   */
  function encenderEstrella() {
    const C = Cielo();
    if (!C || !puedeTratarSensibles()) return;

    const r = C.marcarDia(state, todayKey());
    if (!r.nuevaEstrella) return;

    state.cielo = r.cielo;
    saveState();
    renderCielo(true);
    window.AuraWidget?.publicarCielo(state);

    if (r.completada) {
      // El único momento en que esto celebra algo. No hay mensajes por
      // faltar, así que este tiene espacio para significar.
      toast("Completaste " + r.completada.nombre);
      // Celebración, no empujón: sale porque la persona acaba de
      // terminar algo, nunca porque haya dejado de entrar.
      window.AuraRecordatorio?.celebrar(r.completada.nombre, r.completada.i);
    }
  }

  /* ---------- lo que se registró desde el widget ----------
     El widget no tiene sesión de Firebase ni forma de escribir en
     Firestore: apunta el ánimo en disco y la app lo recoge aquí, al
     arrancar. Por eso un registro hecho desde la pantalla de inicio
     aparece en la gráfica hasta el siguiente arranque. */
  /* ---------- lo que llega desde el widget de iOS ----------
     En Android el widget escribe el ánimo en disco y la app lo recoge al
     arrancar. En iOS no hay disco compartido —eso necesita un App Group,
     que Apple no da a cuentas personales— así que el widget hace lo
     único que sí puede: abrir la app con el ánimo en la URL.

     El enlace puede llegar en dos momentos muy distintos:
       - con la app ya abierta, por el evento appUrlOpen
       - con la app cerrada, y entonces la URL es la de arranque
     Y puede llegar antes de que haya sesión o consentimiento. Por eso se
     guarda como pendiente y se aplica cuando de verdad se puede; si no,
     el toque se perdería en silencio, que es la peor forma de fallar. */
  let animoPendiente = null;

  function atenderEnlace(url) {
    if (!url) return;
    const m = String(url).match(/^aura:\/\/animo(?:\?valor=([1-5]))?/i);
    if (!m) return;
    showScreen("diario");
    if (m[1]) { animoPendiente = Number(m[1]); aplicarAnimoPendiente(); }
  }

  function aplicarAnimoPendiente() {
    if (animoPendiente == null) return;
    if (!state.isLoggedIn || !puedeTratarSensibles()) return;   // se queda esperando

    const v = animoPendiente;
    animoPendiente = null;

    const hoy = todayKey();
    const idx = state.moodLogs.findIndex(m => m.date === hoy);
    if (idx >= 0) state.moodLogs[idx].value = v; else state.moodLogs.push({ date: hoy, value: v });
    saveState();

    const s = $("#moodRange");
    if (s) s.value = v;
    pintarAnimo(v);
    drawChart();
    computeClinicalData();
    encenderEstrella();
    toast(`Registrado: ${ANIMOS[v].texto}`);
  }

  /** Engancha el widget de iOS. El plugin App ya está en el proyecto. */
  async function escucharEnlaces() {
    const A = window.Capacitor?.Plugins?.App;
    if (!A) return;
    try {
      A.addListener("appUrlOpen", (ev) => atenderEnlace(ev && ev.url));
      // La app venía cerrada: la URL que la despertó llega por aquí.
      const inicio = await A.getLaunchUrl();
      if (inicio && inicio.url) atenderEnlace(inicio.url);
    } catch (e) { console.warn("[Aura enlace]", e.message); }
  }

  async function recogerAnimoDelWidget() {
    const W = window.AuraWidget;
    if (!W || !W.disponible() || !puedeTratarSensibles()) return;

    const m = await W.recogerAnimo();
    if (!m) return;

    // Si ese día ya tenía registro en la app, gana el de la app: se
    // hizo con más contexto que un toque en la pantalla de inicio.
    const idx = state.moodLogs.findIndex(x => x.date === m.fecha);
    if (idx >= 0) return;

    state.moodLogs.push({ date: m.fecha, value: m.valor });
    saveState();
    if (m.fecha === todayKey()) encenderEstrella();
    drawChart();
    computeClinicalData();
    pintarAnimo(m.valor);
    toast("Se registró lo que marcaste en la pantalla de inicio");
  }

  const TAREAS = [
    { id: "animo",  clave: true,  texto: "Registrar cómo te sientes" },
    { id: "diario", clave: false, texto: "Escribir en tu diario" },
    { id: "calma",  clave: false, texto: "Un ejercicio de Calma" },
    { id: "chat",   clave: false, texto: "Platicar con aurorIA" }
  ];

  function hechoHoy() {
    const hoy = todayKey();
    const a = actividadDeHoy();
    return {
      animo:  state.moodLogs.some(m => m.date === hoy),
      diario: state.diaryEntries.some(e => e.date === hoy),
      calma:  !!a.calma,
      chat:   !!a.chat
    };
  }

  function renderCielo(recienEncendida) {
    const C = Cielo();
    const tarjeta = $("#cieloCard");
    if (!C || !tarjeta) return;

    // Es progreso sobre datos de salud: sin consentimiento no se muestra.
    if (!puedeTratarSensibles()) { tarjeta.classList.add("hidden"); return; }
    tarjeta.classList.remove("hidden");

    const cielo = C.leer(state);
    const cons = C.actual(cielo);
    const total = cons.estrellas.length;
    const hecho = hechoHoy();

    $("#cieloNombre").textContent = cons.nombre + (cons.alias ? " · " + cons.alias : "");
    $("#cieloNota").textContent = cons.nota;
    $("#cieloDias").textContent = cielo.total;
    $("#cieloDiasTxt").textContent = cielo.total === 1 ? "día" : "días";

    const mapa = $("#cieloMapa");
    if (mapa) {
      mapa.innerHTML = C.svg(cons, cielo.estrellas);
      if (recienEncendida && cielo.estrellas > 0) {
        mapa.querySelector('.cielo-astro[data-i="' + (cielo.estrellas - 1) + '"]')
            ?.classList.add("nueva");
      }
    }

    /* El texto NUNCA menciona lo que falta como carencia. "Van 3 de 7"
       describe; "te faltan 4" reclama. */
    const p = $("#cieloProgreso");
    if (p) {
      const ult = C.ultimos(state, 7, todayKey());
      p.innerHTML = cielo.estrellas === 0
        ? "Empieza una constelación nueva. <b>" + total + " días</b> la completan."
        : "Van <b>" + cielo.estrellas + " de " + total + "</b> estrellas · " +
          ult.cuenta + " de los últimos 7 días";
    }

    const lista = $("#cieloLista");
    if (lista) {
      lista.innerHTML = TAREAS.map(t =>
        '<li class="' + (hecho[t.id] ? "hecho" : "") + (t.clave ? " clave" : "") + '">' +
        '<span class="cielo-marca"><svg class="icon"><use href="#i-check"/></svg></span>' +
        '<span>' + t.texto + (t.clave && !hecho[t.id] ? " — enciende tu estrella" : "") + '</span>' +
        '</li>').join("");
    }

    const ganadas = $("#cieloGanadas");
    if (ganadas) {
      const hechas = cielo.completadas.slice(-6).reverse();
      ganadas.hidden = hechas.length === 0;
      if (hechas.length) {
        const mas = cielo.completadas.length - hechas.length;
        ganadas.innerHTML = hechas.map(c => {
          const k = C.CONSTELACIONES[c.i];
          return '<span class="cielo-ganada"><span class="pt">✦</span>' + (k ? k.nombre : "—") + '</span>';
        }).join("") + (mas > 0 ? '<span class="cielo-ganadas-mas">y ' + mas + ' más</span>' : "");
      }
    }
  }

  /* Mini Análisis Clínico */
  function computeClinicalData() {
    const moods = state.moodLogs.slice(-14);
    let variance = null;
    let avgMood = 0;
    if (moods.length > 0) {
      avgMood = (moods.reduce((acc, m) => acc + m.value, 0) / moods.length).toFixed(1);
    }

    let stability = "Sin suficientes registros";
    if (moods.length >= 3) {
      const vals = moods.map(m => m.value);
      const mean = vals.reduce((a, b) => a + b) / vals.length;
      variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
      if (variance < 0.6) stability = "Alta / Regulación Favorable";
      else if (variance < 1.4) stability = "Moderada / Fluctuación Habitual";
      else stability = "Baja / Alta Inestabilidad Reactiva";
    }

    const anxietyWords = ["ansiedad", "miedo", "nervios", "pánico", "bloqueo", "evitar", "temblor", "vergüenza", "juzgar"];
    const termFreq = {};
    let mentionCount = 0;
    state.auroriaMemory.forEach(m => {
      if (m.sender === "me") {
        const t = m.text.toLowerCase();
        anxietyWords.forEach(w => {
          if (t.includes(w)) { mentionCount++; termFreq[w] = (termFreq[w] || 0) + 1; }
        });
      }
    });

    const clinStab = $("#clinStability");
    const clinAnx = $("#clinAnxietyFreq");
    const clinAvg = $("#clinMoodAvg");
    const clinBreath = $("#clinBreathTotal");

    if (clinStab) clinStab.textContent = stability;
    if (clinAnx) clinAnx.textContent = `${mentionCount} menciones`;
    if (clinAvg) clinAvg.textContent = moods.length ? `${avgMood} / 5.0` : "Sin datos";
    if (clinBreath) clinBreath.textContent = `${state.breathingCycles} sesiones`;

    const summary = $("#clinSummaryText");
    if (summary) {
      if (mentionCount > 4 && avgMood < 2.5 && moods.length) {
        summary.textContent = "Alerta clínica: Se detecta rumiación recurrente y bajo estado de ánimo generalizado. Recomendable abordar reestructuración cognitiva y exposición gradual.";
      } else if (mentionCount > 0 || moods.length) {
        summary.textContent = "Patrón regulado: El paciente hace uso de técnicas de relajación y mantiene un registro activo, facilitando el seguimiento en consulta.";
      } else {
        summary.textContent = "El reporte clínico se actualiza conforme registras entradas en tu diario y estados de ánimo diarios.";
      }
    }

    // Solo números y conteos: nada de texto del diario ni del chat.
    return {
      moodAvg14: moods.length ? Number(avgMood) : null,
      moodCurve: state.moodLogs.slice(-30),
      stabilityLabel: stability,
      stabilityVariance: variance === null ? null : Number(variance.toFixed(3)),
      clinicalTermFreq: termFreq,
      clinicalTermTotal: mentionCount,
      breathingCycles: state.breathingCycles,
      tippUses: state.tippUses || 0,
      sensoryUses: state.sensoryUses || 0,
      bubblesPopped: state.bubblesPopped,
      diaryEntryCount: state.diaryEntries.length,
      sosEvents: (state.sosEvents || []).slice(-20),
      updatedAt: new Date().toISOString()
    };
  }

  function pushMetrics(reason) {
    if (!state.linkedTherapist || !window.AuraSync) return;
    try { window.AuraSync.publish(computeClinicalData(), reason); } catch (e) { console.warn("[Aura] sync:", e); }
  }

  function renderHome() {
    // El analisis clinico y la curva de animo son datos de salud: sin
    // consentimiento no se calculan ni se muestran.
    const ok = puedeTratarSensibles();
    $("#clinicalCardContainer")?.classList.toggle("hidden", !ok);
    $("#chartCardContainer")?.classList.toggle("hidden", !ok);
    const hueco = $("#inicioSinConsent");
    if (hueco) {
      hueco.classList.toggle("hidden", ok);
      if (!ok && !hueco.innerHTML) hueco.innerHTML = tarjetaSinConsentimiento("tu estado de ánimo");
    }

    renderCielo();

    const hour = new Date().getHours();
    const salute = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
    const greetingEl = $("#homeGreeting");
    if (greetingEl) greetingEl.textContent = state.name ? `${salute}, ${state.name}` : salute;
    drawChart();
    computeClinicalData();
  }

  /* Los cinco estados del deslizador. El icono cambia con el valor: sin
     eso el circulo de arriba era el mismo dibujo siempre, y la unica
     senal de que algo cambiaba era la posicion del pulgar. */
  const ANIMOS = {
    1: { texto: "Muy bajo",  icono: "i-alert-triangle", color: "#D65A7A" },
    2: { texto: "Bajo",      icono: "i-moon",           color: "#B57BA6" },
    3: { texto: "Neutral",   icono: "i-bar-chart",      color: "#867BB8" },
    4: { texto: "Bien",      icono: "i-sun",            color: "#7BA8B8" },
    5: { texto: "Muy bien",  icono: "i-sparkles",       color: "#5FA88F" }
  };

  function pintarAnimo(valor) {
    const a = ANIMOS[valor] || ANIMOS[3];
    const etiqueta = $("#moodLabel");
    const cara = $("#moodFaceIcon");
    if (etiqueta) { etiqueta.textContent = a.texto; etiqueta.style.color = a.color; }
    if (cara) {
      cara.querySelector("use")?.setAttribute("href", "#" + a.icono);
      cara.style.color = a.color;
    }
    const cont = $(".mood-face");
    if (cont) cont.style.borderColor = a.color;
  }

  /** Pone el deslizador en el valor de hoy, o en 3 si aun no hay. */
  function sincronizarAnimo() {
    const s = $("#moodRange");
    if (!s) return;
    const hoy = state.moodLogs.find(m => m.date === todayKey());
    const v = hoy ? hoy.value : 3;
    s.value = String(v);
    pintarAnimo(v);
  }

  /* El lienzo depende del ancho, asi que al redimensionar hay que
     rehacerlo. Con debounce: sin el, arrastrar el borde de la ventana
     dispara cientos de redibujos. */
  let temporizadorGrafica = null;
  addEventListener("resize", () => {
    clearTimeout(temporizadorGrafica);
    temporizadorGrafica = setTimeout(() => drawChart(), 180);
  });

  function drawChart() {
    const svg = $("#moodChart");
    if (!svg) return;

    /* Margenes distintos por lado: a la izquierda cabe la escala 1-5 y
       abajo las fechas. Antes el padding era uniforme y no habia espacio
       para ninguna de las dos, por eso la grafica era una linea suelta
       sin nada que dijera cuando ni cuanto. */
    /* El lienzo se elige segun el ancho REAL disponible. Con un viewBox
       fijo y proporcion 720x210, en una tarjeta ancha la grafica se
       quedaba corta de alto y sobraba aire a los lados; en el telefono
       pasaba lo contrario. Medir el contenedor resuelve las dos. */
    const anchoCaja = (svg.parentNode?.getBoundingClientRect().width) || 720;
    const angosto = anchoCaja < 520;
    // El viewBox marca la proporcion, y con height:auto esa proporcion
    // decide el alto en pixeles. Con un viewBox de 720x210 fijo, una
    // tarjeta de 1450px daba 424px de alto: una grafica de animo no
    // necesita ser mas alta que un parrafo. Tres bandas mantienen la
    // proporcion sensata en cada tamano.
    const w = angosto ? 380 : (anchoCaja > 1100 ? 1280 : 720);
    const h = angosto ? 200 : (anchoCaja > 1100 ? 250 : 210);
    const mIzq = angosto ? 26 : 30, mDer = 14, mArr = 14, mAba = 30;
    const anchoUtil = w - mIzq - mDer;
    const altoUtil  = h - mArr - mAba;

    const DIAS = 30;
    const hoy = new Date();
    const serie = [];
    for (let i = DIAS - 1; i >= 0; i--) {
      const d = new Date(hoy);
      d.setDate(d.getDate() - i);
      const key = todayKey(d);
      const found = state.moodLogs.find(m => m.date === key);
      serie.push({ fecha: d, key, value: found ? found.value : null });
    }

    const conDato = serie.filter(d => d.value !== null);

    if (!conDato.length) {
      svg.style.display = "none";
      let vacio = $("#chartEmptyMsg");
      if (!vacio) {
        vacio = document.createElement("div");
        vacio.id = "chartEmptyMsg";
        vacio.className = "chart-empty-state";
        vacio.innerHTML = `<svg class="icon icon-sm"><use href="#i-bar-chart"/></svg><span>Aún no hay registros de ánimo guardados</span>`;
        svg.parentNode.appendChild(vacio);
      }
      const res = $("#chartResumen");
      if (res) res.textContent = "";
      return;
    }
    svg.style.display = "block";
    $("#chartEmptyMsg")?.remove();

    const paso = anchoUtil / Math.max(DIAS - 1, 1);
    const px = i => mIzq + i * paso;
    const py = v => mArr + altoUtil - ((v - 1) / 4) * altoUtil;

    /* ---------- escala vertical ---------- */
    let rejilla = "";
    for (let v = 1; v <= 5; v++) {
      const y = py(v);
      rejilla += `<line x1="${mIzq}" y1="${y.toFixed(1)}" x2="${w - mDer}" y2="${y.toFixed(1)}"
                    stroke="currentColor" stroke-opacity="${v === 1 ? '.28' : '.12'}" stroke-width="1"/>`;
      rejilla += `<text x="${mIzq - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end"
                    font-size="11.5" fill="currentColor" fill-opacity=".6">${v}</text>`;
    }

    /* ---------- fechas: cinco marcas, no treinta ---------- */
    const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    let ejeX = "";
    const marcas = angosto ? 3 : (anchoCaja > 1100 ? 7 : 5);
    const cada = Math.max(1, Math.floor((DIAS - 1) / (marcas - 1)));
    // "hoy" siempre va al final; las marcas regulares que le caerian encima
    // se omiten. Dos etiquetas superpuestas no se leen ni una ni otra.
    const zonaHoy = (w - mDer) - (angosto ? 38 : 46);
    for (let i = 0; i < DIAS; i += cada) {
      const x = px(i);
      if (x > zonaHoy) continue;
      const d = serie[i].fecha;
      // La primera va anclada al inicio, no centrada: centrada se salia
      // hacia la izquierda y se encimaba con el "1" de la escala vertical.
      const anclaje = i === 0 ? "start" : "middle";
      ejeX += `<text x="${x.toFixed(1)}" y="${h - 10}" text-anchor="${anclaje}"
                 font-size="11.5" fill="currentColor" fill-opacity=".6">${d.getDate()} ${MES[d.getMonth()]}</text>`;
    }
    ejeX += `<text x="${(w - mDer).toFixed(1)}" y="${h - 10}" text-anchor="end"
               font-size="11.5" fill="currentColor" fill-opacity=".6">hoy</text>`;

    /* ---------- la linea ----------
       Se corta cuando pasan mas de dos dias sin registro. Unir un lunes
       con el viernes siguiente dibuja una tendencia que nunca existio:
       el hueco es informacion, no un estorbo que tapar. */
    const tramos = [];
    let actual = [];
    let ultimoI = -99;
    serie.forEach((d, i) => {
      if (d.value === null) return;
      if (i - ultimoI > 2 && actual.length) { tramos.push(actual); actual = []; }
      actual.push({ i, v: d.value, fecha: d.fecha });
      ultimoI = i;
    });
    if (actual.length) tramos.push(actual);

    let lineas = "", area = "", puntos = "";
    tramos.forEach(t => {
      const d = t.map((p, k) => `${k ? "L" : "M"}${px(p.i).toFixed(1)} ${py(p.v).toFixed(1)}`).join(" ");
      if (t.length > 1) {
        lineas += `<path d="${d}" fill="none" stroke="#867BB8" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round"/>`;
        // El relleno cierra bajo el TRAMO, no bajo todo el lienzo: por eso
        // antes un solo punto pintaba un triangulo desde la esquina.
        const x0 = px(t[0].i).toFixed(1), x1 = px(t[t.length - 1].i).toFixed(1);
        const base = (mArr + altoUtil).toFixed(1);
        area += `<path d="${d} L${x1} ${base} L${x0} ${base} Z" fill="url(#cg)"/>`;
      }
      t.forEach(p => {
        const cx = px(p.i).toFixed(1), cy = py(p.v).toFixed(1);
        const et = (ANIMOS[p.v] || ANIMOS[3]).texto;
        const fecha = p.fecha.getDate() + " " + MES[p.fecha.getMonth()];
        puntos += `<circle cx="${cx}" cy="${cy}" r="${t.length === 1 ? 5 : 4}"
                     fill="${(ANIMOS[p.v] || ANIMOS[3]).color}" stroke="var(--bg-1)" stroke-width="1.5">
                     <title>${fecha}: ${et} (${p.v}/5)</title></circle>`;
      });
    });

    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Ánimo de los últimos ${DIAS} días: ${conDato.length} registros`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#D6A6CE" stop-opacity=".40"/>
          <stop offset="100%" stop-color="#B7B2EA" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${rejilla}${ejeX}${area}${lineas}${puntos}`;

    /* ---------- resumen en palabras ----------
       Una grafica sin numeros obliga a estimar a ojo. Esto dice en texto
       lo que la linea insinua. */
    const res = $("#chartResumen");
    if (res) {
      const vals = conDato.map(d => d.value);
      const prom = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
      const mejor = conDato.reduce((a, b) => (b.value > a.value ? b : a));
      const peor  = conDato.reduce((a, b) => (b.value < a.value ? b : a));
      const dia = d => d.getDate() + " " + MES[d.getMonth()];
      const huecos = DIAS - conDato.length;
      res.innerHTML = `
        <span><strong>${conDato.length}</strong> de ${DIAS} días registrados</span>
        <span>Promedio <strong>${prom}</strong>/5</span>
        <span>Mejor: <strong>${dia(mejor.fecha)}</strong> (${(ANIMOS[mejor.value]||{}).texto})</span>
        <span>Más bajo: <strong>${dia(peor.fecha)}</strong> (${(ANIMOS[peor.value]||{}).texto})</span>
        ${huecos ? `<span class="chart-huecos">${huecos} día${huecos > 1 ? "s" : ""} sin registro</span>` : ""}`;
    }
  }

  /* =========================================================
     Consentimiento informado (RF-15)

     Se pide al crear cuenta y tambien a quien ya tenia cuenta pero
     nunca consintio: hasta que lo haga, Aura esta tratando sus datos
     de salud sin el consentimiento expreso que pide el articulo 8.
     ========================================================= */
  const Consent = () => window.AuraConsentimiento;

  /** ¿La persona autorizo el tratamiento de datos de salud? */
  function puedeTratarSensibles() {
    const C = Consent();
    return C ? C.tieneSensibles(state) : true;   // sin el modulo, no se bloquea la app
  }

  function pintarConsentimiento() {
    const C = Consent();
    const res = $("#consentResumen"), btn = $("#consentToggleBtn");
    if (!C || !res || !btn) return;
    const activo = C.tieneSensibles(state);
    res.textContent = activo ? C.resumen(state) : "No autorizado — tu ánimo y tu diario no se guardan";
    btn.textContent = activo ? "Retirar" : "Autorizar";
    btn.style.color = activo ? "#D65A7A" : "";
    btn.style.borderColor = activo ? "rgba(214,90,122,0.3)" : "";
  }

  async function revisarConsentimiento() {
    const C = Consent();
    if (!C || !C.requiere(state)) return;
    const registro = await C.pedir({
      alPedirSos: () => { $("#sosOverlay")?.classList.add("open"); runSosBreathe(); }
    });
    state.consentimiento = registro;
    saveState();
  }

  /* ---------- Nombre y fecha de nacimiento ----------
     Va DESPUES del consentimiento, no antes: pedir datos de una persona
     que todavia no ha aceptado que se traten seria recabarlos sin base.

     Se ejecuta en cada arranque, no solo al registrarse. Quien entro con
     Google nunca paso por el formulario de correo, y quien creo su cuenta
     antes de que esto existiera tampoco: a los dos se les pregunta aqui,
     una sola vez. */
  async function revisarPerfil() {
    const P = window.AuraPerfil;
    if (!P || !P.requiere(state)) return;

    const persona = await P.pedir({ nombre: state.name, nacimiento: state.birth });
    state.name = persona.nombre;
    state.birth = persona.nacimiento;
    state.menorDeEdad = persona.menorDeEdad;
    if (persona.tutorAutoriza) state.tutorAutoriza = persona.registrado;
    saveState();

    // El perfil de la cuenta tambien: es lo que ve el especialista cuando
    // acepta la vinculacion.
    try {
      await window.AuraAuth?.guardarPerfil({
        nombre: persona.nombre,
        nacimiento: persona.nacimiento,
        menorDeEdad: persona.menorDeEdad
      });
    } catch (e) { /* el dato ya quedo en el estado; se reintenta al sincronizar */ }
  }

  /** Tarjeta que sustituye a un modulo personal cuando no hay consentimiento. */
  function tarjetaSinConsentimiento(que) {
    return `<div class="card glass sin-consent">
      <h3>Necesitamos tu permiso</h3>
      <p>Para guardar ${que} necesitamos tu consentimiento expreso, porque es información sobre tu salud. Puedes darlo ahora o seguir usando Calma, el directorio y el botón SOS sin él.</p>
      <button class="glass-btn primary" data-activar-sensibles>Dar mi consentimiento</button>
    </div>`;
  }

  /** Activa el tratamiento de datos sensibles desde cualquier tarjeta. */
  async function activarSensibles() {
    const C = Consent();
    if (!C) return;
    state.consentimiento = C.actualizarSensibles(state, true);
    saveState();
    renderHome(); renderDiary(); renderAurorIA(); renderSettings();
    computeClinicalData();
    toast("Consentimiento registrado");
  }

  /* ---------- Foto de perfil ----------
     Se pinta despues de que la app ya esta en pantalla. Es decoracion:
     no vale la pena retrasar el arranque por ella. */
  let fotoActual = null;

  function fotoEstado(msg, esError) {
    const el = $("#fotoEstado");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("es-error", !!esError);
  }

  function dibujarAvatar(dataUri) {
    const img = $("#avatarImg"), ini = $("#avatarIniciales"), quitar = $("#btnQuitarFoto");
    if (!img || !ini) return;
    if (dataUri) {
      img.src = dataUri; img.hidden = false;
      ini.textContent = ""; ini.hidden = true;
      if (quitar) quitar.hidden = false;
    } else {
      img.removeAttribute("src"); img.hidden = true;
      ini.textContent = window.AuraFoto?.iniciales(state.name) || "";
      ini.hidden = false;
      if (quitar) quitar.hidden = true;
    }
  }

  async function pintarFoto() {
    dibujarAvatar(fotoActual);
    if (!state.patientId || !window.AuraFoto) return;
    const uri = await window.AuraFoto.cargar(state.patientId);
    if (uri) { fotoActual = uri; dibujarAvatar(uri); }
  }

  async function elegirFoto(archivo) {
    if (!archivo || !window.AuraFoto || !state.patientId) return;
    fotoEstado("Preparando la imagen…");
    try {
      const uri = await window.AuraFoto.procesar(archivo);
      await window.AuraFoto.guardar(state.patientId, uri);
      fotoActual = uri;
      dibujarAvatar(uri);
      const kb = Math.round(uri.length / 1024);
      fotoEstado(`Listo. Se guardó a ${window.AuraFoto.LADO}px (${kb} KB).`);
      setTimeout(() => fotoEstado(""), 4000);
    } catch (e) {
      fotoEstado(e.message || "No se pudo usar esa imagen.", true);
    }
  }

  /* ---------- Cifrado ----------
     La criptografia vive en js/aura-cripto.js. Aqui solo quedan los
     atajos que usa la interfaz. El esquema es de sobre: el codigo de
     acceso abre una DEK aleatoria, y esa DEK cifra el contenido. Por
     eso cambiar el codigo no obliga a re-cifrar nada. */
  const Cripto = () => window.AuraCripto;
  const b64 = (buf) => Cripto()._b64(buf);

  async function encryptText(key, text) { return Cripto().cifrar(key, text); }
  async function decryptText(key, ivB64, ctB64) {
    return Cripto().descifrar(key, { iv: ivB64, ct: ctB64 });
  }

  /* ---------- La conversacion de aurorIA ----------
     Vive en claro en state.auroriaMemory porque la interfaz y el modelo
     la necesitan asi, pero NUNCA se persiste de esa forma: aura-estado.js
     la tiene en su lista de campos prohibidos. Lo que se guarda es
     state.auroriaCifrada, y solo se puede escribir con la boveda abierta. */
  async function cifrarConversacion() {
    if (!diaryKey) return false;
    try {
      state.auroriaCifrada = await Cripto().cifrarJSON(diaryKey, state.auroriaMemory || []);
      return true;
    } catch (e) {
      console.warn("[Aura] no se pudo cifrar la conversacion:", e.message);
      return false;
    }
  }

  async function descifrarConversacion() {
    if (!diaryKey || !state.auroriaCifrada) return;
    try {
      const m = await Cripto().descifrarJSON(diaryKey, state.auroriaCifrada);
      if (Array.isArray(m)) state.auroriaMemory = m;
    } catch (e) {
      // Contenido de otra boveda o corrupto: se deja la memoria vacia en
      // vez de tirar la pantalla. El cifrado original no se toca.
      console.warn("[Aura] no se pudo descifrar la conversacion:", e.message);
    }
  }

  /** Guarda cifrando antes lo que deba ir cifrado. */
  async function guardarSeguro() {
    await cifrarConversacion();
    saveState();
  }

  function renderDiary() {
    sincronizarAnimo();
    const lock = $("#diaryLockView"), main = $("#diaryMainView");
    const hueco = $("#diarioSinConsent");
    if (!puedeTratarSensibles()) {
      lock?.classList.add("hidden");
      main?.classList.add("hidden");
      $("#vistaRecuperacion")?.classList.add("hidden");
      if (hueco) { hueco.innerHTML = tarjetaSinConsentimiento("lo que escribas en tu diario"); hueco.classList.remove("hidden"); }
      return;
    }
    hueco?.classList.add("hidden");

    const C = Cripto();
    // "Ya tiene codigo" incluye las cuentas del esquema viejo: a esas se
    // les pide su PIN de siempre y la migracion ocurre sola al abrir.
    const hasPin = C.existe(state.cripto) || C.esV1(state);
    $("#vistaRecuperacion")?.classList.add("hidden");
    const lockView = $("#diaryLockView");
    const mainView = $("#diaryMainView");
    if (!lockView || !mainView) return;

    lockView.classList.toggle("hidden", diaryUnlocked);
    mainView.classList.toggle("hidden", !diaryUnlocked);

    if (!diaryUnlocked) {
      pinBuffer = "";
      updatePinDots();
      const title = $("#lockTitle");
      const sub = $("#lockSub");
      if (title) title.textContent = hasPin ? "Diario protegido" : "Crea tu código";
      if (sub) {
        sub.textContent = C.esV1(state)
          ? "Escribe tu PIN de 4 dígitos — vamos a reforzar tu cifrado"
          : hasPin
            ? "Escribe tus 6 dígitos"
            : "Elige 6 dígitos para cifrar tu diario y tus conversaciones";
      }
      // El teclado del esquema viejo sigue siendo de 4 digitos hasta migrar.
      LARGO_ACTUAL = C.esV1(state) ? 4 : LARGO_CODIGO;
      pintarPuntos();
    } else {
      renderDiaryEntries();
    }
  }

  let LARGO_ACTUAL = 6;

  /* El esquema viejo usaba 4 digitos. Mientras una cuenta no migre hay
     que seguir pidiendole 4, o nunca podria entrar a migrar. */
  function pintarPuntos() {
    const cont = $("#pinDots");
    if (!cont) return;
    const hay = cont.querySelectorAll("span").length;
    if (hay !== LARGO_ACTUAL) {
      cont.innerHTML = "";
      for (let i = 0; i < LARGO_ACTUAL; i++) cont.appendChild(document.createElement("span"));
    }
    updatePinDots();
  }

  function updatePinDots() {
    $all("#pinDots span").forEach((dot, i) => dot.classList.toggle("filled", i < pinBuffer.length));
  }

  /* ---------- El candado ----------
     Tres caminos: crear la boveda, abrirla, o migrar una del esquema
     viejo. El tercero es el delicado: si algo falla a medio camino no
     se toca nada, porque del otro lado hay texto del usuario que no
     tiene copia en ningun otro lado. */

  const LARGO_CODIGO = 6;

  function pinFeedback(msg) {
    const err = $("#pinError");
    if (err) err.textContent = msg || "";
    pinBuffer = "";
    updatePinDots();
  }

  function pinOcupado(si) {
    $all(".pin-pad-grid button").forEach(b => { b.disabled = !!si; });
    const sub = $("#lockSub");
    if (si && sub) sub.textContent = "Abriendo…";
  }

  async function handlePinInput(num) {
    if (pinBuffer.length >= LARGO_ACTUAL) return;
    pinBuffer += num;
    updatePinDots();
    if (pinBuffer.length !== LARGO_ACTUAL) return;

    const codigo = pinBuffer;
    const C = Cripto();
    pinOcupado(true);
    try {
      if (C.esV1(state)) {
        await migrarBoveda(codigo);
      } else if (C.existe(state.cripto)) {
        await abrirBoveda(codigo);
      } else {
        await crearBoveda(codigo);
      }
    } catch (e) {
      console.warn("[Aura candado]", e);
      pinFeedback("Algo salió mal. Intenta de nuevo.");
    } finally {
      pinOcupado(false);
    }
  }

  async function crearBoveda(codigo) {
    const { cripto, codigoRecuperacion, llave } = await Cripto().crear(codigo);
    state.cripto = cripto;
    diaryKey = llave;
    diaryUnlocked = true;
    await guardarSeguro();
    mostrarCodigoRecuperacion(codigoRecuperacion);
  }

  async function abrirBoveda(codigo) {
    const llave = await Cripto().abrir(state.cripto, codigo);
    if (!llave) { pinFeedback("Código incorrecto."); return; }
    diaryKey = llave;
    diaryUnlocked = true;
    await descifrarConversacion();
    await rescatarConversacionEnClaro();
    renderDiary();
    renderAurorIA();
  }

  /* Cuentas creadas antes del cifrado v2 traen la conversacion en claro
     desde el servidor. Al abrir la boveda por primera vez se cifra y se
     BORRA del servidor: dejarla ahi seria conservar en claro justo lo
     que este cambio existe para proteger. */
  async function rescatarConversacionEnClaro() {
    if (!diaryKey) return;
    if (!Array.isArray(state.auroriaMemory) || !state.auroriaMemory.length) return;
    if (state.auroriaCifrada) return;      // ya estaba cifrada, nada que rescatar
    const ok = await cifrarConversacion();
    if (!ok) return;
    saveState();
    await window.AuraEstado?.sincronizarYa?.();
    await window.AuraEstado?.olvidarCampos?.("auroriaMemory");
  }

  /* Migracion del esquema viejo. migrarV1 descifra TODO y lo verifica
     antes de devolver nada; si una sola entrada falla, lanza y aqui no
     se escribe una linea. El estado viejo queda como estaba. */
  async function migrarBoveda(pin) {
    let r;
    try {
      r = await Cripto().migrarV1(state, pin);
    } catch (e) {
      if (/PIN no es correcto/.test(e.message)) { pinFeedback("Código incorrecto."); return; }
      pinFeedback("No se pudo actualizar el cifrado. Tus datos siguen intactos.");
      console.error("[Aura migracion]", e);
      return;
    }
    state.cripto = r.cripto;
    state.diaryEntries = r.entradas;
    state.diarySalt = null;      // el esquema viejo ya no se usa
    state.diaryCheck = null;
    diaryKey = r.llave;
    diaryUnlocked = true;
    await guardarSeguro();
    await window.AuraEstado?.sincronizarYa?.();
    await window.AuraEstado?.olvidarCampos?.("auroriaMemory", "diarySalt", "diaryCheck");
    toast("Cifrado actualizado");
    mostrarCodigoRecuperacion(r.codigoRecuperacion);
  }

  function mostrarCodigoRecuperacion(codigo) {
    const vista = $("#vistaRecuperacion");
    const caja = $("#codigoRecuperacion");
    if (!vista || !caja) { renderDiary(); return; }
    caja.textContent = codigo;
    $("#diaryLockView")?.classList.add("hidden");
    $("#diaryMainView")?.classList.add("hidden");
    vista.classList.remove("hidden");
  }

  async function usarCodigoRecuperacion() {
    const C = Cripto();
    if (!C.existe(state.cripto)) {
      toast(C.esV1(state)
        ? "Escribe tu PIN actual para actualizar el cifrado"
        : "Todavía no has creado un código");
      return;
    }
    const rec = prompt("Escribe tu código de recuperación:");
    if (!rec) return;
    const nuevo = prompt("Ahora elige un código nuevo de 6 dígitos:");
    if (!nuevo || !/^\d{6}$/.test(nuevo)) { toast("El código debe ser de 6 dígitos"); return; }
    try {
      state.cripto = await C.restablecerConRecuperacion(state.cripto, rec, nuevo);
      diaryKey = await C.abrir(state.cripto, nuevo);
      diaryUnlocked = true;
      await descifrarConversacion();
      await guardarSeguro();
      toast("Código restablecido");
      renderDiary();
      renderAurorIA();
    } catch (e) {
      toast(e.message || "No se pudo restablecer");
    }
  }

  async function renderDiaryEntries() {
    const list = $("#diaryEntries");
    if (!list) return;
    list.innerHTML = "";
    if (!state.diaryEntries.length) {
      list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-soft);">Aún no tienes entradas registradas.</div>`;
      return;
    }
    for (const e of [...state.diaryEntries].reverse()) {
      let txt = "(Cifrado)";
      try { txt = await decryptText(diaryKey, e.iv, e.ct); } catch {}
      const div = document.createElement("div");
      div.className = "entry glass";
      div.innerHTML = `
        <div class="entry-head">
          <span>${e.date}</span>
          <button class="entry-del" title="Eliminar entrada"><svg class="icon icon-sm"><use href="#i-trash"/></svg></button>
        </div>
        <p style="white-space:pre-wrap; font-size:14px; line-height:1.6;">${txt}</p>`;
      div.querySelector(".entry-del")?.addEventListener("click", () => {
        state.diaryEntries = state.diaryEntries.filter(item => item.id !== e.id);
        saveState();
        renderDiaryEntries();
      });
      list.appendChild(div);
    }
  }

  /* aurorIA */
  function renderAurorIA() {
    const log = $("#chatLog");
    if (!log) return;
    montarMascota();
    pintarControlesVoz();
    // Las voces del sistema cargan tarde; si esta pantalla se abre antes
    // que Configuración, hay que elegir voz aquí o el chip no funciona.
    if (window.AuraVoz?.disponible() && !window.AuraVoz.voz) window.AuraVoz.elegirVoz();
    log.innerHTML = "";
    if (!puedeTratarSensibles()) {
      log.innerHTML = tarjetaSinConsentimiento("tus conversaciones");
      return;
    }
    if (!diaryUnlocked && state.auroriaCifrada && !state.auroriaMemory.length) {
      appendBubble("bot", "Tu historial está cifrado. Abre tu diario con tu código para verlo — mientras tanto podemos hablar, y lo que escribas se guardará cuando desbloquees.");
      return;
    }
    if (!state.auroriaMemory.length) {
      appendBubble("bot", `Hola${state.name ? ' ' + state.name : ''}, soy aurorIA. Soy una inteligencia artificial, no una persona. Lo que conversemos se guarda cifrado con tu código: tu especialista no puede leerlo. ¿Cómo te sientes hoy?`);
    } else {
      state.auroriaMemory.forEach(m => appendBubble(m.sender, m.text));
    }
  }

  /* =========================================================
     La mascota de aurorIA
     ========================================================= */

  let mascota = null;

  function montarMascota() {
    const caja = $("#mascotaAurorIA");
    if (!caja || !window.AuraMascota) return null;
    if (mascota) return mascota;
    mascota = window.AuraMascota.crear(caja);
    return mascota;
  }

  function pieMascota(txt) {
    const el = $("#mascotaPie");
    if (el) el.textContent = txt || "";
  }

  /* Mientras la persona escribe, la mascota escucha. Es el gesto que
     hace que se sienta acompanada en vez de vigilada por una imagen
     fija: no dice nada nuevo, pero responde. */
  let relojEscucha = null;
  function mascotaEscucha() {
    if (!mascota) return;
    if (mascota.estadoActual === "hablando" || mascota.estadoActual === "pensando") return;
    mascota.estado("escuchando");
    clearTimeout(relojEscucha);
    relojEscucha = setTimeout(() => {
      if (mascota && mascota.estadoActual === "escuchando") mascota.estado("reposo");
    }, 2200);
  }

  /* ---------- decir la respuesta en voz alta ----------
     Cada palabra que la voz pronuncia mueve la boca una silaba. Si la
     voz no esta disponible o esta apagada, la mascota igual "habla" un
     momento: el gesto acompana a la burbuja que acaba de aparecer, y
     sin el la respuesta cae en el chat sin que nadie la diga. */
  async function decirEnVoz(texto, opciones) {
    opciones = opciones || {};
    const m = mascota;
    if (m) m.estado("hablando");

    // Cerrar el ciclo de la conversación por voz: en cuanto termina de
    // hablar, vuelve a escuchar. La pausa corta evita que el micrófono
    // alcance a captar la cola de su propia voz.
    const seguir = () => {
      if (opciones.luegoEscuchar && state.vozAVoz && !escuchando) {
        setTimeout(escucharYEnviar, 420);
      }
    };

    const V = window.AuraVoz;
    const puede = state.vozActiva && V && V.disponible();

    if (!puede) {
      if (m) {
        // Gesto corto, proporcional al largo del texto, con tope.
        const golpes = Math.min(14, Math.max(4, Math.round(String(texto).length / 28)));
        for (let i = 0; i < golpes; i++) {
          setTimeout(() => { if (mascota === m) m.silaba(); }, i * 140);
        }
        setTimeout(() => { if (mascota === m && m.estadoActual === "hablando") m.estado("reposo"); },
                   golpes * 140 + 260);
      }
      // Sin lectura en voz alta el ciclo igual continúa: se puede
      // conversar por voz leyendo las respuestas en pantalla.
      seguir();
      return;
    }

    // La primera vez que habla, se dice de nuevo lo que es. Darle voz y
    // cara la hace sentir mas persona, y ese es justo el momento en que
    // el descargo importa mas, no menos.
    if (!state.avisoVozVisto) {
      state.avisoVozVisto = true;
      saveState();
      pieMascota("Voz sintética — aurorIA no es una persona.");
    }

    await V.hablar(texto, {
      alPalabra: () => { if (mascota === m) m.silaba(); },
      alTerminar: () => {
        if (mascota === m && m.estadoActual === "hablando") m.estado("reposo");
        seguir();
      }
    });
  }

  /* =========================================================
     Voz: encender, apagar y mantener los dos lados de acuerdo
     ========================================================= */

  /** Enciende la lectura en voz alta. Devuelve false si no se pudo. */
  function encenderVoz(conSaludo) {
    const V = window.AuraVoz;
    if (!V || !V.disponible()) { toast("Este navegador no puede leer en voz alta."); return false; }
    if (!V.voz) {
      V.voces().then((lista) => {
        toast(V.vocesEspanol(lista).length
          ? "Las voces del sistema apenas están cargando. Vuelve a tocar en un momento."
          : "No hay voces en español instaladas en este dispositivo.");
        pintarVoz();
      });
      return false;
    }
    // Todo esto sin await: el sonido tiene que salir dentro del mismo
    // gesto del toque o Safari lo bloquea.
    V.desbloquear();
    window.AuraTimbre?.despertar();
    state.vozActiva = true;
    montarMascota();
    if (conSaludo) decirEnVoz("Hola, soy aurorIA. Así sueno.");
    saveState();
    pintarControlesVoz();
    return true;
  }

  function apagarVoz() {
    state.vozActiva = false;
    callarMascota();
    window.AuraTimbre?.cerrarHalo();
    saveState();
    pintarControlesVoz();
  }

  /** Deja chips e interruptores diciendo lo mismo, estén donde estén. */
  function pintarControlesVoz() {
    // Ofrecer "conversar por voz" a quien todavia no da su
    // consentimiento es ofrecerle algo que va a rebotar. Se esconden.
    const conPermiso = puedeTratarSensibles();
    const hayVoz = !!window.AuraVoz?.disponible() && conPermiso;
    const hayMic = !!window.AuraEscucha?.disponible() && conPermiso;

    const chipL = $("#chipLeer");
    if (chipL) {
      chipL.hidden = !hayVoz;
      chipL.setAttribute("aria-pressed", state.vozActiva ? "true" : "false");
      chipL.querySelector("use")?.setAttribute("href", state.vozActiva ? "#i-volume" : "#i-volume-off");
      const t = chipL.querySelector("span");
      if (t) t.textContent = state.vozActiva ? "Leyendo" : "Que me lea";
    }

    const chipC = $("#chipConversar");
    if (chipC) {
      chipC.hidden = !hayMic;
      chipC.setAttribute("aria-pressed", state.vozAVoz ? "true" : "false");
      chipC.querySelector("use")?.setAttribute("href", state.vozAVoz ? "#i-mic" : "#i-mic-off");
      const t = chipC.querySelector("span");
      if (t) t.textContent = state.vozAVoz ? "Conversando" : "Conversar por voz";
    }

    const mic = $("#chatMicBtn");
    if (mic) mic.hidden = !hayMic;

    $("#vozSwitch")?.classList.toggle("on", !!state.vozActiva);
    $("#microfonoSwitch")?.classList.toggle("on", !!state.vozAVoz);
    $("#filaMicrofono")?.classList.toggle("hidden", !hayMic);
    $("#vozControles")?.classList.toggle("hidden", !hayVoz && !hayMic);
  }

  /* ---------- escuchar ----------
     Mientras el micrófono está abierto TIENE que notarse: el chip y el
     botón laten en rojo y lo que se va entendiendo aparece en el campo
     de texto. Un micrófono abierto sin señal visible no es aceptable en
     una app que trata datos de salud. */
  let escuchando = false;

  function pintarEscucha(activo) {
    escuchando = activo;
    $("#chipConversar")?.classList.toggle("escuchando", activo);
    $("#chatMicBtn")?.classList.toggle("escuchando", activo);
    const inp = $("#chatInput");
    if (inp) {
      inp.classList.toggle("dictando", activo);
      if (activo) inp.placeholder = "Te escucho…";
      else { inp.placeholder = "Habla con aurorIA sobre lo que sientes..."; inp.classList.remove("dictando"); }
    }
    if (mascota) mascota.estado(activo ? "escuchando" : "reposo");
  }

  /**
   * Abre el micrófono una vez y devuelve lo que entendió.
   * Nunca se escucha mientras aurorIA habla: se oiría a sí misma.
   */
  async function escucharAlMicrofono() {
    const E = window.AuraEscucha;
    if (!E || !E.disponible()) { toast("Este navegador no puede escuchar."); return ""; }
    if (escuchando) { E.detener(); return ""; }

    callarMascota();   // que se calle antes de abrir el micrófono

    // La primera vez se dice a dónde va el audio. Es lo único de Aura
    // que sale del aparato sin cifrar, y eso no se entierra en un aviso.
    if (!state.avisoMicVisto) {
      state.avisoMicVisto = true;
      saveState();
      pieMascota("Tu voz se convierte a texto en un servicio del navegador.");
    }

    const inp = $("#chatInput");
    pintarEscucha(true);
    const r = await E.escuchar({
      alParcial: (t) => { if (inp) inp.value = t; }
    });
    pintarEscucha(false);

    if (!r.texto) {
      const msg = E.mensaje(r.motivo);
      if (msg) toast(msg);
      if (inp) inp.value = "";
      // Un permiso denegado no se arregla reintentando: se apaga el modo
      // para no dejar un botón que solo sabe fallar.
      if (r.motivo === "not-allowed" || r.motivo === "service-not-allowed" || r.motivo === "audio-capture") {
        state.vozAVoz = false;
        saveState();
        pintarControlesVoz();
      }
      return "";
    }
    if (inp) inp.value = "";
    return r.texto;
  }

  /** Escucha y, si entendió algo, lo manda como mensaje. */
  async function escucharYEnviar() {
    if (!state.vozAVoz) return;
    const texto = await escucharAlMicrofono();
    if (texto) handleAurorIASend(texto);
  }

  function callarMascota() {
    window.AuraVoz?.callar();
    if (mascota && mascota.estadoActual === "hablando") mascota.estado("reposo");
  }

  function appendBubble(sender, text) {
    const log = $("#chatLog");
    if (!log) return;
    const el = document.createElement("div");
    el.className = "bubble " + sender;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  const LOCAL_REPLIES = {
    crisis: "Comprendo lo abrumador que se siente. La respuesta de alarma del cuerpo siempre tiene un límite de tiempo. Si la intensidad es muy alta, usa el botón SOS: ahí tienes enfriamiento, respiración 4-2-8 y la línea de apoyo.",
    base: "Te escucho. Poner en palabras lo que pasa ayuda a bajar la sobrecarga. ¿Quieres probar un ejercicio sensorial o la técnica 9-0 en el módulo de Calma?"
  };

  function localReply(text) {
    const l = text.toLowerCase();
    const alarm = ["ansiedad", "miedo", "nervios", "pánico", "panico", "angustia"];
    return alarm.some(w => l.includes(w)) ? LOCAL_REPLIES.crisis : LOCAL_REPLIES.base;
  }

  function setTyping(on) {
    if (mascota) mascota.estado(on ? "pensando" : "reposo");
    const log = $("#chatLog");
    if (!log) return;
    let el = $("#chatTyping");
    if (on && !el) {
      el = document.createElement("div");
      el.className = "bubble bot";
      el.id = "chatTyping";
      el.textContent = "…";
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
    } else if (!on && el) {
      el.remove();
    }
  }

  async function handleAurorIASend(text) {
    if (!text.trim()) return;
    // Sin consentimiento no se guarda ni una palabra, venga de donde
    // venga. Antes esto lo cubria renderAurorIA() escondiendo el chat;
    // al agregar la voz apareció un camino que no pasaba por ahí.
    if (!puedeTratarSensibles()) {
      toast("Necesitamos tu consentimiento para guardar tus conversaciones");
      state.vozAVoz = false;
      window.AuraEscucha?.cancelar();
      pintarEscucha(false);
      pintarControlesVoz();
      renderAurorIA();
      return;
    }
    appendBubble("me", text);
    state.auroriaMemory.push({ sender: "me", text });
    await guardarSeguro();

    // Riesgo inmediato: no lo delegamos a un modelo, se abre el SOS de una vez.
    if (window.AuraAI && window.AuraAI.isCrisis(text)) {
      const reply = window.AuraAI.CRISIS_REPLY;
      appendBubble("bot", reply);
      state.auroriaMemory.push({ sender: "bot", text: reply });
      await guardarSeguro();
      // En crisis la mascota NO habla: el panel de SOS se abre encima y
      // dos voces al mismo tiempo en ese momento es lo ultimo que hace
      // falta. La burbuja queda escrita, que es lo que importa.
      callarMascota();
      $("#sosOverlay")?.classList.add("open");
      runSosBreathe();
      logSos("mencion_en_chat");
      computeClinicalData();
      return;
    }

    setTyping(true);
    let reply;
    let motivoLocal = null;
    try {
      if (!window.AuraAI) motivoLocal = "sdk";
      else if (!state.aiConsent) motivoLocal = "consentimiento";
      else if (!navigator.onLine) motivoLocal = "sin_red";
      else {
        reply = await window.AuraAI.reply(state.auroriaMemory.slice(-16), { name: state.name });
      }
    } catch (e) {
      motivoLocal = "modelo";
      console.warn("[Aura] aurorIA sin conexión al modelo:", e);
    }
    setTyping(false);
    if (!reply) reply = localReply(text);

    appendBubble("bot", reply);
    state.auroriaMemory.push({ sender: "bot", text: reply });
    await guardarSeguro();
    computeClinicalData();
    marcarActividad("chat");
    pushMetrics("chat");
    decirEnVoz(reply, { luegoEscuchar: true });   // no se espera: el chat no debe trabarse tras la voz

    // Si contestó el guion local, decir por qué. Una sola vez por sesión:
    // repetirlo en cada mensaje sería peor que el silencio.
    if (motivoLocal && !avisoConsentIA) {
      avisoConsentIA = true;
      mostrarAvisoIA(motivoLocal);
    }
  }

  /* La app respondía con guiones enlatados sin explicar nunca por qué.
     Aquí se nombra el motivo y, cuando se puede resolver, se ofrece el atajo. */
  let avisoConsentIA = false;

  function mostrarAvisoIA(motivo) {
    const log = $("#chatLog");
    if (!log) return;
    const div = document.createElement("div");
    div.className = "aviso-ia";

    if (motivo === "consentimiento") {
      div.innerHTML = '<span>Estas respuestas son guiones locales. Para que aurorIA converse de verdad, ' +
        'hay que activar el modelo en la nube.</span>';
      const b = document.createElement("button");
      b.type = "button";
      b.className = "glass-btn sm";
      b.textContent = "Activar";
      b.addEventListener("click", () => {
        state.aiConsent = true;
        saveState();
        renderLink();          // es renderLink quien pinta el interruptor
        div.remove();
        avisoConsentIA = false;
        toast("aurorIA usará el modelo en la nube");
      });
      div.appendChild(b);
    } else if (motivo === "sin_red") {
      div.innerHTML = "<span>Sin conexión: aurorIA responde con guiones locales. " +
        "Los ejercicios de Calma y tu diario siguen funcionando igual.</span>";
    } else {
      div.innerHTML = "<span>aurorIA no pudo alcanzar el modelo, así que responde con guiones locales. " +
        "Vuelve a intentarlo en un momento.</span>";
    }

    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function logSos(origen) {
    state.sosEvents = state.sosEvents || [];
    state.sosEvents.push({ at: new Date().toISOString(), origen });
    saveState();
    pushMetrics("sos");
    if (window.AuraSync && state.linkedTherapist) window.AuraSync.alertSos(origen);
  }

  /* Módulo de Calma: Kit de los 5 Sentidos */
  const SENSES_DATA = {
    vista: "<strong>Exploración Visual:</strong> Busca 3 objetos a tu alrededor que tengan sombras interesantes o texturas sutiles. Observa cómo interactúa la luz con ellos.",
    tacto: "<strong>Exploración Táctil:</strong> Toca la textura de tu ropa, la temperatura del suelo o la superficie de tu mesa. Concéntrate exclusivamente en la sensación física.",
    oido: "<strong>Exploración Auditiva:</strong> Cierra los ojos y busca escuchar el sonido más lejano que puedas percibir. Luego, cambia al sonido más cercano.",
    olfato: "<strong>Exploración Olfativa:</strong> Inhala suavemente e identifica los aromas presentes en tu entorno (café, perfume, aire fresco o tela limpia).",
    gusto: "<strong>Exploración Gustativa:</strong> Toma un sorbo de agua fresca o nota el sabor residual en tu boca, recorriendo el paladar lentamente con la lengua."
  };

  function initSensoryKit() {
    $all(".sense-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        $all(".sense-tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const senseKey = btn.dataset.sense;
        const display = $("#senseContentDisplay");
        if (display && SENSES_DATA[senseKey]) {
          display.innerHTML = SENSES_DATA[senseKey];
        }
      });
    });
  }

  /* Meditación 9-0 */
  function initCount90() {
    const display = $("#count9to0Display");
    $("#btnNextCount90")?.addEventListener("click", () => {
      count90Val--;
      if (count90Val < 0) {
        count90Val = 9;
        toast("¡Ciclo 9-0 completado! Tu mente está más tranquila.");
      }
      if (display) display.textContent = count90Val;
    });

    $("#btnResetCount90")?.addEventListener("click", () => {
      count90Val = 9;
      if (display) display.textContent = count90Val;
    });
  }

  /* Burbujas y Lienzo */
  let bubbleInterval = null;
  function startBubbles() {
    const stage = $("#bubbleStage");
    if (!stage) return;
    stage.innerHTML = "";
    let popped = 0;
    $("#btnStartBubbles")?.classList.add("hidden");

    bubbleInterval = setInterval(() => {
      const b = document.createElement("div");
      b.className = "pop-bubble";
      const size = Math.floor(Math.random() * 25) + 35;
      b.style.width = size + "px";
      b.style.height = size + "px";
      b.style.left = Math.random() * (stage.clientWidth - size) + "px";

      b.addEventListener("click", () => {
        popped++;
        state.bubblesPopped++;
        marcarActividad("calma");
        const tag = $("#bubbleScoreTag");
        if (tag) tag.textContent = `${popped} reventadas`;
        b.remove();
      });

      stage.appendChild(b);
      setTimeout(() => b.remove(), 4500);
    }, 800);

    setTimeout(() => {
      clearInterval(bubbleInterval);
      $("#btnStartBubbles")?.classList.remove("hidden");
      toast(`Sesión de burbujas completada (${popped} pops)`);
    }, 25000);
  }

  let canvasInited = false;
  function initCanvasOnce() {
    if (canvasInited) return;
    const canvas = $("#drawingCanvas");
    if (!canvas || !canvas.parentElement) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.parentElement.clientWidth - 32;
    canvas.height = 220;

    let drawing = false;
    let currentColor = "#867BB8";

    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = currentColor;

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    canvas.addEventListener("mousedown", (e) => { 
      drawing = true; 
      const p = getPos(e); 
      ctx.beginPath(); 
      ctx.moveTo(p.x, p.y); 
    });
    canvas.addEventListener("mousemove", (e) => { 
      if (!drawing) return; 
      const p = getPos(e); 
      ctx.lineTo(p.x, p.y); 
      ctx.stroke(); 
    });
    window.addEventListener("mouseup", () => { drawing = false; });

    canvas.addEventListener("touchstart", (e) => { 
      drawing = true; 
      const p = getPos(e); 
      ctx.beginPath(); 
      ctx.moveTo(p.x, p.y); 
      e.preventDefault(); 
    });
    canvas.addEventListener("touchmove", (e) => { 
      if (!drawing) return; 
      const p = getPos(e); 
      ctx.lineTo(p.x, p.y); 
      ctx.stroke(); 
      e.preventDefault(); 
    });
    window.addEventListener("touchend", () => { drawing = false; });

    $all(".color-dot").forEach(dot => {
      dot.addEventListener("click", () => {
        $all(".color-dot").forEach(d => d.classList.remove("active"));
        dot.classList.add("active");
        currentColor = dot.dataset.color;
        ctx.strokeStyle = currentColor;
      });
    });

    $("#btnClearCanvas")?.addEventListener("click", () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    canvasInited = true;
  }

  /* Respiración 4-7-8 */
  function startBreathing() {
    $("#breatheStart")?.classList.add("hidden");
    $("#breatheStop")?.classList.remove("hidden");
    const phases = [{ l: "Inhala", s: 4, sc: 1.2 }, { l: "Sostén", s: 7, sc: 1.2 }, { l: "Exhala", s: 8, sc: 0.9 }];
    let idx = 0;

    function run() {
      if (!breatheTimer && idx !== 0) return;
      const p = phases[idx];
      const phaseEl = $("#breathePhase");
      const timeEl = $("#breatheTime");
      const core = $("#breatheCore");

      if (phaseEl) phaseEl.textContent = p.l;
      if (timeEl) timeEl.textContent = p.s + "s";
      if (core) core.style.transform = `scale(${p.sc})`;
      
      let r = p.s;
      breatheTimer = setInterval(() => {
        r--;
        if (timeEl) timeEl.textContent = r + "s";
        if (r <= 0) {
          clearInterval(breatheTimer);
          idx = (idx + 1) % phases.length;
          if (idx === 0) {
            state.breathingCycles++;
            marcarActividad("calma");
            saveState();
            computeClinicalData();
          }
          breatheTimer = "next";
          run();
        }
      }, 1000);
    }
    breatheTimer = "next";
    run();
  }

  function stopBreathing() {
    clearInterval(breatheTimer);
    breatheTimer = null;
    $("#breatheStart")?.classList.remove("hidden");
    $("#breatheStop")?.classList.add("hidden");
    const core = $("#breatheCore");
    const phaseEl = $("#breathePhase");
    const timeEl = $("#breatheTime");
    if (core) core.style.transform = "scale(1)";
    if (phaseEl) phaseEl.textContent = "Listo";
    if (timeEl) timeEl.textContent = "—";
  }

  /* Respiración de Emergencia SOS (4-2-8) */
  function runSosBreathe() {
    const textEl = $("#sosBreatheText");
    const timerEl = $("#sosBreatheTimer");
    if (!textEl || !timerEl) return;

    const phases = [
      { l: "Inhala despacio", s: 4 },
      { l: "Pausa suave", s: 2 },
      { l: "Exhala todo el aire", s: 8 }
    ];
    let pIdx = 0;

    function step() {
      if (!sosBreatheTimer && pIdx !== 0) return;
      const p = phases[pIdx];
      textEl.textContent = p.l;
      let r = p.s;
      timerEl.textContent = r;

      sosBreatheTimer = setInterval(() => {
        r--;
        timerEl.textContent = r;
        if (r <= 0) {
          clearInterval(sosBreatheTimer);
          pIdx = (pIdx + 1) % phases.length;
          sosBreatheTimer = "run";
          step();
        }
      }, 1000);
    }
    sosBreatheTimer = "run";
    step();
  }

  function stopSosBreathe() {
    clearInterval(sosBreatheTimer);
    sosBreatheTimer = null;
  }

  function renderSettings() {
    pintarConsentimiento();
    if (!fotoActual) dibujarAvatar(null);   // las iniciales siguen al nombre
    const nameInput = $("#settingsName");
    const emailInput = $("#settingsEmail");
    const phoneInput = $("#settingsPhone");
    const birthInput = $("#settingsBirth");

    if (nameInput) nameInput.value = state.name || "";
    if (emailInput) emailInput.value = state.email || "";
    if (phoneInput) phoneInput.value = state.phone || "";
    if (birthInput) birthInput.value = state.birth || "";
    applyTheme(state.theme);
  }

  /* Respaldo del diario: sale cifrado, entra cifrado. Sin el codigo no
     se lee. Se incluye la boveda completa (DEK envuelta por el codigo Y
     por el de recuperacion), asi que el respaldo se abre con cualquiera
     de los dos — igual que la cuenta. */
  function backupDiary() {
    if (!Cripto().existe(state.cripto)) {
      toast(Cripto().esV1(state)
        ? "Abre tu diario una vez para actualizar el cifrado, luego respalda"
        : "Primero crea tu código y una entrada");
      return;
    }
    const payload = {
      aura_backup: 2,
      createdAt: new Date().toISOString(),
      cripto: state.cripto,
      diaryEntries: state.diaryEntries,
      auroriaCifrada: state.auroriaCifrada || null
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
    a.download = `aura_diario_cifrado_${todayKey()}.json`;
    a.click();
    toast("Respaldo descargado. Necesitarás tu código para abrirlo.");
  }

  function restoreDiary(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const v2 = data.aura_backup === 2 && data.cripto;
        const v1 = data.aura_backup === 1 && data.diarySalt;
        if ((!v2 && !v1) || !Array.isArray(data.diaryEntries)) throw new Error("formato");

        if (!confirm(`Este respaldo tiene ${data.diaryEntries.length} entradas y reemplaza tu diario actual. Necesitarás el código con el que se creó. ¿Continuar?`)) return;

        if (v2) {
          state.cripto = data.cripto;
          state.auroriaCifrada = data.auroriaCifrada || null;
          state.diarySalt = null;
          state.diaryCheck = null;
        } else {
          // Respaldo del esquema viejo: entra tal cual y se migra sola en
          // cuanto la persona escriba el PIN con el que se creo.
          state.cripto = null;
          state.diarySalt = data.diarySalt;
          state.diaryCheck = data.diaryCheck;
        }
        state.diaryEntries = data.diaryEntries;
        state.auroriaMemory = [];
        diaryKey = null;
        diaryUnlocked = false;
        pinBuffer = "";
        saveState();
        renderDiary();
        showScreen("diario");
        toast("Respaldo restaurado. Escribe el código de ese respaldo.");
      } catch {
        toast("Ese archivo no es un respaldo de Aura");
      }
    };
    reader.readAsText(file);
  }

  function renderLink() {
    const linked = state.linkedTherapist;
    $("#linkedView")?.classList.toggle("hidden", !linked);
    const form = $("#linkForm");
    if (form) form.style.display = linked ? "none" : "flex";
    if (linked) {
      const nm = $("#linkedName");
      const cd = $("#linkedCode");
      if (nm) nm.textContent = linked.name || "Especialista vinculado";
      if (cd) cd.textContent = linked.code;
    }
    const hint = $("#linkHint");
    if (hint && !linked) hint.textContent = "";
    const sw = $("#aiConsentSwitch");
    if (sw) sw.classList.toggle("on", !!state.aiConsent);
    pintarVoz();
    pintarRecordatorio();
  }

  /* ---------- el recordatorio diario ----------
     Solo existe dentro del APK: en el navegador no hay forma de
     programar un aviso que salga con la app cerrada, así que la fila
     se esconde en vez de ofrecer algo que no va a pasar. */
  async function pintarRecordatorio() {
    const R = window.AuraRecordatorio;
    const fila = $("#filaRecordatorio");
    if (!fila) return;

    if (!R || !R.disponible()) { fila.classList.add("hidden"); return; }
    fila.classList.remove("hidden");

    const r = state.recordatorio || { activo: false, hora: 21, minuto: 0 };
    $("#recordatorioSwitch")?.classList.toggle("on", !!r.activo);
    const campo = $("#recordatorioHora");
    if (campo) {
      campo.value = String(r.hora).padStart(2, "0") + ":" + String(r.minuto).padStart(2, "0");
    }

    const est = $("#recordatorioEstado");
    if (!est) return;
    if (!r.activo) { est.textContent = ""; return; }
    const p = await R.permiso();
    est.textContent = p === "granted"
      ? "Activo. Puedes apagarlo cuando quieras."
      : "Falta el permiso de notificaciones del sistema.";
  }

  /* ---------- el interruptor de la voz ----------
     Se dice que aparato la esta poniendo. Si el telefono no trae voces
     en espanol, mas vale decirlo que dejar un interruptor encendido que
     no hace ruido: la persona pensaria que la app esta rota. */
  async function pintarVoz() {
    const sw = $("#vozSwitch");
    const fila = $("#filaVoz");
    const estado = $("#vozEstado");
    const V = window.AuraVoz;

    if (!V || !V.disponible()) {
      fila?.classList.add("hidden");
      pintarControlesVoz();
      return;
    }
    fila?.classList.remove("hidden");
    pintarControlesVoz();
    if (!estado) return;

    const lista = await V.voces();
    const es = V.vocesEspanol(lista);
    if (!es.length) {
      estado.textContent = "Tu teléfono no tiene voces en español instaladas. " +
        "Se pueden agregar desde los ajustes del sistema, en Texto a voz.";
      if (sw) sw.classList.remove("on");
      return;
    }
    // La voz se elige AQUI, al pintar la pantalla, no al tocar el
    // interruptor. En Safari la autorizacion de sonido solo dura lo que
    // dura el gesto: si entre el toque y el primer speak() hay un await,
    // se pierde y el saludo sale mudo. Dejandola lista de antemano, el
    // toque llega directo a hablar.
    await V.elegirVoz();
    estado.textContent = state.vozActiva ? ("Voz: " + (V.voz ? V.voz.name : es[0].name)) : "";
  }

  async function linkTherapist() {
    const input = $("#linkCodeInput");
    const hint = $("#linkHint");
    const code = (input?.value || "").trim().toUpperCase();
    if (!/^AUR-[A-Z0-9]{6}$/.test(code)) {
      if (hint) { hint.className = "link-err"; hint.textContent = "El código va como AUR-K7QF29."; }
      return;
    }
    if (!window.AuraSync) {
      if (hint) { hint.className = "link-err"; hint.textContent = "Sincronización no configurada todavía."; }
      return;
    }
    if (hint) { hint.className = ""; hint.textContent = "Verificando…"; }
    try {
      const t = await window.AuraSync.link(code);
      state.linkedTherapist = t;
      saveState();
      renderLink();
      if (hint) { hint.className = "link-ok"; hint.textContent = "Vinculado. A partir de ahora se comparten métricas, nunca tu diario."; }
      pushMetrics("vinculacion");
    } catch (e) {
      if (hint) { hint.className = "link-err"; hint.textContent = e && e.message ? e.message : "No encontramos ese código."; }
    }
  }

  /* Init Global */
  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(state.theme);
    initAuth();
    initSensoryKit();
    initCount90();

    // Los controles de voz se pintan de entrada: sin esto, un navegador
    // sin reconocimiento mostraba el chip de conversar hasta que alguien
    // abriera aurorIA por primera vez.
    pintarControlesVoz();

    // Router
    $all("[data-screen]").forEach(b => b.addEventListener("click", () => showScreen(b.dataset.screen)));
    const hash = location.hash.replace("#/", "");
    showScreen(SCREENS.includes(hash) ? hash : "inicio");

    // Theme Switch
    $("#themeSwitch")?.addEventListener("click", toggleTheme);
    $("#topThemeBtn")?.addEventListener("click", toggleTheme);

    /* ---------- El deslizador del animo ----------
       Antes solo escuchaba "change", que en un input range se dispara al
       SOLTAR. Mientras arrastrabas no pasaba nada, y la etiqueta nunca se
       actualizaba porque nadie tocaba #moodLabel: decia "Neutral" escrito
       en el HTML y ahi se quedaba pasara lo que pasara.

       Ahora "input" mueve cara y texto en vivo, y "change" es el que
       guarda: asi no se escribe en Firestore en cada pixel del arrastre. */
    const slider = $("#moodRange");

    slider?.addEventListener("input", () => pintarAnimo(Number(slider.value)));

    slider?.addEventListener("change", () => {
      if (!puedeTratarSensibles()) { toast("Necesitamos tu consentimiento para guardar esto"); return; }
      const today = todayKey();
      const v = Number(slider.value);
      const idx = state.moodLogs.findIndex(m => m.date === today);
      if (idx >= 0) state.moodLogs[idx].value = v;
      else state.moodLogs.push({ date: today, value: v });
      saveState();
      pintarAnimo(v);
      drawChart();
      computeClinicalData();
      // Registrar el ánimo es lo ÚNICO que enciende una estrella: es el
      // dato que alimenta la gráfica y el panel del especialista.
      encenderEstrella();
      toast(`Registrado: ${ANIMOS[v].texto}`);
    });

    // PIN pad
    $all(".pin-pad-grid button[data-num]").forEach(b => {
      b.addEventListener("click", () => handlePinInput(b.dataset.num));
    });
    $("#pinBackspace")?.addEventListener("click", () => {
      pinBuffer = pinBuffer.slice(0, -1);
      updatePinDots();
    });

    // Diario acciones
    $("#diarySaveBtn")?.addEventListener("click", async () => {
      const txt = $("#diaryText")?.value.trim();
      if (!txt) return;
      if (!diaryKey) { toast("Desbloquea tu diario primero"); return; }
      const { iv, ct } = await encryptText(diaryKey, txt);
      state.diaryEntries.push({ id: uid(), date: todayKey(), iv, ct });
      await guardarSeguro();
      if ($("#diaryText")) $("#diaryText").value = "";
      renderDiaryEntries();
      computeClinicalData();
      renderCielo();
      toast("Entrada cifrada y guardada");
    });

    $("#diaryLockNow")?.addEventListener("click", async () => {
      await cifrarConversacion();   // asegura que lo ultimo quede guardado
      saveState();
      diaryUnlocked = false;
      diaryKey = null;
      state.auroriaMemory = [];     // el texto en claro no se queda en RAM
      renderDiary();
      renderAurorIA();
      toast("Diario bloqueado");
    });

    // aurorIA
    $("#chatForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = $("#chatInput");
      if (inp) {
        handleAurorIASend(inp.value);
        inp.value = "";
      }
    });

    // Delegado en document: las tarjetas de "sin consentimiento" se pintan
    // despues de que corre este bloque, asi que un listener directo no las veria.
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-activar-sensibles]")) activarSensibles();
    });

    $("#avatarPerfil")?.addEventListener("click", () => $("#inputFoto")?.click());
    $("#inputFoto")?.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";          // permite volver a elegir el mismo archivo
      elegirFoto(f);
    });
    $("#btnQuitarFoto")?.addEventListener("click", async () => {
      if (!state.patientId || !window.AuraFoto) return;
      await window.AuraFoto.borrar(state.patientId);
      fotoActual = null;
      dibujarAvatar(null);
      fotoEstado("Foto quitada.");
      setTimeout(() => fotoEstado(""), 3000);
    });

    $("#consentToggleBtn")?.addEventListener("click", async () => {
      const C = Consent();
      if (!C) return;
      if (C.tieneSensibles(state)) {
        if (!confirm("Si retiras tu consentimiento dejaremos de guardar tu ánimo, tu diario y tus conversaciones. Lo que ya está guardado se conserva hasta que lo borres desde Ajustes. ¿Continuar?")) return;
        state.consentimiento = C.actualizarSensibles(state, false);
        saveState();
        renderHome(); renderDiary(); renderAurorIA(); pintarConsentimiento();
        toast("Consentimiento retirado");
      } else {
        await activarSensibles();
      }
    });

    $("#olvideCodigoBtn")?.addEventListener("click", usarCodigoRecuperacion);

    $("#copiarRecuperacionBtn")?.addEventListener("click", async () => {
      const t = $("#codigoRecuperacion")?.textContent || "";
      try { await navigator.clipboard.writeText(t); toast("Código copiado"); }
      catch { toast("Cópialo a mano: " + t); }
    });

    $("#guardeRecuperacionBtn")?.addEventListener("click", () => {
      $("#vistaRecuperacion")?.classList.add("hidden");
      renderDiary();
      renderAurorIA();
    });

    $("#clearMemoryBtn")?.addEventListener("click", async () => {
      if (confirm("¿Reiniciar la memoria de aurorIA?")) {
        state.auroriaMemory = [];
        state.auroriaCifrada = null;   // sin esto, el cifrado viejo se quedaba
        saveState();
        renderAurorIA();
        computeClinicalData();
        toast("Memoria reiniciada");
      }
    });

    // Distracción / Calma
    $("#btnStartBubbles")?.addEventListener("click", startBubbles);
    $("#breatheStart")?.addEventListener("click", startBreathing);
    $("#breatheStop")?.addEventListener("click", stopBreathing);

    // Guardar Perfil
    $("#saveProfileBtn")?.addEventListener("click", () => {
      const nombre = $("#settingsName")?.value.trim() || "";
      const nacimiento = $("#settingsBirth")?.value || "";

      // Se valida con la misma funcion que el registro: si aqui se
      // pudieran borrar, la app volveria a pedirlos en el siguiente
      // arranque y se veria como un error.
      const P = window.AuraPerfil;
      if (P) {
        const motivo = P.validar(nombre, nacimiento);
        if (motivo) { toast(motivo); return; }
      }

      state.name = nombre;
      state.email = $("#settingsEmail")?.value.trim() || "";
      state.phone = $("#settingsPhone")?.value.trim() || "";
      state.birth = nacimiento;
      if (P) state.menorDeEdad = P.esMenor(nacimiento);
      saveState();
      renderHome();
      toast("Perfil guardado");
    });

    // Exportar Informe
    $("#exportBtn")?.addEventListener("click", () => {
      const clinicalReport = {
        paciente: state.name || "Anónimo",
        fechaNacimiento: state.birth || "No registrada",
        contacto: { email: state.email, phone: state.phone },
        reporteGenerado: new Date().toISOString(),
        adherenciaEjerciciosRespiracion: state.breathingCycles,
        interaccionesDistraccion: state.bubblesPopped,
        historicoMood: state.moodLogs,
        cantidadEntradasDiario: state.diaryEntries.length
      };
      const blob = new Blob([JSON.stringify(clinicalReport, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `aura_reporte_clinico_${todayKey()}.json`;
      a.click();
    });

    // Reset general
    $("#resetBtn")?.addEventListener("click", async () => {
      if (!confirm("Esto borra tu diario, tu historial de ánimo y tus conversaciones, en este teléfono y en tu cuenta. No se puede deshacer. ¿Continuar?")) return;
      state = defaultState();
      try {
        await window.AuraEstado?.guardar(state);
        await window.AuraEstado?.sincronizarYa();
      } catch (e) {
        console.warn("[Aura] borrado:", e.message);
      }
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      location.reload();
    });

    // SOS Modal Fix (Abrir y Cerrar)
    $("#tabbarSosBtn")?.addEventListener("click", () => {
      $("#sosOverlay")?.classList.add("open");
      runSosBreathe();
    });

    // El apoyo en crisis no exige tener sesion: se abre desde el login.
    $("#authSosBtn")?.addEventListener("click", () => {
      $("#sosOverlay")?.classList.add("open");
      runSosBreathe();
    });

    $("#sosClose")?.addEventListener("click", () => {
      $("#sosOverlay")?.classList.remove("open");
      stopSosBreathe();
    });

    $("#sosOverlay")?.addEventListener("click", (e) => { 
      if (e.target.id === "sosOverlay") {
        $("#sosOverlay")?.classList.remove("open"); 
        stopSosBreathe();
      }
    });

    // Service worker: sin esto no hay instalación ni caché offline
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(e => console.warn("[Aura] SW:", e));
    }

    // Botón del modal SOS que antes tronaba con ReferenceError
    $("#sosToSpecialists")?.addEventListener("click", () => {
      $("#sosOverlay")?.classList.remove("open");
      stopSosBreathe();
      showScreen("especialistas");
    });

    // Enlaces que deben salir del WebView (marcador y WhatsApp)
    $all("[data-tel]").forEach(b => b.addEventListener("click", () => {
      const num = b.dataset.tel;
      logSos("llamada_linea");
      if (window.Capacitor?.Plugins?.App) window.Capacitor.Plugins.App.openUrl({ url: `tel:${num}` });
      else window.location.href = `tel:${num}`;
    }));
    $all("[data-external]").forEach(b => b.addEventListener("click", () => {
      const url = b.dataset.external;
      if (window.Capacitor?.Plugins?.Browser) window.Capacitor.Plugins.Browser.open({ url });
      else window.open(url, "_blank", "noopener");
    }));

    // Respaldo cifrado
    $("#backupBtn")?.addEventListener("click", backupDiary);
    $("#restoreBtn")?.addEventListener("click", () => $("#restoreFile")?.click());
    $("#restoreFile")?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) restoreDiary(f);
      e.target.value = "";
    });

    // Vinculación con especialista
    $("#btnLink")?.addEventListener("click", linkTherapist);
    $("#linkCodeInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") linkTherapist(); });
    $("#btnUnlink")?.addEventListener("click", () => {
      if (!confirm("¿Dejar de compartir métricas con tu especialista?")) return;
      window.AuraSync?.unlink(state.linkedTherapist);
      state.linkedTherapist = null;
      saveState();
      renderLink();
      toast("Desvinculado");
    });

    // Consentimiento del modelo en la nube
    /* ---------- los cuatro accesos a la voz ----------
       Dos en Configuración y dos en la pantalla de aurorIA. Todos pasan
       por las mismas funciones para que no puedan desincronizarse. */

    function alternarLectura() {
      if (state.vozActiva) { apagarVoz(); toast("aurorIA ya no hablará"); }
      else if (encenderVoz(true)) { toast("aurorIA hablará en voz alta"); }
      pintarVoz();
    }

    function alternarConversar() {
      const E = window.AuraEscucha;
      if (!E || !E.disponible()) {
        toast("Este navegador no puede escuchar. Prueba con Chrome o Edge.");
        return;
      }
      if (state.vozAVoz) {
        state.vozAVoz = false;
        E.cancelar();
        pintarEscucha(false);
        saveState();
        pintarControlesVoz();
        toast("Conversación por voz apagada");
        return;
      }
      state.vozAVoz = true;
      saveState();
      pintarControlesVoz();
      // Si no va a leer las respuestas, conversar por voz queda cojo:
      // hablas y te contesta en silencio. Se enciende sola, sin saludo.
      if (!state.vozActiva) encenderVoz(false);
      toast("Habla cuando quieras");
      escucharYEnviar();
    }

    /* ---------- recordatorio ---------- */
    function horaDelCampo() {
      const v = ($("#recordatorioHora")?.value || "21:00").split(":");
      const h = Math.max(0, Math.min(23, parseInt(v[0], 10) || 0));
      const m = Math.max(0, Math.min(59, parseInt(v[1], 10) || 0));
      return { hora: h, minuto: m };
    }

    async function guardarRecordatorio(activo) {
      const R = window.AuraRecordatorio;
      if (!R || !R.disponible()) return;
      const t = horaDelCampo();

      if (!activo) {
        await R.cancelarDiario();
        state.recordatorio = { activo: false, hora: t.hora, minuto: t.minuto };
        saveState();
        pintarRecordatorio();
        toast("Recordatorio apagado");
        return;
      }

      const ok = await R.programarDiario(t.hora, t.minuto);
      if (!ok) {
        // Casi siempre es el permiso. Se dice qué pasó en vez de
        // dejar un interruptor que se prende y no hace nada.
        toast("Android no dio permiso para notificaciones. Se activa desde los ajustes del sistema.");
        state.recordatorio = { activo: false, hora: t.hora, minuto: t.minuto };
        saveState();
        pintarRecordatorio();
        return;
      }
      state.recordatorio = { activo: true, hora: t.hora, minuto: t.minuto };
      saveState();
      pintarRecordatorio();
      toast("Te avisaré a las " + String(t.hora).padStart(2, "0") + ":" + String(t.minuto).padStart(2, "0"));
    }

    $("#recordatorioSwitch")?.addEventListener("click", () => {
      guardarRecordatorio(!(state.recordatorio && state.recordatorio.activo));
    });
    // Cambiar la hora con el recordatorio encendido lo reprograma.
    $("#recordatorioHora")?.addEventListener("change", () => {
      if (state.recordatorio && state.recordatorio.activo) guardarRecordatorio(true);
      else { const t = horaDelCampo(); state.recordatorio = { activo: false, hora: t.hora, minuto: t.minuto }; saveState(); }
    });

    $("#vozSwitch")?.addEventListener("click", alternarLectura);
    $("#chipLeer")?.addEventListener("click", alternarLectura);
    $("#microfonoSwitch")?.addEventListener("click", alternarConversar);
    $("#chipConversar")?.addEventListener("click", alternarConversar);

    /* El micrófono de la barra: dicta UNA vez y deja el texto listo para
       revisar antes de mandarlo. No enciende el modo conversación. */
    $("#chatMicBtn")?.addEventListener("click", async () => {
      if (escuchando) { window.AuraEscucha?.detener(); return; }
      const texto = await escucharAlMicrofono();
      const inp = $("#chatInput");
      if (texto && inp) { inp.value = texto; inp.focus(); }
    });

    // Mientras escribe, la mascota escucha.
    $("#chatInput")?.addEventListener("input", mascotaEscucha);
    $("#chatInput")?.addEventListener("focus", mascotaEscucha);

    $("#aiConsentSwitch")?.addEventListener("click", () => {
      state.aiConsent = !state.aiConsent;
      saveState();
      renderLink();
      toast(state.aiConsent ? "aurorIA usará el modelo en la nube" : "aurorIA responderá solo con guiones locales");
    });

    // Contadores de adherencia para el expediente
    $all(".sense-tab-btn").forEach(b => b.addEventListener("click", () => {
      state.sensoryUses = (state.sensoryUses || 0) + 1; saveState();
    }));
    $all("[data-tipp]").forEach(b => b.addEventListener("click", () => {
      state.tippUses = (state.tippUses || 0) + 1; saveState(); pushMetrics("tipp");
    }));

    // El SOS abierto a mano también queda en el expediente
    $("#tabbarSosBtn")?.addEventListener("click", () => logSos("boton_sos"));

    if (window.AuraSync) window.AuraSync.init(state);
    renderLink();
    renderHome();
  });
})();