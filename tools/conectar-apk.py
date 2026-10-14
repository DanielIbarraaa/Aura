#!/usr/bin/env python3
# Conecta notificaciones y widgets con la app web.
import io, sys, os

RAIZ = os.path.expanduser("~/mnt/Aura APP")
n = 0

def edita(ruta, cambios):
    global n
    p = os.path.join(RAIZ, ruta)
    s = io.open(p, encoding="utf-8").read()
    for viejo, nuevo in cambios:
        c = s.count(viejo)
        if c != 1:
            print(f"  ✗ {ruta}: el ancla aparece {c} veces -> {viejo[:60]!r}")
            sys.exit(1)
        s = s.replace(viejo, nuevo)
        n += 1
    io.open(p, "w", encoding="utf-8").write(s)
    print(f"  OK {ruta}")

# ============================================================
# index.html — módulos, fila de Configuración
# ============================================================
edita("www/index.html", [
 ('<script src="js/aura-cielo.js"></script>',
  '<script src="js/aura-cielo.js"></script>\n'
  '<script src="js/aura-recordatorio.js"></script>\n'
  '<script src="js/aura-widget.js"></script>'),

 # La fila va junto a las otras de la app, después de la del micrófono.
 ('        <div class="switch" id="microfonoSwitch"></div>\n      </div>\n    </div>',
  '''        <div class="switch" id="microfonoSwitch"></div>
      </div>
      <div class="settings-row hidden" id="filaRecordatorio">
        <div>
          <strong>Recordatorio diario</strong>
          <p style="font-size:12px; color:var(--text-soft); max-width:38ch;">Un aviso a la hora que tú elijas. Lo programa tu teléfono, no un servidor: funciona sin señal y nadie más sabe a qué hora lo pusiste. En la pantalla bloqueada no se lee el texto.</p>
          <label class="campo-fecha" style="margin-top:8px; max-width:150px;">
            <span>Hora</span>
            <input type="time" id="recordatorioHora" class="input-field" value="21:00" style="margin-top:0;">
          </label>
          <p style="font-size:11.5px; color:var(--text-mute); margin-top:6px;" id="recordatorioEstado"></p>
        </div>
        <div class="switch" id="recordatorioSwitch"></div>
      </div>
    </div>'''),
])

