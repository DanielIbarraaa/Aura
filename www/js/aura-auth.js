/* =========================================================
   AURA — Autenticación del paciente
   Tres caminos, en este orden:
     1. Google nativo, si corre dentro de la app de Android con
        el plugin @capacitor-firebase/authentication instalado.
     2. Google por ventana emergente, si corre en un navegador.
     3. Invitado, que en Firebase es una sesión anónima real —
        no un "modo demo": tiene uid, escribe métricas y se puede
        convertir a cuenta de Google después sin perder nada.
   Si Firebase no está configurado, nada de esto truena: la app
   guarda la sesión en local y sigue funcionando completa.
   ========================================================= */
(() => {
  "use strict";

  let auth = null, db = null, listo = false, usuario = null;
  const suscriptores = [];

  const FB = () => window.AuraFB;
  const enCapacitor = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const pluginNativo = () => window.Capacitor?.Plugins?.FirebaseAuthentication || null;

  function avisar() {
    suscriptores.forEach(cb => { try { cb(usuario); } catch (e) { console.warn("[Aura auth]", e); } });
  }

  /** Arranca Firebase Auth. Devuelve false si no hay SDK o config. */
  async function init() {
    if (listo) return true;
    try {
      const fb = FB();
      if (!fb || !fb.getAuth) throw new Error("SDK sin compilar (npm run build:firebase)");
      const app = fb.app();
      auth = fb.getAuth(app);
      db = fb.getFirestore(app);

      await new Promise((resolve) => {
        const off = fb.onAuthStateChanged(auth, (u) => {
          usuario = u ? perfilDe(u) : null;
          avisar();
          resolve();
          if (off && !listo) { /* la primera resolución basta */ }
        });
      });
      listo = true;
      return true;
    } catch (e) {
      console.warn("[Aura auth] sin conexión a Firebase:", e.message);
      listo = false;
      return false;
    }
  }

  function perfilDe(u) {
    return {
      uid: u.uid,
      anonimo: !!u.isAnonymous,
      nombre: u.displayName || null,
      email: u.email || null,
      foto: u.photoURL || null,
      proveedor: u.providerData?.[0]?.providerId || (u.isAnonymous ? "anonymous" : "desconocido")
    };
  }

  /* ---------- Google ---------- */
  async function entrarConGoogle() {
    if (!listo && !(await init())) throw new Error("Firebase no está configurado todavía.");
    const fb = FB();

    // Dentro del WebView de Android, signInWithPopup NO funciona: no hay
    // ventana emergente. Hay que pasar por el SDK nativo y luego canjear
    // la credencial en el SDK de JavaScript.
    const nativo = pluginNativo();
    if (enCapacitor()) {
      if (!nativo) {
        throw new Error("Falta el plugin nativo de Google. Entra como invitado por ahora.");
      }
      const res = await nativo.signInWithGoogle();
      const idToken = res?.credential?.idToken;
      if (!idToken) throw new Error("Google no devolvió credencial.");
      const cred = fb.GoogleAuthProvider.credential(idToken);
      const out = await fb.signInWithCredential(auth, cred);
      usuario = perfilDe(out.user);
    } else {
      const prov = new fb.GoogleAuthProvider();
      prov.setCustomParameters({ prompt: "select_account" });
      const out = await fb.signInWithPopup(auth, prov);
      usuario = perfilDe(out.user);
    }
    await guardarPerfil();
    avisar();
    return usuario;
  }

  /* ---------- Invitado (anónimo real) ---------- */
  async function entrarComoInvitado(nombre) {
    if (!listo && !(await init())) {
      // Sin Firebase: sesión puramente local, para no bloquear la app.
      usuario = { uid: null, anonimo: true, nombre: nombre || "Invitado", email: null, foto: null, proveedor: "local" };
      avisar();
      return usuario;
    }
    const fb = FB();
    const out = auth.currentUser || (await fb.signInAnonymously(auth)).user;
    usuario = perfilDe(out);
    usuario.nombre = nombre || usuario.nombre || "Invitado";
    await guardarPerfil();
    avisar();
    return usuario;
  }

  /** Convierte la sesión de invitado en cuenta de Google conservando el uid. */
  async function vincularGoogle() {
    if (!listo || !auth?.currentUser?.isAnonymous) return entrarConGoogle();
    const fb = FB();
    const nativo = pluginNativo();
    let cred;
    if (enCapacitor()) {
      if (!nativo) throw new Error("Falta el plugin nativo de Google.");
      const res = await nativo.signInWithGoogle();
      cred = fb.GoogleAuthProvider.credential(res.credential.idToken);
    } else {
      const prov = new fb.GoogleAuthProvider();
      const out = await fb.signInWithPopup(auth, prov);
      cred = fb.GoogleAuthProvider.credentialFromResult(out);
    }
    const out = await fb.linkWithCredential(auth.currentUser, cred);
    usuario = perfilDe(out.user);
    await guardarPerfil();
    avisar();
    return usuario;
  }

  /* ---------- Perfil mínimo en Firestore ---------- */
  /* Solo lo necesario para que el usuario "exista". Nada del diario,
     nada del chat: eso no sale del teléfono. */
  async function guardarPerfil(extra) {
    if (!listo || !usuario?.uid || !db) return;
    try {
      const fb = FB();
      await fb.setDoc(fb.doc(db, "users", usuario.uid), Object.assign({
        nombre: usuario.nombre || null,
        email: usuario.email || null,
        anonimo: usuario.anonimo,
        proveedor: usuario.proveedor,
        ultimoAcceso: fb.serverTimestamp()
      }, extra || {}), { merge: true });
    } catch (e) {
      console.warn("[Aura auth] no se pudo guardar el perfil:", e.message);
    }
  }

  async function salir() {
    try {
      if (enCapacitor() && pluginNativo()) await pluginNativo().signOut();
      if (listo && auth) await FB().signOut(auth);
    } catch (e) {
      console.warn("[Aura auth] salir:", e.message);
    }
    usuario = null;
    avisar();
  }

  window.AuraAuth = {
    init,
    entrarConGoogle,
    entrarComoInvitado,
    vincularGoogle,
    guardarPerfil,
    salir,
    alCambiar(cb) { suscriptores.push(cb); if (usuario) cb(usuario); },
    get usuario() { return usuario; },
    get disponible() { return listo; },
    get googleDisponible() { return !enCapacitor() || !!pluginNativo(); }
  };
})();
