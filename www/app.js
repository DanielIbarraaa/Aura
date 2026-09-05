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
    diarySalt: null,
    diaryCheck: null,
    diaryEntries: [],
    auroriaMemory: [],
    breathingCycles: 0,
    bubblesPopped: 0,
    tippUses: 0,
    sensoryUses: 0,
    sosEvents: [],
    linkedTherapist: null,
    aiConsent: false,
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

      applyTheme(state.theme);
      renderHome();
      renderSettings();
      renderLink();
      renderDiary();
      drawChart();
      computeClinicalData();
      pintarSesion();
      saveState();
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
        : u.anonimo ? "Invitado · los datos viven en este teléfono"
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
    if (m.includes("plugin nativo")) return "Google todavía no está listo en Android. Entra como invitado.";
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

    $("#guestLoginForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nombre = $("#loginGuestName")?.value.trim();
      try {
        const u = await window.AuraAuth.entrarComoInvitado(nombre);
        state.patientId = u.uid || state.patientId;
      } catch (err) {
        console.warn("[Aura] invitado:", err);
      }
      state.isLoggedIn = true;
      state.name = nombre || state.name || "Invitado";
      saveState();
      cerrarOverlay();
      toast("Bienvenido/a a Aura");
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

  /* Cifrado AES-GCM + PBKDF2 */
  function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function unb64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)).buffer; }

  async function deriveKey(pin, saltB64) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: unb64(saltB64), iterations: 100000, hash: "SHA-256" },
      baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }

  async function encryptText(key, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
    return { iv: b64(iv), ct: b64(ct) };
  }

  async function decryptText(key, ivB64, ctB64) {
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, unb64(ctB64));
    return new TextDecoder().decode(dec);
  }

  function renderDiary() {
    const hasPin = !!(state.diarySalt && state.diaryCheck);
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
      if (title) title.textContent = hasPin ? "Diario protegido" : "Crea tu PIN";
      if (sub) sub.textContent = hasPin ? "Ingresa tu PIN de 4 dígitos" : "Elige un PIN de 4 dígitos para cifrar localmente tus textos";
    } else {
      renderDiaryEntries();
    }
  }

  function updatePinDots() {
    $all("#pinDots span").forEach((dot, i) => dot.classList.toggle("filled", i < pinBuffer.length));
  }

  async function handlePinInput(num) {
    if (pinBuffer.length >= 4) return;
    pinBuffer += num;
    updatePinDots();
    if (pinBuffer.length === 4) {
      const hasPin = !!(state.diarySalt && state.diaryCheck);
      if (!hasPin) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        state.diarySalt = b64(salt);
        const key = await deriveKey(pinBuffer, state.diarySalt);
        state.diaryCheck = await encryptText(key, "aura_ok");
        diaryKey = key;
        diaryUnlocked = true;
        saveState();
        toast("PIN configurado con éxito");
        renderDiary();
      } else {
        try {
          const key = await deriveKey(pinBuffer, state.diarySalt);
          const chk = await decryptText(key, state.diaryCheck.iv, state.diaryCheck.ct);
          if (chk !== "aura_ok") throw new Error();
          diaryKey = key;
          diaryUnlocked = true;
          renderDiary();
        } catch {
          const err = $("#pinError");
          if (err) err.textContent = "PIN incorrecto.";
          pinBuffer = "";
          updatePinDots();
        }
      }
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
    if (!state.auroriaMemory.length) {
      appendBubble("bot", `Hola${state.name ? ' ' + state.name : ''}, soy aurorIA. Todo lo que conversemos se queda en tu sesión local con total privacidad. ¿Cómo te sientes hoy?`);
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
    saveState();

    // Riesgo inmediato: no lo delegamos a un modelo, se abre el SOS de una vez.
    if (window.AuraAI && window.AuraAI.isCrisis(text)) {
      const reply = window.AuraAI.CRISIS_REPLY;
      appendBubble("bot", reply);
      state.auroriaMemory.push({ sender: "bot", text: reply });
      saveState();
      $("#sosOverlay")?.classList.add("open");
      runSosBreathe();
      logSos("mencion_en_chat");
      computeClinicalData();
      return;
    }

    setTyping(true);
    let reply;
    try {
      if (window.AuraAI && state.aiConsent && navigator.onLine) {
        reply = await window.AuraAI.reply(state.auroriaMemory.slice(-16), { name: state.name });
      }
    } catch (e) {
      console.warn("[Aura] aurorIA sin conexión al modelo:", e);
    }
    setTyping(false);
    if (!reply) reply = localReply(text);

    appendBubble("bot", reply);
    state.auroriaMemory.push({ sender: "bot", text: reply });
    saveState();
    computeClinicalData();
    pushMetrics("chat");
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

  /* Respaldo del diario: sale cifrado, entra cifrado. Sin el PIN no se lee. */
  function backupDiary() {
    if (!state.diarySalt || !state.diaryCheck) {
      toast("Primero crea tu PIN y una entrada");
      return;
    }
    const payload = {
      aura_backup: 1,
      createdAt: new Date().toISOString(),
      diarySalt: state.diarySalt,
      diaryCheck: state.diaryCheck,
      diaryEntries: state.diaryEntries
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
    a.download = `aura_diario_cifrado_${todayKey()}.json`;
    a.click();
    toast("Respaldo descargado. Guárdalo junto con tu PIN.");
  }

  function restoreDiary(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.aura_backup !== 1 || !data.diarySalt || !Array.isArray(data.diaryEntries)) {
          throw new Error("formato");
        }
        if (!confirm(`Este respaldo tiene ${data.diaryEntries.length} entradas y reemplaza tu diario actual. Necesitarás el PIN con el que se creó. ¿Continuar?`)) return;
        state.diarySalt = data.diarySalt;
        state.diaryCheck = data.diaryCheck;
        state.diaryEntries = data.diaryEntries;
        diaryKey = null;
        diaryUnlocked = false;
        pinBuffer = "";
        saveState();
        renderDiary();
        showScreen("diario");
        toast("Respaldo restaurado. Ingresa el PIN de ese respaldo.");
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
      const { iv, ct } = await encryptText(diaryKey, txt);
      state.diaryEntries.push({ id: uid(), date: todayKey(), iv, ct });
      saveState();
      if ($("#diaryText")) $("#diaryText").value = "";
      renderDiaryEntries();
      computeClinicalData();
      toast("Entrada cifrada y guardada");
    });

    $("#diaryLockNow")?.addEventListener("click", () => {
      diaryUnlocked = false;
      diaryKey = null;
      renderDiary();
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

    $("#clearMemoryBtn")?.addEventListener("click", () => {
      if (confirm("¿Reiniciar la memoria de aurorIA?")) {
        state.auroriaMemory = [];
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