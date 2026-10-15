# Aura

App de acompañamiento en temas psicológicos. Le da a la persona herramientas
concretas para los momentos difíciles —respiración, anclaje, un diario que solo
ella puede abrir— y, si tiene terapeuta, le muestra a él su evolución en números
sin que nadie lea una sola palabra de lo que escribe.

Hecho en México. Android y PWA.

> Aura no es un servicio médico ni de emergencias y no sustituye la atención de
> un profesional de salud mental. En caso de peligro inmediato, 911.
> Línea de la Vida: 800 911 2000, gratuita, 24 horas.

---

## Las dos plataformas

**La app del paciente** (`www/`) — HTML, CSS y JavaScript sin framework ni paso
de build, empaquetada para Android con Capacitor.

- **Diario cifrado** en el dispositivo con AES-256-GCM y una llave derivada del
  PIN de 4 dígitos por PBKDF2 (100 000 iteraciones, SHA-256).
- **aurorIA**, la mascota y voz de acompañamiento, sobre Gemini vía Firebase
  AI Logic.
- **Módulo de Calma**: habilidades TIPP, meditación 9 a 0, kit de los cinco
  sentidos, lienzo de dibujo, burbujas antiestrés y listas de Spotify.
- **Botón SOS** siempre visible: enfriamiento térmico, respiración de choque
  4-2-8 y enlace directo a la línea de apoyo.

**El panel del especialista** (`web/`) — sitio público de presentación, alta de
psicólogos con cédula profesional, y expediente clínico en tiempo real: curva de
ánimo, índice de estabilidad, frecuencia de términos verbalizados, adherencia a
ejercicios, historial de SOS y notas de evolución privadas.

**El backend** — Firestore, Authentication, App Check y dos Cloud Functions
(alerta de SOS por FCM y publicación del directorio al verificar una cédula).

---

## Privacidad por diseño

Es la decisión de arquitectura que sostiene todo lo demás.

| Se queda en el teléfono | Sube al expediente |
|---|---|
| Las entradas del diario, cifradas | El ánimo diario, del 1 al 5 |
| El PIN, que nunca se transmite | Cuántas veces usó respiración o TIPP |
| El historial de conversaciones | Cuántas veces mencionó «ansiedad» y similares |
| | Cuándo activó el botón SOS |

Los conteos se calculan en el dispositivo. A la nube solo suben números: el
texto no tiene por dónde salir.

**La salvedad, dicha de frente:** si el paciente activa «aurorIA con modelo en
la nube», lo que escriba *en ese chat* sí viaja a Google para generar la
respuesta. Viene apagado de fábrica, se dice con esas palabras en la pantalla de
ajustes, y apagado aurorIA responde con guiones locales y funciona sin señal.
El diario nunca se envía, en ningún caso.

### La detección de riesgo no vive en el modelo

Tres capas, en este orden:

1. **Reglas locales.** Una lista de expresiones de riesgo se evalúa en el
   dispositivo antes de que nada salga a la red. Si acierta, se abre el SOS y se
   nombra la línea de apoyo. Sin internet, sin latencia, sin forma de rodearla
   con una frase.
2. **Gemini**, para el resto de la conversación, con los últimos 16 turnos de
   memoria.
3. **Guiones locales**, si no hay red, consentimiento o SDK compilado.

Un modelo se puede rodear, tarda dos segundos, necesita señal y falla en
silencio. Ninguna de esas cuatro cosas es aceptable a las tres de la mañana.

---

## Estructura

```
assets/          Arte fuente. De aquí se genera todo lo demás.
  marca/         iconstar.png — la estrella, ícono principal
  mascota/       hoja de personaje de aurorIA y sus recortes
www/             La app del paciente (webDir de Capacitor)
  js/            aura-auth, aura-ai, aura-sync, aura-config
web/             Sitio público, registro de especialistas y panel clínico
functions/       Cloud Functions
android/         Proyecto nativo generado por Capacitor
tools/           Scripts de arte y de compilación
firestore.rules  Las reglas que hacen cierta la promesa de privacidad
```

---

## Levantarlo

```bash
npm install
npm run build:firebase    # genera www/vendor/aura-firebase.js
npm run serve             # la app en http://localhost:5173
```

El sitio: `python3 -m http.server 5174 -d web`

Sin configurar Firebase la app **funciona completa**: aurorIA responde con
guiones locales y la vinculación con especialista queda deshabilitada.

## Compilar para Android

```bash
npm run android           # APK de depuración, lo instala si hay teléfono conectado
npm run android:release   # AAB firmado para Play
```

Requiere Android Studio con la plataforma API 36 y Java 21. Detalles en
[`tools/setup.md`](tools/setup.md).

## Regenerar el arte

```bash
npm run iconos            # iconos desde assets/marca/, recortes desde assets/mascota/
```

Nunca edites a mano lo que está en `www/icons/` ni en `web/assets/img/`: se
sobrescribe.

## Firebase

Llena `www/js/aura-config.js` y `web/assets/js/config.js` con los datos de tu
proyecto, y despliega:

```bash
npm run deploy:rules
npm run deploy:functions
npm run deploy:web
```

---

## Pendientes antes de publicar

- [ ] Reemplazar el catálogo de especialistas de demostración por lecturas de
      `/directory`. Las cédulas que aparecen hoy son inventadas y están marcadas
      como demo.
- [ ] Verificación de cédulas contra el Registro Nacional de Profesionistas:
      hoy es manual y ninguna regla permite que un terapeuta se marque
      `verified` a sí mismo.
- [ ] Guardar los tokens FCM del especialista para que la alerta de SOS suene.
- [ ] Completar el aviso de privacidad con lo que exige la LFPDPPP.
- [ ] App Check obligatorio para Firebase AI Logic a partir del 2 de noviembre
      de 2026.
- [ ] Google Play exige `targetSdk 36` (ya fijado) y, para cuentas personales,
      pruebas cerradas con 12 testers durante 14 días.

---

## Stack

Vanilla JS · Capacitor · Firebase (Firestore, Auth, App Check, AI Logic,
Functions, Hosting) · Gemini
