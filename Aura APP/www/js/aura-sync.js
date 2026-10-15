/* =========================================================
   AURA — Sincronización con el expediente del especialista
   Regla única de este archivo: aquí solo viajan números.
   Ni una línea del diario, ni una línea del chat. Si algún día
   necesitas mandar texto, no lo agregues aquí: rompe la promesa
   que la app le hace al paciente en la pantalla de vinculación.
   ========================================================= */
(() => {
  "use strict";

  const CFG = window.AURA_CONFIG || {};
  let db = null, auth = null, uid = null, ready = false, therapistUid = null;
  let lastPush = 0, pending = null, timer = null;
  const THROTTLE_MS = 15000;

  function fb() {
    const FB = window.AuraFB;
    if (!FB) throw new Error("SDK de Firebase no cargado");
    return FB;
  }

  async function init(state) {
    if (state && state.linkedTherapist) therapistUid = state.linkedTherapist.therapistUid || null;
    try {
      const FB = fb();
      const app = FB.app();
      db = FB.getFirestore(app);
      auth = FB.getAuth(app);

      // La sesión NO se abre aquí. Iniciarla es decisión del paciente, en la
      // pantalla de login; este módulo solo consume el uid que ya exista.
      // Si empezara una sesión anónima por su cuenta, el login se saltaría solo.
      FB.onAuthStateChanged(auth, (u) => {
        uid = u ? u.uid : null;
        ready = !!uid;
        markDot(ready ? "on" : "off");
        if (ready && pending) publish(pending, "reconexion");
      });

      uid = auth.currentUser ? auth.currentUser.uid : null;
      if (!uid) {
        markDot("off");
        return false;   // aún nadie dentro; se conecta cuando entre
      }
      if (state && !state.patientId) {
        state.patientId = uid;
        localStorage.setItem("aura_state_v8", JSON.stringify(state));
      }
      ready = true;
      markDot("on");
      if (pending) publish(pending, "reconexion");
      return true;
    } catch (e) {
      ready = false;
      markDot("off");
      console.warn("[Aura sync] sin conexión al expediente:", e.message);
    }
  }

  function markDot(cls) {
    document.querySelectorAll(".sync-dot").forEach(d => {
      d.classList.remove("on", "off");
      d.classList.add(cls);
    });
  }

  /* ---- Vincular con el código del especialista (AUR-XXXX) ---- */
  async function link(code) {
    const FB = fb();
    if (!ready) await init(null);
    const snap = await FB.getDoc(FB.doc(db, "codes", code));
    if (!snap.exists()) throw new Error("No encontramos ese código. Revísalo con tu especialista.");
    const data = snap.data();
    if (data.active === false) throw new Error("Ese código ya no está activo.");

    await FB.setDoc(FB.doc(db, "patients", uid), {
      therapistUid: data.therapistUid,
      code,
      alias: null,          // el especialista le pone nombre desde su panel
      linkedAt: FB.serverTimestamp(),
      lastSeen: FB.serverTimestamp()
    }, { merge: true });

    therapistUid = data.therapistUid;
    return { code, name: data.name || "Especialista", therapistUid };
  }

  async function unlink() {
    if (!ready || !uid) return;
    try {
      const FB = fb();
      await FB.updateDoc(FB.doc(db, "patients", uid), {
        therapistUid: FB.deleteField(),
        code: FB.deleteField(),
        unlinkedAt: FB.serverTimestamp()
      });
    } catch (e) {
      console.warn("[Aura sync] unlink:", e.message);
    }
  }

  /* ---- Publicar métricas (con throttle: el ánimo cambia, no cada tecla) ---- */
  function publish(metrics, reason) {
    pending = metrics;
    if (!ready) return;
    const now = Date.now();
    const wait = Math.max(0, THROTTLE_MS - (now - lastPush));
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const payload = pending; pending = null; lastPush = Date.now();
      try {
        const FB = fb();
        await FB.setDoc(FB.doc(db, "patients", uid, "metrics", "current"),
          Object.assign({}, payload, { reason, syncedAt: FB.serverTimestamp() }),
          { merge: true });
        await FB.setDoc(FB.doc(db, "patients", uid), { lastSeen: FB.serverTimestamp() }, { merge: true });
        markDot("on");
      } catch (e) {
        pending = payload;
        markDot("off");
        console.warn("[Aura sync] publish:", e.message);
      }
    }, wait);
  }

  /* ---- Alerta de SOS: documento aparte para que la Cloud Function la vea ---- */
  async function alertSos(origen) {
    if (!ready) return;
    try {
      const FB = fb();
      if (!therapistUid) return;
      await FB.addDoc(FB.collection(db, "alerts"), {
        patientId: uid,
        therapistUid,
        origen,                       // boton_sos | mencion_en_chat | llamada_linea
        at: FB.serverTimestamp(),
        read: false
      });
    } catch (e) {
      console.warn("[Aura sync] alerta SOS no enviada:", e.message);
    }
  }

  window.AuraSync = { init, link, unlink, publish, alertSos, get ready() { return ready; } };
})();
