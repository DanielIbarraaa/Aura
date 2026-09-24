import { auth, db, A, F, requireAuth } from "./firebase.js";
import { dibujarAnimo, tablaAnimo } from "./grafica.js";
import * as Notas from "./notas.js";

const $ = (s) => document.querySelector(s);
let uid = null, pacienteActivo = null, metricas = null, dias = 14, verTabla = false;
let offMetricas = null, offNotas = null;
let miPerfil = null;          // therapists/{uid}, incluye la boveda
let notasCrudas = [];         // los documentos tal como llegan, ya cifrados
let pacienteAlias = null;

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
  miPerfil = p;                     // trae la boveda de notas
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
  pacienteAlias = datos.alias || null;
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
      // Lo que llega esta cifrado. Se guarda crudo y se pinta solo si la
      // boveda esta abierta; sin ella no hay nada que mostrar.
      notasCrudas = s.docs.map(d => Object.assign({ id: d.id }, d.data()));
      pintarNotas();
    }, (e) => console.warn("[panel] notas:", e.message));
}

/* =========================================================
   Notas de evolucion cifradas

   El panel entero funciona sin abrir la boveda: las metricas, el animo
   y el historial de SOS no estan cifrados porque el especialista los
   necesita para trabajar. Lo unico que exige codigo son las notas, que
   es el texto clinico.
   ========================================================= */

function vista(cual) {
  for (const k of ["notasCrear", "notasRecuperacion", "notasAbrir", "notasContenido"]) {
    const el = $("#" + k);
    if (el) el.hidden = (k !== cual);
  }
  const exp = $("#btnExportar");
  if (exp) exp.hidden = (cual !== "notasContenido");
}

function decidirVistaNotas() {
  if (!miPerfil) return;
  if (!Notas.tieneBoveda(miPerfil)) return vista("notasCrear");
  if (!Notas.abierta()) return vista("notasAbrir");
  vista("notasContenido");
}

async function pintarNotas() {
  const cont = $("#notas");
  if (!cont) return;
  decidirVistaNotas();
  if (!Notas.abierta()) return;

  if (!notasCrudas.length) {
    cont.innerHTML = `<p style="font-size:14px; color:var(--tinta-3);">Sin notas todavía.</p>`;
    return;
  }

  const partes = [];
  let ilegibles = 0;
  for (const n of notasCrudas) {
    const texto = await Notas.descifrarNota(n);
    const fecha = n.createdAt ? fmtHora(n.createdAt) : "—";
    if (texto === null) {
      ilegibles++;
      partes.push(`<div class="nota"><div class="fh">${fecha}</div><p style="color:#B4342F;">Esta nota no se pudo descifrar. Puede venir de otra bóveda.</p></div>`);
    } else {
      partes.push(`<div class="nota"><div class="fh">${fecha}</div><p>${escapar(texto)}</p></div>`);
    }
  }
  cont.innerHTML = partes.join("");
  if (ilegibles) console.warn("[panel] notas ilegibles:", ilegibles);

  await migrarNotasEnClaro();
}

/* Las notas escritas antes del cifrado siguen en claro en el servidor.
   Se convierten en cuanto hay bóveda abierta: dejarlas ahi seria
   conservar en claro justo el texto que esto existe para proteger. */
async function migrarNotasEnClaro() {
  const pendientes = notasCrudas.filter(Notas.esEnClaro);
  const aviso = $("#avisoMigracion");
  if (!pendientes.length) { if (aviso) aviso.hidden = true; return; }

  if (aviso) {
    aviso.hidden = false;
    aviso.textContent = `Cifrando ${pendientes.length} nota${pendientes.length > 1 ? "s" : ""} que venían del esquema anterior…`;
  }

  let hechas = 0, fallidas = 0;
  for (const n of pendientes) {
    try {
      const sobre = await Notas.migrarNota(n);
      if (!sobre) continue;
      await F.setDoc(
        F.doc(db, "patients", pacienteActivo, "notes", n.id),
        { iv: sobre.iv, ct: sobre.ct, therapistUid: n.therapistUid || uid, createdAt: n.createdAt }
      );
      hechas++;
    } catch (e) {
      fallidas++;
      console.warn("[panel] no se pudo migrar la nota", n.id, e.message);
    }
  }
  if (aviso) {
    aviso.textContent = fallidas
      ? `Se cifraron ${hechas} notas. ${fallidas} no se pudieron convertir y siguen como estaban.`
      : `Listo: ${hechas} nota${hechas > 1 ? "s" : ""} quedaron cifradas.`;
    setTimeout(() => { aviso.hidden = true; }, 6000);
  }
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
  pacienteAlias = nuevo.trim() || null;
  $("#pacNombre").textContent = nuevo.trim() || "Paciente";
});

$("#formNota").addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = $("#notaTexto").value.trim();
  if (!texto || !pacienteActivo) return;
  if (!Notas.abierta()) { alert("Abre tu bóveda de notas primero."); return; }

  // El texto se cifra AQUI. Lo que viaja son bytes; en ningun momento
  // sale la nota en claro hacia el servidor.
  const sobre = await Notas.cifrarNota(texto);
  await F.addDoc(F.collection(db, "patients", pacienteActivo, "notes"), {
    iv: sobre.iv, ct: sobre.ct, therapistUid: uid, createdAt: F.serverTimestamp()
  });
  $("#notaTexto").value = "";
});

addEventListener("resize", () => { if (metricas && !verTabla) pintarExpediente(); });


