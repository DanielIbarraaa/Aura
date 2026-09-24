/* =========================================================
   AURA — Logic, Clinical Engine, Calma & SOS Upgrades
   ========================================================= */
(() => {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $all = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);
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
    const btnEnviar = $("#emailSubmitBtn");
    const btnToggle = $("#toggleRegistro");

    function pintarModo() {
      campoNombre?.classList.toggle("hidden", !modoRegistro);
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
      if (!email || !pass) return;
      const antes = btnEnviar ? btnEnviar.textContent : "";
      if (btnEnviar) { btnEnviar.disabled = true; btnEnviar.textContent = "Un momento…"; }
      try {
        const u = modoRegistro
          ? await window.AuraAuth.registrarConCorreo(nombre, email, pass)
          : await window.AuraAuth.entrarConCorreo(email, pass);
        state.isLoggedIn = true;
        state.patientId = u.uid || state.patientId;
        if (u.nombre) state.name = u.nombre;
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

    const hour = new Date().getHours();
    const salute = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
    const greetingEl = $("#homeGreeting");
    if (greetingEl) greetingEl.textContent = state.name ? `${salute}, ${state.name}` : salute;
    drawChart();
    computeClinicalData();
  }

  function drawChart() {
    const svg = $("#moodChart");
    if (!svg) return;

    const w = 600, h = 120, pad = 14;
    const last30 = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = todayKey(d);
      const found = state.moodLogs.find(m => m.date === key);
      last30.push({ date: key, value: found ? found.value : null });
    }

    const recordedPoints = last30.filter(d => d.value !== null);
    
    if (recordedPoints.length === 0) {
      svg.style.display = "none";
      let emptyMsg = $("#chartEmptyMsg");
      if (!emptyMsg) {
        emptyMsg = document.createElement("div");
        emptyMsg.id = "chartEmptyMsg";
        emptyMsg.className = "chart-empty-state";
        emptyMsg.innerHTML = `<svg class="icon icon-sm"><use href="#i-bar-chart"/></svg><span>Aún no hay registros de ánimo guardados</span>`;
        svg.parentNode.appendChild(emptyMsg);
      }
      return;
    }

    svg.style.display = "block";
    const emptyMsg = $("#chartEmptyMsg");
    if (emptyMsg) emptyMsg.remove();

    const stepX = (w - pad * 2) / Math.max(last30.length - 1, 1);
    let path = "", dots = "";

    last30.forEach((d, i) => {
      if (d.value === null) return;
      const x = pad + i * stepX;
      const y = h - pad - ((d.value - 1) / 4) * (h - pad * 2);
      path += (path ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#867BB8" />`;
    });

    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#D6A6CE" stop-opacity=".45"/>
          <stop offset="100%" stop-color="#B7B2EA" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${path ? `<path d="${path} L${w - pad} ${h - pad} L${pad} ${h - pad} Z" fill="url(#cg)"/>` : ""}
      ${path ? `<path d="${path}" fill="none" stroke="#867BB8" stroke-width="2.5" stroke-linecap="round"/>` : ""}
      ${dots}
    `;
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
    appendBubble("me", text);
    state.auroriaMemory.push({ sender: "me", text });
    await guardarSeguro();

    // Riesgo inmediato: no lo delegamos a un modelo, se abre el SOS de una vez.
    if (window.AuraAI && window.AuraAI.isCrisis(text)) {
      const reply = window.AuraAI.CRISIS_REPLY;
      appendBubble("bot", reply);
      state.auroriaMemory.push({ sender: "bot", text: reply });
      await guardarSeguro();
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
    pushMetrics("chat");

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

    // Router
    $all("[data-screen]").forEach(b => b.addEventListener("click", () => showScreen(b.dataset.screen)));
    const hash = location.hash.replace("#/", "");
    showScreen(SCREENS.includes(hash) ? hash : "inicio");

    // Theme Switch
    $("#themeSwitch")?.addEventListener("click", toggleTheme);
    $("#topThemeBtn")?.addEventListener("click", toggleTheme);

    // Mood slider
    const slider = $("#moodRange");
    slider?.addEventListener("change", () => {
      if (!puedeTratarSensibles()) { toast("Necesitamos tu consentimiento para guardar esto"); return; }
      const today = todayKey();
      const idx = state.moodLogs.findIndex(m => m.date === today);
      if (idx >= 0) state.moodLogs[idx].value = Number(slider.value);
      else state.moodLogs.push({ date: today, value: Number(slider.value) });
      saveState();
      drawChart();
      computeClinicalData();
      toast("Ánimo de hoy registrado");
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
      state.name = $("#settingsName")?.value.trim() || "";
      state.email = $("#settingsEmail")?.value.trim() || "";
      state.phone = $("#settingsPhone")?.value.trim() || "";
      state.birth = $("#settingsBirth")?.value || "";
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