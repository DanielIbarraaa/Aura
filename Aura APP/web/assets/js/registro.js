import { auth, db, A, F, mensajeAuth } from "./firebase.js";
import { reservarCodigo } from "./codigo.js";

const $ = (s) => document.querySelector(s);

function aviso(html, tipo = "error") {
  $("#alerta1").innerHTML = html
    ? `<div class="aviso aviso-${tipo}" style="margin-top:20px"><span>${html}</span></div>`
    : "";
}

function leerFormulario() {
  return {
    name:         $("#nombre").value.trim(),
    cedula:       $("#cedula").value.trim(),
    especialidad: $("#especialidad").value,
    institucion:  $("#institucion").value.trim(),
    ciudad:       $("#ciudad").value.trim(),
    modalidad:    $("#modalidad").value,
    whatsapp:     $("#whatsapp").value.replace(/\D/g, ""),
    tarifa:       Number($("#tarifa").value.replace(/\D/g, "")) || null,
    email:        $("#email").value.trim()
  };
}

function validar(d, pass) {
  if (!d.name || d.name.length < 4) return "Escribe tu nombre completo.";
  if (!/^\d{7,10}$/.test(d.cedula)) return "La cédula profesional son de 7 a 10 dígitos, sin letras ni espacios.";
  if (!d.especialidad) return "Elige tu especialidad.";
  if (d.whatsapp && d.whatsapp.length < 10) return "El WhatsApp necesita 10 dígitos.";
  if (!$("#acepto").checked) return "Necesitas aceptar el aviso de privacidad para continuar.";
  if (pass !== null && pass.length < 8) return "La contraseña necesita al menos 8 caracteres.";
  return null;
}

async function crearPerfil(uid, datos) {
  // verified queda en false: la cédula se coteja a mano contra el RNP.
  // Ninguna regla de Firestore deja que el propio terapeuta lo ponga en true.
  await F.setDoc(F.doc(db, "therapists", uid), {
    ...datos,
    verified: false,
    activo: true,
    createdAt: F.serverTimestamp()
  }, { merge: true });

  const code = await reservarCodigo(uid, datos.name);
  await F.updateDoc(F.doc(db, "therapists", uid), { code });
  return code;
}

function mostrarCodigo(code) {
  $("#paso1").classList.add("oculto");
  $("#paso2").classList.remove("oculto");
  $("#codigoGenerado").textContent = code;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#formRegistro").addEventListener("submit", async (e) => {
  e.preventDefault();
  aviso("");
  const datos = leerFormulario();
  const pass = $("#pass").value;
  const err = validar(datos, pass);
  if (err) { aviso(err); return; }

  const btn = $("#btnCrear");
  btn.disabled = true; btn.textContent = "Creando tu cuenta…";
  try {
    const cred = await A.createUserWithEmailAndPassword(auth, datos.email, pass);
    await A.updateProfile(cred.user, { displayName: datos.name });
    const code = await crearPerfil(cred.user.uid, datos);
    mostrarCodigo(code);
  } catch (e2) {
    aviso(mensajeAuth(e2.code) || e2.message);
    btn.disabled = false; btn.textContent = "Crear mi cuenta";
  }
});

$("#btnGoogle").addEventListener("click", async () => {
  aviso("");
  const datos = leerFormulario();
  const err = validar(datos, null);
  if (err) { aviso(err + " Llena los datos profesionales antes de continuar con Google."); return; }
  try {
    const cred = await A.signInWithPopup(auth, new A.GoogleAuthProvider());
    datos.email = cred.user.email || datos.email;
    const code = await crearPerfil(cred.user.uid, datos);
    mostrarCodigo(code);
  } catch (e) {
    aviso(mensajeAuth(e.code) || e.message);
  }
});

$("#btnCopiar").addEventListener("click", async () => {
  const code = $("#codigoGenerado").textContent;
  try {
    await navigator.clipboard.writeText(code);
    $("#btnCopiar").textContent = "Copiado";
    setTimeout(() => ($("#btnCopiar").textContent = "Copiar código"), 1800);
  } catch {
    $("#btnCopiar").textContent = code;
  }
});

$("#cedula").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
});
