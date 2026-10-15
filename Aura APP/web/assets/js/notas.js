/* =========================================================
   AURA — Notas de evolución cifradas (panel del especialista)

   POR QUÉ ESTE ARCHIVO EXISTE APARTE DEL DEL PACIENTE
   El esquema criptográfico es el mismo (js/aura-cripto.js: una DEK
   aleatoria envuelta por el código de acceso). Lo que cambia es la
   consecuencia de perder la llave.

   Para el paciente, perder su código significa perder su diario.
   Es suyo y es su decisión.

   Para el especialista NO. La NOM-004-SSA3-2012 lo obliga a integrar
   y conservar el expediente clínico por un mínimo de 5 años contados
   desde el último acto (numeral 5.4), y el numeral 5.16 incluye
   expresamente la atención psicológica. Un cifrado que pueda dejarlo
   sin sus propias notas no es una función de privacidad: es ponerlo
   a incumplir una norma.

   Por eso aquí hay dos cosas que del lado del paciente son opcionales
   y de este lado NO lo son:

     1. El código de recuperación es OBLIGATORIO. No se puede cerrar
        esa pantalla sin confirmar que se guardó.
     2. Existe exportación del expediente en claro, para que conserve
        su copia como la norma le exige. Cifrar protege el servidor;
        no puede convertirse en una excusa para no tener expediente.

   UNA BÓVEDA POR ESPECIALISTA, NO UNA POR PACIENTE
   La misma DEK cifra las notas de todos sus pacientes. Una llave por
   paciente multiplicaría los códigos que tiene que recordar sin
   ganar nada: quien abre una, por definición puede abrir las demás.
   ========================================================= */

const C = () => window.AuraCripto;

/* Campo donde vive la bóveda dentro de therapists/{uid}. */
export const CAMPO_BOVEDA = "cripto";

/* ---------- estado de sesión (en memoria, nunca se persiste) ---------- */
let dek = null;

export function abierta() { return dek !== null; }
export function cerrar() { dek = null; }

/* ---------- bóveda ---------- */

export function tieneBoveda(perfil) {
  return C().existe(perfil && perfil[CAMPO_BOVEDA]);
}

/**
 * Crea la bóveda del especialista. Devuelve lo que hay que guardar en
 * su documento y el código de recuperación, que se muestra UNA vez.
 */
export async function crearBoveda(codigo) {
  const v = await C().crear(codigo);
  dek = v.llave;
  return { cripto: v.cripto, codigoRecuperacion: v.codigoRecuperacion };
}

/** Abre la bóveda con el código. true si entró. */
export async function abrir(perfil, codigo) {
  const llave = await C().abrir(perfil[CAMPO_BOVEDA], codigo);
  if (!llave) return false;
  dek = llave;
  return true;
}

/** Abre con el código de recuperación y deja elegir uno nuevo. */
export async function restablecer(perfil, codigoRecuperacion, codigoNuevo) {
  const nuevo = await C().restablecerConRecuperacion(
    perfil[CAMPO_BOVEDA], codigoRecuperacion, codigoNuevo
  );
  dek = await C().abrir(nuevo, codigoNuevo);
  return nuevo;
}

/* ---------- notas ---------- */

/** Cifra el texto de una nota. Lanza si la bóveda está cerrada. */
export async function cifrarNota(texto) {
  if (!dek) throw new Error("La bóveda de notas está cerrada.");
  return C().cifrar(dek, texto);
}

/**
 * Descifra una nota. Devuelve null si no se puede en lugar de lanzar:
 * una nota ilegible no debe tumbar la lista entera del expediente.
 */
export async function descifrarNota(nota) {
  if (!dek || !nota) return null;
  // Nota del esquema viejo, todavía en claro.
  if (typeof nota.texto === "string") return nota.texto;
  if (!nota.iv || !nota.ct) return null;
  try {
    return await C().descifrar(dek, nota);
  } catch (e) {
    return null;
  }
}

/** ¿Esta nota quedó del esquema anterior, sin cifrar? */
export function esEnClaro(nota) {
  return !!(nota && typeof nota.texto === "string" && !nota.ct);
}

/* ---------- migración ----------
   Las notas escritas antes de este cambio están en claro en el
   servidor. Se cifran en cuanto el especialista abre su bóveda.

   Regla igual que del lado del paciente: se cifra y se VERIFICA cada
   una antes de escribir. Si una falla, se reporta y las demás siguen;
   aquí no se puede abortar todo como en el diario, porque son
   documentos independientes y dejar la mitad migrada es recuperable,
   mientras que no migrar ninguna deja texto clínico en claro. */
export async function migrarNota(nota) {
  if (!dek || !esEnClaro(nota)) return null;
  const sobre = await C().cifrar(dek, nota.texto);
  const comprobado = await C().descifrar(dek, sobre);
  if (comprobado !== nota.texto) throw new Error("La verificación falló al cifrar la nota.");
  return sobre;
}

/* ---------- exportación para la NOM-004 ----------
   Esto es lo que hace que cifrar sea compatible con la obligación de
   conservar. El especialista descarga su expediente en claro y lo
   guarda donde guarde sus expedientes. */
export async function exportarExpediente(paciente, notas) {
  if (!dek) throw new Error("Abre tu bóveda para exportar.");

  const lineas = [];
  lineas.push("EXPEDIENTE — NOTAS DE EVOLUCIÓN");
  lineas.push("");
  lineas.push("Paciente: " + (paciente.alias || paciente.id || "—"));
  lineas.push("Exportado: " + new Date().toLocaleString("es-MX"));
  lineas.push("Notas: " + notas.length);
  lineas.push("");
  lineas.push("Documento generado desde Aura para efectos de conservación del");
  lineas.push("expediente clínico conforme a la NOM-004-SSA3-2012, numerales 5.4");
  lineas.push("y 5.16. Resguárdalo con las mismas medidas que el resto de tu");
  lineas.push("expediente: aquí el contenido va en claro.");
  lineas.push("");
  lineas.push("=".repeat(64));

  let ilegibles = 0;
  for (const n of notas) {
    const texto = await descifrarNota(n);
    lineas.push("");
    lineas.push(n.fechaLegible || "—");
    lineas.push("-".repeat(64));
    if (texto === null) { lineas.push("[Esta nota no se pudo descifrar.]"); ilegibles++; }
    else lineas.push(texto);
  }

  return { contenido: lineas.join("\n"), ilegibles };
}

/** Dispara la descarga del expediente exportado. */
export function descargar(nombreArchivo, contenido) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contenido], { type: "text/plain;charset=utf-8" }));
  a.download = nombreArchivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
