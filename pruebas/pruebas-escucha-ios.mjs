/* =========================================================
   Pruebas del micrófono en iOS y Android dentro de la app.

   Se carga el aura-escucha.js DE VERDAD —el archivo que se va a
   compilar— dentro de un window falso, y se le ponen enfrente los tres
   entornos que existen: iOS con plugin, Android con plugin, y el
   navegador. Lo que se mide es el comportamiento observable, no que
   las funciones existan.
   ========================================================= */
import vm from "node:vm";
import fs from "node:fs";

const CODIGO = fs.readFileSync(new URL("../www/js/aura-escucha.js", import.meta.url), "utf8");

let ok = 0, mal = 0;
const prueba = (n, c, d = "") => {
  if (c) { ok++; console.log("  ok   " + n + (d ? "   " + d : "")); }
  else   { mal++; console.log("  ✗    " + n + (d ? "   " + d : "")); }
};

/* ---------- un window de mentiras ---------- */
function montar({ nativo = null, webSR = null, enApp = false, seguro = true } = {}) {
  const oyentes = {};
  const window = {
    isSecureContext: seguro,
    addEventListener() {},
    SpeechRecognition: webSR,
    Capacitor: enApp ? {
      isNativePlatform: () => true,
      Plugins: nativo ? { SpeechRecognition: nativo } : {}
    } : undefined
  };
  const document = { addEventListener() {}, hidden: false };
  const ctx = vm.createContext({ window, document, setTimeout, clearTimeout, Promise, console, String, Number, Math, JSON });
  vm.runInContext(CODIGO, ctx);
  return { E: window.AuraEscucha, oyentes };
}

/* Un plugin falso que puede comportarse como iOS o como Android. */
function pluginFalso({ estilo = "ios", permiso = "granted", disponible = true, frases = [] } = {}) {
  const oy = {};
  const llamadas = { start: 0, stop: 0, limpiar: 0 };
  const p = {
    llamadas,
    checkPermissions: async () => ({ speechRecognition: permiso }),
    requestPermissions: async () => ({ speechRecognition: permiso }),
    available: async () => ({ available: disponible }),
    addListener(ev, cb) { (oy[ev] = oy[ev] || []).push(cb); return { remove() {} }; },
    removeAllListeners() { llamadas.limpiar++; for (const k in oy) delete oy[k]; },
    async start() {
      llamadas.start++;
      if (estilo === "android") return { matches: frases.slice(-1) };
      // iOS: resuelve vacío y todo llega por los escuchas.
      queueMicrotask(() => {
        (oy["listeningState"] || []).forEach(f => f({ status: "started" }));
        frases.forEach(t => (oy["partialResults"] || []).forEach(f => f({ matches: [t] })));
      });
      return {};
    },
    async stop() {
      llamadas.stop++;
      queueMicrotask(() => (oy["listeningState"] || []).forEach(f => f({ status: "stopped" })));
    }
  };
  return p;
}

console.log("── 1. el bug que iOS iba a destapar ──");
{
  // iOS dentro de la app: NO existe window.SpeechRecognition, pero sí el
  // plugin. La versión anterior preguntaba primero por el de la web y
  // devolvía false aquí, escondiendo el botón con el plugin instalado.
  const { E } = montar({ enApp: true, nativo: pluginFalso(), webSR: null });
  prueba("con plugin y sin SpeechRecognition web, disponible() es true", E.disponible() === true);
}
{
  const { E } = montar({ enApp: true, nativo: null, webSR: null });
  prueba("dentro de la app y sin plugin, disponible() es false", E.disponible() === false,
         "(la interfaz esconde el botón en vez de ofrecer algo roto)");
}
{
  const { E } = montar({ enApp: true, nativo: null, webSR: function () {} });
  prueba("dentro de la app el SpeechRecognition web NO cuenta", E.disponible() === false,
         "(existe el objeto pero el WebView no lo implementa)");
}

