/* Curva de ánimo: una sola serie, así que no lleva leyenda — el título la nombra.
   Línea de 2px, relleno tenue, rejilla recesiva, punto final etiquetado,
   crosshair con tooltip y tabla equivalente para lectura no visual. */

const TINTA = () => getComputedStyle(document.body).getPropertyValue("--tinta-3").trim();
const LILA  = () => getComputedStyle(document.body).getPropertyValue("--lila-600").trim();
const LINEA = () => getComputedStyle(document.body).getPropertyValue("--linea").trim();
const ROJO  = () => getComputedStyle(document.body).getPropertyValue("--rojo").trim();
// Los atributos de presentación de SVG no resuelven var(): hay que pasar el color ya calculado.
const CARTA = () => getComputedStyle(document.body).getPropertyValue("--carta").trim();

const fmtDia = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });

export function dibujarAnimo(contenedor, tooltipEl, puntos, sosFechas = []) {
  contenedor.innerHTML = "";
  if (!puntos.length) {
    contenedor.innerHTML = `<p style="padding:34px 0; text-align:center; color:var(--tinta-3); font-size:14px;">Sin registros de ánimo todavía.</p>`;
    return;
  }

  const W = 900, H = 260;
  const m = { t: 18, r: 46, b: 30, l: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = puntos.length;
  const x = (i) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.t + ih - ((v - 1) / 4) * ih;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label",
    `Curva de estado de ánimo, ${n} registros, del ${fmtDia(puntos[0].date)} al ${fmtDia(puntos[n-1].date)}.`);
  svg.style.display = "block";
  svg.style.overflow = "visible";

  const el = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

  // rejilla recesiva
  for (let v = 1; v <= 5; v++) {
    svg.appendChild(el("line", { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), stroke: LINEA(), "stroke-width": 1 }));
    const t = el("text", { x: m.l - 10, y: y(v) + 4, "text-anchor": "end", fill: TINTA(), "font-size": 11 });
    t.textContent = v; svg.appendChild(t);
  }

  const d = puntos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  // relleno tenue bajo la curva
  const grad = el("linearGradient", { id: "gAnimo", x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.appendChild(el("stop", { offset: "0%",   "stop-color": LILA(), "stop-opacity": .22 }));
  grad.appendChild(el("stop", { offset: "100%", "stop-color": LILA(), "stop-opacity": 0 }));
  const defs = el("defs", {}); defs.appendChild(grad); svg.appendChild(defs);
  svg.appendChild(el("path", { d: `${d} L${x(n-1)},${m.t+ih} L${x(0)},${m.t+ih} Z`, fill: "url(#gAnimo)", stroke: "none" }));
  svg.appendChild(el("path", { d, fill: "none", stroke: LILA(), "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));

  // marcas de SOS: color de estado + etiqueta, nunca solo color
  const setSos = new Set(sosFechas);
  puntos.forEach((p, i) => {
    if (!setSos.has(p.date)) return;
    svg.appendChild(el("line", { x1: x(i), x2: x(i), y1: m.t, y2: m.t + ih, stroke: ROJO(), "stroke-width": 1.5, "stroke-dasharray": "3 3", opacity: .55 }));
    svg.appendChild(el("circle", { cx: x(i), cy: m.t - 6, r: 3.5, fill: ROJO() }));
  });

  // punto final etiquetado (no todos: solo el que se lee de un vistazo)
  const ult = puntos[n - 1];
  svg.appendChild(el("circle", { cx: x(n-1), cy: y(ult.value), r: 4.5, fill: LILA(), stroke: CARTA(), "stroke-width": 2 }));
  const lbl = el("text", { x: x(n-1) + 10, y: y(ult.value) + 4, fill: LILA(), "font-size": 12.5, "font-weight": 700 });
  lbl.textContent = ult.value; svg.appendChild(lbl);

  // capa de interacción
  const cross = el("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, stroke: LILA(), "stroke-width": 1, opacity: 0 });
  const dot = el("circle", { r: 5, fill: LILA(), stroke: CARTA(), "stroke-width": 2, opacity: 0 });
  svg.appendChild(cross); svg.appendChild(dot);
  const capa = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" });
  svg.appendChild(capa);

  function mover(ev) {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let i = Math.round(((px - m.l) / (iw || 1)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const p = puntos[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("opacity", .35);
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(p.value)); dot.setAttribute("opacity", 1);
    tooltipEl.innerHTML = `<b>${p.value} / 5</b> · ${fmtDia(p.date)}${setSos.has(p.date) ? " · SOS" : ""}`;
    tooltipEl.style.opacity = 1;
    const rc = contenedor.getBoundingClientRect();
    tooltipEl.style.left = Math.min(rc.width - 130, Math.max(0, (x(i) / W) * rc.width - 55)) + "px";
    tooltipEl.style.top  = ((y(p.value) / H) * rc.height - 44) + "px";
  }
  capa.addEventListener("mousemove", mover);
  capa.addEventListener("touchmove", (e) => { mover(e.touches[0]); e.preventDefault(); }, { passive: false });
  capa.addEventListener("mouseleave", () => {
    cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); tooltipEl.style.opacity = 0;
  });

  contenedor.appendChild(svg);
}

export function tablaAnimo(puntos, sosFechas = []) {
  const setSos = new Set(sosFechas);
  if (!puntos.length) return `<p style="padding:20px 0; color:var(--tinta-3); font-size:14px;">Sin registros.</p>`;
  return `<table class="leyenda-tabla"><caption class="sr">Estado de ánimo por día</caption>
    <thead><tr><th>Día</th><th>Ánimo</th><th>SOS</th></tr></thead><tbody>
    ${[...puntos].reverse().map(p => `<tr><td>${fmtDia(p.date)}</td><td>${p.value} / 5</td><td>${setSos.has(p.date) ? "Sí" : "—"}</td></tr>`).join("")}
    </tbody></table>`;
}
