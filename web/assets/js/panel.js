import { auth, db, A, F, requireAuth } from "./firebase.js";
import { dibujarAnimo, tablaAnimo } from "./grafica.js";

const $ = (s) => document.querySelector(s);
let uid = null, pacienteActivo = null, metricas = null, dias = 14, verTabla = false;
let offMetricas = null, offNotas = null;

const fmtFecha = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const h = Math.round((Date.now() - d) / 36e5);
  if (h < 1) return "hace un momento";
  if (h < 24) return `hace ${h} h`;
  const dd = Math.round(h / 24);
  if (dd === 1) return "ayer";
  if (dd < 30) return `hace ${dd} días`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
};
const fmtHora = (ts) => {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const iniciales = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();

/* ---------- sesión ---------- */
const user = await requireAuth();
uid = user.uid;

const perfil = await F.getDoc(F.doc(db, "therapists", uid));
if (!perfil.exists()) {
  location.replace("registro.html");
} else {
  const p = perfil.data();
  $("#miNombre").textContent = p.name || user.email;
  $("#miCodigo").textContent = p.code || "AUR-••••••";
  $("#codigoInline").textContent = p.code || "AUR-••••••";
  if (p.verified === false) {
    $("#miCodigo").insertAdjacentHTML("afterend",
      `<span class="pastilla p-alerta" title="Tu cédula sigue en revisión">Cédula en revisión</span>`);
  }
}

$("#btnSalir").addEventListener("click", async () => {
  await A.signOut(auth);
  location.replace("index.html");
});

/* ---------- lista de pacientes, en vivo ---------- */
F.onSnapshot(
  F.query(F.collection(db, "patients"), F.where("therapistUid", "==", uid)),
  (snap) => {
    const cont = $("#listaPacientes");
    cont.innerHTML = "";
    $("#listaVacia").classList.toggle("oculto", !snap.empty);
    const docs = snap.docs.sort((a, b) => (b.data().lastSeen?.seconds || 0) - (a.data().lastSeen?.seconds || 0));
    docs.forEach((d) => {
      const p = d.data();
      const nombre = p.alias || `Paciente ${d.id.slice(0, 4).toUpperCase()}`;
      const b = document.createElement("button");
      b.className = "paciente";
      b.setAttribute("aria-current", d.id === pacienteActivo ? "true" : "false");
      b.innerHTML = `<span class="ini">${iniciales(nombre)}</span>
        <span><span class="nm">${nombre}</span><span class="mt">Activo ${fmtFecha(p.lastSeen)}</span></span>`;
      b.addEventListener("click", () => abrirPaciente(d.id, p));
      cont.appendChild(b);
    });
  },
  (e) => console.warn("[panel] pacientes:", e.message)
);

/* ---------- expediente ---------- */
function abrirPaciente(id, datos) {
  pacienteActivo = id;
  $("#sinSeleccion").classList.add("oculto");
  $("#expediente").classList.remove("oculto");
  $("#pacNombre").textContent = datos.alias || `Paciente ${id.slice(0, 4).toUpperCase()}`;
  $("#pacCodigo").textContent = datos.code || "—";
  $("#pacVisto").textContent = fmtFecha(datos.lastSeen);
  document.querySelectorAll(".paciente").forEach(b => b.setAttribute("aria-current", "false"));

  offMetricas?.();
  offMetricas = F.onSnapshot(F.doc(db, "patients", id, "metrics", "current"), (s) => {
    metricas = s.exists() ? s.data() : null;
    pintarExpediente();
  }, (e) => console.warn("[panel] métricas:", e.message));

  offNotas?.();
  offNotas = F.onSnapshot(
    F.query(F.collection(db, "patients", id, "notes"), F.orderBy("createdAt", "desc")),
    (s) => {
      $("#notas").innerHTML = s.empty
        ? `<p style="font-size:14px; color:var(--tinta-3);">Sin notas todavía.</p>`
        : s.docs.map(d => {
            const n = d.data();
            return `<div class="nota"><div class="fh">${n.createdAt ? fmtHora(n.createdAt) : "—"}</div><p>${escapar(n.texto)}</p></div>`;
          }).join("");
    }, (e) => console.warn("[panel] notas:", e.message));
}

const escapar = (s) => (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function pintarExpediente() {
  if (!metricas) {
    $("#tiles").innerHTML = `<div class="tile"><div class="et">Sin datos</div><div class="sub" style="margin-top:8px">El expediente se llena cuando el paciente registra su ánimo o usa una técnica.</div></div>`;
    $("#grafica").innerHTML = ""; $("#terminos").innerHTML = ""; $("#sosLista").innerHTML = "";
    $("#avisoSos").classList.add("oculto");
    return;
  }

  const curva = (metricas.moodCurve || []).slice(-dias);
  const sos = metricas.sosEvents || [];
  const sosFechas = sos.map(e => (e.at || "").slice(0, 10));
  const sosRecientes = sos.filter(e => Date.now() - new Date(e.at) < 7 * 864e5);

  // aviso de episodios recientes, arriba de todo
  const av = $("#avisoSos");
  if (sosRecientes.length) {
    av.className = "aviso aviso-alerta";
    av.innerHTML = `<span><b>${sosRecientes.length} ${sosRecientes.length === 1 ? "activación" : "activaciones"} del SOS en los últimos 7 días.</b> Vale la pena abrirlo en la próxima sesión.</span>`;
    av.classList.remove("oculto");
  } else {
    av.classList.add("oculto");
  }

  const tile = (et, val, sub) => `<div class="tile"><div class="et">${et}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const estab = metricas.stabilityVariance;
  const estabTxt = estab === null || estab === undefined ? "—"
    : estab < 0.6 ? "Alta" : estab < 1.4 ? "Media" : "Baja";
  const estabSub = estab === null || estab === undefined ? "sin registros suficientes"
    : `varianza ${estab.toFixed(2)} · ${metricas.stabilityLabel || ""}`.replace(/ · $/, "");

  $("#tiles").innerHTML = [
    tile("Ánimo promedio", metricas.moodAvg14 != null ? `${metricas.moodAvg14}<span style="font-size:15px;color:var(--tinta-3)"> / 5</span>` : "—", `últimos 14 días · ${curva.length} registros`),
    tile("Estabilidad", estabTxt, estabSub),
    tile("Respiración", metricas.breathingCycles ?? 0, "ciclos completados"),
    tile("Habilidades TIPP", metricas.tippUses ?? 0, "veces abiertas"),
    tile("Kit sensorial", metricas.sensoryUses ?? 0, "ejercicios"),
    tile("Activaciones SOS", sos.length, sos.length ? `última ${fmtFecha(sos[sos.length-1].at)}` : "ninguna")
  ].join("");

  if (verTabla) {
    $("#grafica").classList.add("oculto");
    $("#tablaAnimo").classList.remove("oculto");
    $("#tablaAnimo").innerHTML = tablaAnimo(curva, sosFechas);
  } else {
    $("#tablaAnimo").classList.add("oculto");
    $("#grafica").classList.remove("oculto");
    dibujarAnimo($("#grafica"), $("#tooltip"), curva, sosFechas);
  }

  const tf = metricas.clinicalTermFreq || {};
  const pares = Object.entries(tf).sort((a, b) => b[1] - a[1]);
  $("#terminos").innerHTML = pares.length
    ? pares.map(([t, c]) => `<span class="termino">${escapar(t)} <b>${c}</b></span>`).join("")
    : `<span style="font-size:14px; color:var(--tinta-3);">Sin menciones registradas.</span>`;

  $("#sosLista").innerHTML = sos.length
    ? [...sos].reverse().map(e => {
        const origen = { boton_sos: "Abrió el módulo SOS", mencion_en_chat: "Mención de riesgo en aurorIA", llamada_linea: "Marcó la línea de apoyo" }[e.origen] || e.origen;
        return `<div class="evento"><span class="fh">${fmtHora(e.at)}</span><span>${origen}</span></div>`;
      }).join("")
    : `<p style="font-size:14px; color:var(--tinta-3);">Sin activaciones registradas.</p>`;
}

/* ---------- controles ---------- */
document.querySelectorAll(".rango button[data-dias]").forEach(b => {
  b.addEventListener("click", () => {
    dias = Number(b.dataset.dias);
    document.querySelectorAll(".rango button[data-dias]").forEach(o => o.setAttribute("aria-pressed", String(o === b)));
    pintarExpediente();
  });
});
$("#btnTabla").addEventListener("click", () => {
  verTabla = !verTabla;
  $("#btnTabla").setAttribute("aria-pressed", String(verTabla));
  $("#btnTabla").textContent = verTabla ? "Gráfica" : "Tabla";
  pintarExpediente();
});

$("#btnRenombrar").addEventListener("click", async () => {
  if (!pacienteActivo) return;
  const actual = $("#pacNombre").textContent;
  const nuevo = prompt("¿Con qué nombre quieres ver a este paciente en tu panel?", actual === "—" ? "" : actual);
  if (nuevo === null) return;
  await F.updateDoc(F.doc(db, "patients", pacienteActivo), { alias: nuevo.trim() || null });
  $("#pacNombre").textContent = nuevo.trim() || "Paciente";
});

$("#formNota").addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = $("#notaTexto").value.trim();
  if (!texto || !pacienteActivo) return;
  await F.addDoc(F.collection(db, "patients", pacienteActivo, "notes"), {
    texto, therapistUid: uid, createdAt: F.serverTimestamp()
  });
  $("#notaTexto").value = "";
});

addEventListener("resize", () => { if (metricas && !verTabla) pintarExpediente(); });
