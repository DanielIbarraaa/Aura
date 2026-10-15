/* =========================================================
   AURA — Catálogo de especialistas
   Lee /directory, que es la única colección de lectura pública del
   proyecto. Ahí solo llegan terapeutas cuya cédula ya fue verificada
   a mano: los escribe la Cloud Function publicarDirectorio con el
   Admin SDK, nunca el propio terapeuta. Por eso este catálogo se
   puede mostrar sin sesión iniciada y sin riesgo de que alguien se
   auto-publique.
   ========================================================= */
(() => {
  "use strict";

  let cargado = false;

  const esc = (v) => String(v == null ? "" : v)
    .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const iniciales = (n) => (n || "?").trim().split(/\s+/).slice(0, 2)
    .map(w => w[0]).join("").toUpperCase();

  function whatsapp(numero, nombre) {
    const limpio = String(numero || "").replace(/\D/g, "");
    if (limpio.length < 10) return null;
    const con52 = limpio.length === 10 ? "52" + limpio : limpio;
    const texto = encodeURIComponent(
      `Hola ${nombre}, vengo desde la app Aura y me gustaría agendar una sesión.`);
    return `https://wa.me/${con52}?text=${texto}`;
  }

  function tarjeta(d) {
    const wa = whatsapp(d.whatsapp, d.name || "");
    const modalidades = String(d.modalidad || "")
      .split(/\s+y\s+|,/)
      .map(m => m.trim())
      .filter(Boolean)
      .map(m => m.charAt(0).toUpperCase() + m.slice(1));   // "en línea" -> "En línea"

    return `
      <div class="card glass psy-card-box">
        <div>
          <div class="psy-header">
            <div class="psy-avatar-circle">${esc(iniciales(d.name))}</div>
            <div>
              <h3 style="font-size:16.5px;">${esc(d.name || "Especialista")}</h3>
              ${d.especialidad ? `<div style="font-size:13px; color:var(--text-soft);">${esc(d.especialidad)}</div>` : ""}
              ${d.cedula ? `<div class="psy-cedula-tag">Cédula Prof: ${esc(d.cedula)}</div>` : ""}
            </div>
          </div>
          ${modalidades.length ? `<div style="margin:10px 0; display:flex; gap:6px; flex-wrap:wrap;">
            ${modalidades.map((m, i) => `<span class="chip${i === 0 ? " on" : ""}">${esc(m)}</span>`).join("")}
          </div>` : ""}
          ${d.ciudad ? `<p style="font-size:13px; color:var(--text-soft); margin-bottom:10px;">
            <strong>Ubicación:</strong> ${esc(d.ciudad)}</p>` : ""}
          ${d.institucion ? `<p style="font-size:12.5px; color:var(--text-mute); margin-bottom:10px;">
            Cédula expedida por ${esc(d.institucion)}</p>` : ""}
          ${d.tarifa ? `<div style="font-size:18px; font-weight:800; color:var(--text); margin-bottom:16px;">
            $${esc(d.tarifa)} <span style="font-size:13px; font-weight:400; color:var(--text-soft);">/ sesión</span>
          </div>` : ""}
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${wa
            ? `<button class="glass-btn primary block" data-external="${esc(wa)}">
                 <svg class="icon icon-sm"><use href="#i-message-circle"/></svg>Contactar por WhatsApp
               </button>`
            : `<p style="font-size:12.5px; color:var(--text-mute); text-align:center;">
                 Sin contacto directo publicado</p>`}
          ${d.code ? `<p style="font-size:11.5px; color:var(--text-mute); text-align:center;">
            Su código de vinculación es <b class="mono">${esc(d.code)}</b></p>` : ""}
        </div>
      </div>`;
  }

  function estado(cargando, vacio) {
    $id("directorioCargando")?.classList.toggle("hidden", !cargando);
    $id("directorioVacio")?.classList.toggle("hidden", !vacio);
  }

  const $id = (x) => document.getElementById(x);

  async function render(forzar) {
    const lista = $id("directorioLista");
    if (!lista || (cargado && !forzar)) return;

    const FB = window.AuraFB;
    if (!FB || !FB.getDocs) {
      // Sin SDK compilado no hay catálogo, pero la pantalla no se rompe.
      lista.innerHTML = "";
      estado(false, true);
      cargado = true;
      return;
    }

    estado(true, false);
    console.log("[Aura directorio] pidiendo /directory…");
    try {
      const db = FB.getFirestore(FB.app());
      // Firestore puede quedarse esperando indefinidamente si no logra hablar
      // con el servidor. Ocho segundos y damos la cara en vez de girar para siempre.
      const snap = await Promise.race([
        FB.getDocs(FB.collection(db, "directory")),
        new Promise((_, rechaza) =>
          setTimeout(() => rechaza(new Error("tiempo agotado: Firestore no respondió en 8 s")), 8000))
      ]);
      console.log("[Aura directorio] recibidos", snap.docs.length, "documentos");
      const docs = snap.docs.map(d => Object.assign({ uid: d.id }, d.data()));
      docs.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));

      lista.innerHTML = docs.map(tarjeta).join("");
      estado(false, docs.length === 0);
      cargado = true;

      // Los enlaces recién creados necesitan el mismo ruteo nativo que el resto.
      lista.querySelectorAll("[data-external]").forEach(b => {
        b.addEventListener("click", () => {
          const url = b.dataset.external;
          if (window.Capacitor?.Plugins?.Browser) window.Capacitor.Plugins.Browser.open({ url });
          else window.open(url, "_blank", "noopener");
        });
      });
    } catch (e) {
      console.error("[Aura directorio] falló:", e.code || "", e.message, e);
      lista.innerHTML = `<div class="card glass" style="padding:20px 22px;">
        <strong style="font-size:15px;">No se pudo cargar el catálogo</strong>
        <p style="font-size:13px; color:var(--text-soft); margin-top:6px; line-height:1.5;">
          ${esc(e.code || "")} ${esc(e.message || "error desconocido")}
        </p>
        <p style="font-size:12px; color:var(--text-mute); margin-top:10px;">
          Abre la consola del navegador para ver el detalle completo.
        </p>
      </div>`;
      estado(false, false);
    }
  }

  window.AuraDirectorio = { render, invalidar() { cargado = false; } };
})();
