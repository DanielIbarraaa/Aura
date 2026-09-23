/* =========================================================
   AURA — El estado vive en Firestore, no en el teléfono
   Antes todo estaba en localStorage. Ahora la fuente de la verdad es
   users/{uid}/privado/*, y quien resuelve el modo avión es la caché
   persistente del propio SDK de Firestore (IndexedDB), que sincroniza
   sola en cuanto vuelve la señal. Por eso la app sigue funcionando sin
   internet aunque ya no guardemos nada nosotros.

   Se guarda en dos documentos, no en uno:
     privado/estado  — ánimo, contadores, preferencias, vínculo
     privado/diario  — las entradas, tal como salen del cifrado del PIN
   Separados porque el diario crece y no tiene por qué viajar cada vez
   que alguien mueve el slider del ánimo.

   Lo único que sigue en el navegador es el tema (claro/oscuro), porque
   tiene que aplicarse antes de que la sesión resuelva o la pantalla
   parpadea en blanco.
   ========================================================= */
(() => {
  "use strict";

  const VIEJA_LLAVE = "aura_state_v8";     // de aquí migramos
  const LLAVE_TEMA  = "aura_tema";

  // El documento "diario" carga todo lo cifrado y la boveda: crece, y no
  // tiene por que viajar cada vez que alguien mueve el slider del animo.
  const CAMPOS_DIARIO = ["diarySalt", "diaryCheck", "diaryEntries",
                         "cripto", "auroriaCifrada"];

  // Ultima linea de defensa. auroriaMemory es la conversacion EN CLARO que
  // la interfaz necesita en memoria; si algun dia alguien olvida cifrarla
  // antes de guardar, esta lista impide que llegue al servidor de todos
  // modos. Lo que se persiste es auroriaCifrada, nunca esto.
  const NO_SE_GUARDAN = ["isLoggedIn", "auroriaMemory"];

  let db = null, uid = null, listo = false;
  let pendiente = null, temporizador = null, guardando = false;
  const ESPERA_MS = 1200;                   // agrupa ráfagas de saveState()

  const FB = () => window.AuraFB;

  function partir(estado) {
    const diario = {}, resto = {};
    for (const k in estado) {
      if (NO_SE_GUARDAN.includes(k)) continue;
      (CAMPOS_DIARIO.includes(k) ? diario : resto)[k] = estado[k];
    }
    return { diario, resto };
  }

  /* ---------- lectura ---------- */
  async function cargar(usuarioUid) {
    const fb = FB();
    if (!fb || !fb.getFirestore) throw new Error("SDK sin compilar");
    uid = usuarioUid;
    db = fb.getFirestore(fb.app());

    const [estadoSnap, diarioSnap] = await Promise.all([
      fb.getDoc(fb.doc(db, "users", uid, "privado", "estado")),
      fb.getDoc(fb.doc(db, "users", uid, "privado", "diario"))
    ]);

    listo = true;
    const fuera = {};
    if (estadoSnap.exists()) Object.assign(fuera, estadoSnap.data());
    if (diarioSnap.exists()) Object.assign(fuera, diarioSnap.data());
    return Object.keys(fuera).length ? fuera : null;
  }

  /* ---------- escritura, agrupada ---------- */
  function guardar(estado) {
    pendiente = estado;
    if (!listo || !uid) return;
    clearTimeout(temporizador);
    temporizador = setTimeout(vaciar, ESPERA_MS);
  }

  async function vaciar() {
    if (guardando || !pendiente || !listo) return;
    const estado = pendiente; pendiente = null; guardando = true;
    try {
      const fb = FB();
      const { diario, resto } = partir(estado);
      await Promise.all([
        fb.setDoc(fb.doc(db, "users", uid, "privado", "estado"),
                  Object.assign({}, resto, { actualizado: fb.serverTimestamp() }), { merge: true }),
        fb.setDoc(fb.doc(db, "users", uid, "privado", "diario"),
                  Object.assign({}, diario, { actualizado: fb.serverTimestamp() }), { merge: true })
      ]);
    } catch (e) {
      // La caché de Firestore ya lo tiene encolado: reintenta sola al volver
      // la señal. Solo lo dejamos anotado.
      console.warn("[Aura estado] no se pudo guardar todavía:", e.message);
      pendiente = pendiente || estado;
    } finally {
      guardando = false;
      if (pendiente) { clearTimeout(temporizador); temporizador = setTimeout(vaciar, ESPERA_MS); }
    }
  }

  /** Fuerza el guardado inmediato (al cerrar sesión, al salir de la página). */
  async function sincronizarYa() {
    clearTimeout(temporizador);
    await vaciar();
  }

  /* ---------- Borrar de verdad un campo del servidor ----------
     Las cuentas creadas antes del cifrado v2 tienen la conversacion de
     aurorIA guardada EN CLARO en privado/estado. Ponerla en la lista de
     campos prohibidos evita que se vuelva a escribir, pero no borra la
     que ya esta ahi: setDoc con merge deja intacto lo que no menciona.
     Para quitarla de verdad hace falta deleteField. */
  async function olvidarCampos(...campos) {
    if (!listo || !uid || !campos.length) return false;
    const fb = FB();
    if (!fb || !fb.deleteField) return false;
    const parche = {};
    for (const c of campos) parche[c] = fb.deleteField();
    try {
      await fb.updateDoc(fb.doc(db, "users", uid, "privado", "estado"), parche);
      console.log("[Aura estado] campos eliminados del servidor:", campos.join(", "));
      return true;
    } catch (e) {
      console.warn("[Aura estado] no se pudieron eliminar:", e.message);
      return false;
    }
  }

  /* ---------- migración desde localStorage ---------- */
  /* Corre una sola vez por dispositivo. Si el teléfono trae un estado viejo
     y la nube todavía está vacía, lo sube y borra el rastro local. Si la nube
     ya tiene datos, gana la nube: el usuario pudo haber seguido en otro
     dispositivo, y sobrescribir eso sería perderle información. */
  async function migrar(estadoNube) {
    let local = null;
    try {
      const raw = localStorage.getItem(VIEJA_LLAVE);
      if (raw) local = JSON.parse(raw);
    } catch { /* corrupto: se ignora */ }
    if (!local) return { migrado: false, estado: estadoNube };

    if (estadoNube) {
      localStorage.removeItem(VIEJA_LLAVE);
      return { migrado: false, estado: estadoNube, descartadoLocal: true };
    }

    guardar(local);
    await sincronizarYa();
    localStorage.removeItem(VIEJA_LLAVE);
    console.log("[Aura estado] migrado desde localStorage a Firestore");
    return { migrado: true, estado: local };
  }

  /* ---------- tema: lo único que sigue en el navegador ---------- */
  const tema = {
    leer() { try { return localStorage.getItem(LLAVE_TEMA) || null; } catch { return null; } },
    escribir(v) { try { localStorage.setItem(LLAVE_TEMA, v); } catch {} }
  };

  /* Antes de cerrar la pestaña, intenta vaciar lo pendiente. */
  addEventListener("pagehide", () => { if (pendiente) vaciar(); });

  window.AuraEstado = {
    cargar, guardar, sincronizarYa, migrar, tema, olvidarCampos,
    get listo() { return listo; },
    get hayPendiente() { return !!pendiente; }
  };
})();
