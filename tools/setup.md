# Aura — cómo verla y cómo compilarla

Todo esto se corre en la **Terminal de macOS**, dentro de la carpeta del proyecto.

---

## 1. Verla ahora, en el navegador

```bash
cd ~/Desktop/Aura\ APP
npm run serve            # http://localhost:5173
```

Cero dependencias: es el servidor que trae Python. En `localhost` sí se registra
el service worker, así que Chrome te ofrece instalarla desde la barra de
direcciones.

Más rápido todavía, aunque sin service worker: doble clic en `www/index.html`.

Para el sitio web (landing, registro, panel):

```bash
python3 -m http.server 5174 -d web    # http://localhost:5174
```

---

## 2. Compilarla para Android

```bash
npm run android            # APK de depuración, instalable
npm run android:release    # AAB firmado para Google Play
```

`tools/build-android.sh` hace, en orden:

1. Revisa que tengas Node, Java y el SDK de Android.
2. `npm install` y las dependencias de Capacitor.
3. Compila el SDK de Firebase a `www/vendor/aura-firebase.js`.
4. Crea `android/` con `npx cap add android` la primera vez.
5. Fija `targetSdk` y `compileSdk` en **36** — Play lo exige para apps nuevas
   desde el 31 de agosto de 2026.
6. Genera iconos y splash nativos desde `assets/` con `@capacitor/assets`.
7. `npx cap sync android`.
8. `./gradlew assembleDebug` (o `bundleRelease`).

El APK sale en:

    android/app/build/outputs/apk/debug/app-debug.apk

Si hay un teléfono conectado con depuración USB, el script lo instala solo.
Si no, pásate el `.apk` por AirDrop y ábrelo en el teléfono.

### Requisitos, una sola vez

* **Android Studio** instalado, con la plataforma **API 36** desde
  Settings → Languages & Frameworks → Android SDK.
* **Java 21**: la trae Android Studio, o `brew install --cask temurin@21`.
* Si `ANDROID_HOME` no está puesta, el script asume `~/Library/Android/sdk`.

### Para la versión de Play

```bash
keytool -genkeypair -v -keystore aura-release.keystore \
  -alias aura -keyalg RSA -keysize 2048 -validity 10000
```

Respalda ese archivo y su contraseña **fuera de la Mac**. Si lo pierdes no
puedes volver a actualizar la app en Play: hay que publicar una ficha nueva.

### Un detalle de la ruta

La carpeta se llama `Aura APP`, con espacio. Gradle suele aguantarlo, pero es
la causa número uno de errores raros con rutas. Si algo truena con mensajes de
ruta partida a la mitad, renómbrala a `~/Desktop/aura-app` y listo.

---

## 3. Configurar Firebase

Llena `www/js/aura-config.js` (la app) y `web/assets/js/config.js` (el sitio)
con los datos de Firebase Console → Configuración del proyecto → Tus apps.

Sin eso la app **sigue funcionando**: aurorIA responde con guiones locales y
la vinculación con especialista queda deshabilitada.

```bash
npm run deploy:rules        # firestore.rules
npm run deploy:functions    # alerta de SOS y directorio
npm run deploy:web          # publica web/ en Firebase Hosting
```

---

## 4. Regenerar el arte

Todo sale de `assets/`. Nunca edites a mano lo que está en `www/icons/` ni en
`web/assets/img/`: se sobrescribe.

```bash
npm run iconos    # equivale a los dos scripts de abajo
python3 tools/make-icons.py     # desde assets/marca/iconstar.png
python3 tools/make-mascota.py   # desde assets/mascota/aurorIA-hoja.png
```

---

## 5. Nota sobre git

Quedó un `.git/HEAD.lock` de una sesión previa. Antes del primer commit:

```bash
rm -f .git/*.lock .git/objects/*/tmp_obj_*
```
