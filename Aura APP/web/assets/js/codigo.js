/* Genera y reserva el código de invitación del especialista (AUR-XXXXXX).
   Seis caracteres de un alfabeto de 32 = mil millones de combinaciones.
   Con cuatro eran un millón, y un millón se adivina uno por uno.
   Sin I, O, 0, 1: se dictan por teléfono y se escriben a mano. */
import { db, F } from "./firebase.js";

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function candidato() {
  let s = "";
  const r = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) s += ALFABETO[r[i] % ALFABETO.length];
  return `AUR-${s}`;
}

/** Reserva un código libre para este terapeuta. Reintenta ante colisión. */
export async function reservarCodigo(uid, nombre) {
  for (let intento = 0; intento < 8; intento++) {
    const code = candidato();
    const ref = F.doc(db, "codes", code);
    try {
      // Las reglas prohíben sobrescribir un código existente, así que una
      // colisión falla aquí en vez de robarle el código a otro terapeuta.
      await F.setDoc(ref, {
        therapistUid: uid,
        name: nombre,
        active: true,
        createdAt: F.serverTimestamp()
      });
      return code;
    } catch (e) {
      if (intento === 7) throw new Error("No pudimos generar tu código. Inténtalo de nuevo.");
    }
  }
}