# ============================================================
# app.js
# ============================================================
edita("www/app.js", [
 # ---------- estado ----------
 ("""    // Tu cielo: progreso que solo sube. Ver js/aura-cielo.js.
    cielo: null,""",
  """    // Tu cielo: progreso que solo sube. Ver js/aura-cielo.js.
    cielo: null,
    // Recordatorio diario. Lo pone la persona; apagado de fábrica.
    recordatorio: { activo: false, hora: 21, minuto: 0 },"""),

 # ---------- publicar al widget y celebrar ----------
 ("""    state.cielo = r.cielo;
    saveState();
    renderCielo(true);

    if (r.completada) {""",
  """    state.cielo = r.cielo;
    saveState();
    renderCielo(true);
    window.AuraWidget?.publicarCielo(state);

    if (r.completada) {"""),

 ("""      toast("Completaste " + r.completada.nombre);
    }
  }""",
  """      toast("Completaste " + r.completada.nombre);
      // Celebración, no empujón: sale porque la persona acaba de
      // terminar algo, nunca porque haya dejado de entrar.
      window.AuraRecordatorio?.celebrar(r.completada.nombre, r.completada.i);
    }
  }

  /* ---------- lo que se registró desde el widget ----------
     El widget no tiene sesión de Firebase ni forma de escribir en
     Firestore: apunta el ánimo en disco y la app lo recoge aquí, al
     arrancar. Por eso un registro hecho desde la pantalla de inicio
     aparece en la gráfica hasta el siguiente arranque. */
  async function recogerAnimoDelWidget() {
    const W = window.AuraWidget;
    if (!W || !W.disponible() || !puedeTratarSensibles()) return;

    const m = await W.recogerAnimo();
    if (!m) return;

    // Si ese día ya tenía registro en la app, gana el de la app: se
    // hizo con más contexto que un toque en la pantalla de inicio.
    const idx = state.moodLogs.findIndex(x => x.date === m.fecha);
    if (idx >= 0) return;

    state.moodLogs.push({ date: m.fecha, value: m.valor });
    saveState();
    if (m.fecha === todayKey()) encenderEstrella();
    drawChart();
    computeClinicalData();
    pintarAnimo(m.valor);
    toast("Se registró lo que marcaste en la pantalla de inicio");
  }"""),

 # ---------- al hidratar ----------
 ("""      await revisarConsentimiento();
      await revisarPerfil();""",
  """      await revisarConsentimiento();
      await revisarPerfil();
      await recogerAnimoDelWidget();
      window.AuraWidget?.publicarCielo(state);"""),

 # ---------- pintar la fila de Configuración ----------
 ("""    pintarVoz();
  }""",
  """    pintarVoz();
    pintarRecordatorio();
  }

  /* ---------- el recordatorio diario ----------
     Solo existe dentro del APK: en el navegador no hay forma de
     programar un aviso que salga con la app cerrada, así que la fila
     se esconde en vez de ofrecer algo que no va a pasar. */
  async function pintarRecordatorio() {
    const R = window.AuraRecordatorio;
    const fila = $("#filaRecordatorio");
    if (!fila) return;

    if (!R || !R.disponible()) { fila.classList.add("hidden"); return; }
    fila.classList.remove("hidden");

    const r = state.recordatorio || { activo: false, hora: 21, minuto: 0 };
    $("#recordatorioSwitch")?.classList.toggle("on", !!r.activo);
    const campo = $("#recordatorioHora");
    if (campo) {
      campo.value = String(r.hora).padStart(2, "0") + ":" + String(r.minuto).padStart(2, "0");
    }

    const est = $("#recordatorioEstado");
    if (!est) return;
    if (!r.activo) { est.textContent = ""; return; }
    const p = await R.permiso();
    est.textContent = p === "granted"
      ? "Activo. Puedes apagarlo cuando quieras."
      : "Falta el permiso de notificaciones del sistema.";
  }"""),

 # ---------- eventos ----------
 ('    $("#vozSwitch")?.addEventListener("click", alternarLectura);',
  '''    /* ---------- recordatorio ---------- */
    function horaDelCampo() {
      const v = ($("#recordatorioHora")?.value || "21:00").split(":");
      const h = Math.max(0, Math.min(23, parseInt(v[0], 10) || 0));
      const m = Math.max(0, Math.min(59, parseInt(v[1], 10) || 0));
      return { hora: h, minuto: m };
    }

    async function guardarRecordatorio(activo) {
      const R = window.AuraRecordatorio;
      if (!R || !R.disponible()) return;
      const t = horaDelCampo();

      if (!activo) {
        await R.cancelarDiario();
        state.recordatorio = { activo: false, hora: t.hora, minuto: t.minuto };
        saveState();
        pintarRecordatorio();
        toast("Recordatorio apagado");
        return;
      }

      const ok = await R.programarDiario(t.hora, t.minuto);
      if (!ok) {
        // Casi siempre es el permiso. Se dice qué pasó en vez de
        // dejar un interruptor que se prende y no hace nada.
        toast("Android no dio permiso para notificaciones. Se activa desde los ajustes del sistema.");
        state.recordatorio = { activo: false, hora: t.hora, minuto: t.minuto };
        saveState();
        pintarRecordatorio();
        return;
      }
      state.recordatorio = { activo: true, hora: t.hora, minuto: t.minuto };
      saveState();
      pintarRecordatorio();
      toast("Te avisaré a las " + String(t.hora).padStart(2, "0") + ":" + String(t.minuto).padStart(2, "0"));
    }

    $("#recordatorioSwitch")?.addEventListener("click", () => {
      guardarRecordatorio(!(state.recordatorio && state.recordatorio.activo));
    });
    // Cambiar la hora con el recordatorio encendido lo reprograma.
    $("#recordatorioHora")?.addEventListener("change", () => {
      if (state.recordatorio && state.recordatorio.activo) guardarRecordatorio(true);
      else { const t = horaDelCampo(); state.recordatorio = { activo: false, hora: t.hora, minuto: t.minuto }; saveState(); }
    });

    $("#vozSwitch")?.addEventListener("click", alternarLectura);'''),
])

# ============================================================
# sw.js
# ============================================================
edita("www/sw.js", [
 ("'./js/aura-cielo.js',",
  "'./js/aura-cielo.js', './js/aura-recordatorio.js', './js/aura-widget.js',"),
 ("const CACHE = 'aura-v19';", "const CACHE = 'aura-v20';"),
])

print(f"\n{n} cambios aplicados")
