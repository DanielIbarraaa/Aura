import { auth, A, mensajeAuth } from "./firebase.js";

const $ = (s) => document.querySelector(s);
const destino = new URLSearchParams(location.search).get("volver") || "panel.html";

function aviso(msg, tipo = "error") {
  $("#alerta").innerHTML = msg
    ? `<div class="aviso aviso-${tipo}" style="margin-top:20px"><span>${msg}</span></div>` : "";
}

A.onAuthStateChanged(auth, (u) => { if (u) location.replace(destino); });

$("#formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  aviso("");
  const btn = $("#btnEntrar");
  btn.disabled = true; btn.textContent = "Entrando…";
  try {
    await A.signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#pass").value);
    location.replace(destino);
  } catch (err) {
    aviso(mensajeAuth(err.code));
    btn.disabled = false; btn.textContent = "Entrar";
  }
});

$("#btnGoogle").addEventListener("click", async () => {
  aviso("");
  try {
    await A.signInWithPopup(auth, new A.GoogleAuthProvider());
    location.replace(destino);
  } catch (err) { aviso(mensajeAuth(err.code)); }
});

$("#btnReset").addEventListener("click", async () => {
  const correo = $("#email").value.trim();
  if (!correo) { aviso("Escribe tu correo arriba y vuelve a tocar el botón."); return; }
  try {
    await A.sendPasswordResetEmail(auth, correo);
    aviso("Te mandamos un correo para restablecer la contraseña.", "ok");
  } catch (err) { aviso(mensajeAuth(err.code)); }
});