/* ---------- Controles de la bóveda de notas ---------- */

function errCrear(m) { const e = $("#errCrear"); if (e) e.textContent = m || ""; }
function errAbrir(m) { const e = $("#errAbrir"); if (e) e.textContent = m || ""; }

$("#btnCrearBoveda")?.addEventListener("click", async () => {
  const a = $("#codNuevo").value, b = $("#codNuevo2").value;
  errCrear("");
  if (a.length < 6) return errCrear("Usa al menos 6 caracteres.");
  if (a !== b) return errCrear("Los dos códigos no coinciden.");

  const btn = $("#btnCrearBoveda");
  btn.disabled = true; btn.textContent = "Creando…";
  try {
    const { cripto, codigoRecuperacion } = await Notas.crearBoveda(a);
    await F.updateDoc(F.doc(db, "therapists", uid), { [Notas.CAMPO_BOVEDA]: cripto });
    miPerfil = Object.assign({}, miPerfil, { [Notas.CAMPO_BOVEDA]: cripto });
    $("#codNuevo").value = ""; $("#codNuevo2").value = "";
    $("#codRecuperacion").textContent = codigoRecuperacion;
    $("#chkGuardeRec").checked = false;
    $("#btnConfirmarRec").disabled = true;
    vista("notasRecuperacion");
  } catch (e) {
    errCrear(e.message || "No se pudo crear la bóveda.");
  } finally {
    btn.disabled = false; btn.textContent = "Crear";
  }
});

// La confirmacion es obligatoria: sin marcar la casilla no se avanza.
// Del lado del paciente esto seria paternalista; aqui no, porque perder
// el codigo lo deja sin el expediente que esta obligado a conservar.
$("#chkGuardeRec")?.addEventListener("change", (e) => {
  $("#btnConfirmarRec").disabled = !e.target.checked;
});

$("#btnCopiarRec")?.addEventListener("click", async () => {
  const t = $("#codRecuperacion").textContent || "";
  try { await navigator.clipboard.writeText(t); $("#btnCopiarRec").textContent = "Copiado"; }
  catch { /* sin permiso de portapapeles: que lo copie a mano */ }
  setTimeout(() => { $("#btnCopiarRec").textContent = "Copiar"; }, 2000);
});

$("#btnConfirmarRec")?.addEventListener("click", () => {
  $("#codRecuperacion").textContent = "";   // no se queda en el DOM
  pintarNotas();
});

$("#btnAbrirBoveda")?.addEventListener("click", abrirBoveda);
$("#codAbrir")?.addEventListener("keydown", (e) => { if (e.key === "Enter") abrirBoveda(); });

async function abrirBoveda() {
  const cod = $("#codAbrir").value;
  errAbrir("");
  if (!cod) return;
  const btn = $("#btnAbrirBoveda");
  btn.disabled = true; btn.textContent = "Abriendo…";
  try {
    const ok = await Notas.abrir(miPerfil, cod);
    if (!ok) { errAbrir("Código incorrecto."); return; }
    $("#codAbrir").value = "";
    await pintarNotas();
  } finally {
    btn.disabled = false; btn.textContent = "Abrir";
  }
}

$("#btnCerrarBoveda")?.addEventListener("click", () => {
  Notas.cerrar();
  $("#notas").innerHTML = "";
  decidirVistaNotas();
});

$("#btnOlvideCod")?.addEventListener("click", async () => {
  const rec = prompt("Escribe tu código de recuperación:");
  if (!rec) return;
  const nuevo = prompt("Ahora elige un código nuevo (mínimo 6 caracteres):");
  if (!nuevo || nuevo.length < 6) { alert("El código debe tener al menos 6 caracteres."); return; }
  try {
    const cripto = await Notas.restablecer(miPerfil, rec, nuevo);
    await F.updateDoc(F.doc(db, "therapists", uid), { [Notas.CAMPO_BOVEDA]: cripto });
    miPerfil = Object.assign({}, miPerfil, { [Notas.CAMPO_BOVEDA]: cripto });
    await pintarNotas();
  } catch (e) {
    errAbrir(e.message || "No se pudo restablecer.");
  }
});

/* Exportacion del expediente en claro. Es lo que hace que cifrar sea
   compatible con el deber de conservar de la NOM-004: el especialista
   se lleva su copia y la resguarda donde guarda sus expedientes. */
$("#btnExportar")?.addEventListener("click", async () => {
  if (!Notas.abierta() || !pacienteActivo) return;
  const btn = $("#btnExportar");
  btn.disabled = true; btn.textContent = "Preparando…";
  try {
    const conFecha = notasCrudas.map(n => Object.assign({}, n, {
      fechaLegible: n.createdAt ? fmtHora(n.createdAt) : "—"
    }));
    const { contenido, ilegibles } = await Notas.exportarExpediente(
      { alias: pacienteAlias, id: pacienteActivo }, conFecha
    );
    const hoy = new Date().toISOString().slice(0, 10);
    Notas.descargar(`expediente_${(pacienteAlias || pacienteActivo).replace(/\W+/g, "_")}_${hoy}.txt`, contenido);
    if (ilegibles) alert(`Se exportó el expediente. Ojo: ${ilegibles} nota(s) no se pudieron descifrar y quedaron marcadas en el archivo.`);
  } catch (e) {
    alert(e.message || "No se pudo exportar.");
  } finally {
    btn.disabled = false; btn.textContent = "Exportar expediente";
  }
});