console.log("── 2. el camino de iOS: todo llega por los escuchas ──");
{
  const pl = pluginFalso({ estilo: "ios", frases: ["me siento", "me siento un poco mejor hoy"] });
  const { E } = montar({ enApp: true, nativo: pl });
  const parciales = [];
  let arrancó = false;
  const pr = E.escuchar({ alParcial: t => parciales.push(t), alEmpezar: () => { arrancó = true; } });
  await new Promise(r => setTimeout(r, 20));
  prueba("avisó que el micrófono ya está abierto", arrancó);
  prueba("fue mostrando lo que entendía", parciales.length === 2, JSON.stringify(parciales));
  E.detener();
  const r = await pr;
  prueba("devuelve la frase completa", r.texto === "me siento un poco mejor hoy", JSON.stringify(r.texto));
  prueba("sin motivo de error", r.motivo === null);
  prueba("cerró el micrófono", pl.llamadas.stop === 1);
  prueba("quitó sus escuchas", pl.llamadas.limpiar === 1, "(si no, se acumulan en cada intento)");
  prueba("ya no queda activa", E.activa === false);
}

console.log("── 3. el camino de Android: start() ya trae el resultado ──");
{
  const pl = pluginFalso({ estilo: "android", frases: ["hola aurorIA"] });
  const { E } = montar({ enApp: true, nativo: pl });
  const r = await E.escuchar({});
  prueba("resuelve con lo que entendió", r.texto === "hola aurorIA", JSON.stringify(r.texto));
  prueba("sin motivo de error", r.motivo === null);
}

console.log("── 4. permisos ──");
{
  const pl = pluginFalso({ permiso: "denied" });
  const { E } = montar({ enApp: true, nativo: pl });
  const r = await E.escuchar({});
  prueba("permiso negado devuelve not-allowed", r.motivo === "not-allowed");
  prueba("no abrió el micrófono", pl.llamadas.start === 0, "(no se intenta escuchar sin permiso)");
  prueba("el mensaje manda a los ajustes del teléfono, no a la barra del navegador",
         /ajustes del tel/i.test(E.mensaje("not-allowed")), E.mensaje("not-allowed"));
}
{
  const { E } = montar({ enApp: false, webSR: function () {} });
  prueba("en el navegador el mensaje sigue hablando del candado",
         /candado/i.test(E.mensaje("not-allowed")));
}

console.log("── 5. cortar a propósito ──");
{
  const pl = pluginFalso({ estilo: "ios", frases: ["algo que no quiero mandar"] });
  const { E } = montar({ enApp: true, nativo: pl });
  const pr = E.escuchar({});
  await new Promise(r => setTimeout(r, 20));
  const sí = E.cancelar();
  const r = await pr;
  prueba("cancelar() reporta que sí cortó", sí === true);
  prueba("cancelar() DESCARTA lo entendido", r.texto === "", JSON.stringify(r.texto));
  prueba("y no lo reporta como error", r.motivo === "aborted" || r.motivo === null, String(r.motivo));
}
{
  const pl = pluginFalso({ estilo: "ios", frases: ["esto sí lo quiero"] });
  const { E } = montar({ enApp: true, nativo: pl });
  const pr = E.escuchar({});
  await new Promise(r => setTimeout(r, 20));
  E.detener();
  const r = await pr;
  prueba("detener() CONSERVA lo entendido", r.texto === "esto sí lo quiero", JSON.stringify(r.texto));
}

console.log("── 6. el plugin dice que no hay reconocimiento ──");
{
  const pl = pluginFalso({ disponible: false });
  const { E } = montar({ enApp: true, nativo: pl });
  const r = await E.escuchar({});
  prueba("devuelve no-soportado", r.motivo === "no-soportado");
  prueba("no abrió el micrófono", pl.llamadas.start === 0);
}

console.log("── 7. el navegador no se rompió ──");
{
  // El SpeechRecognition de la web, falsificado.
  function SRFalso() {}
  SRFalso.prototype.start = function () {
    queueMicrotask(() => {
      this.onstart && this.onstart();
      this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "desde el navegador" }], { 0: { transcript: "desde el navegador" }, isFinal: true })] });
      this.onend && this.onend();
    });
  };
  SRFalso.prototype.stop = function () {};
  SRFalso.prototype.abort = function () {};
  const { E } = montar({ enApp: false, webSR: SRFalso });
  prueba("disponible() en contexto seguro", E.disponible() === true);
  const r = await E.escuchar({});
  prueba("sigue entendiendo por el camino de la web", r.texto === "desde el navegador", JSON.stringify(r.texto));
}
{
  const { E } = montar({ enApp: false, webSR: function () {}, seguro: false });
  prueba("sin https no se ofrece", E.disponible() === false);
}

console.log(`\n${ok} pasaron, ${mal} fallaron`);
process.exit(mal ? 1 : 0);
