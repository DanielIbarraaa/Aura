#!/usr/bin/env bash
# =========================================================
# Aura — de la carpeta a un APK instalable, en un comando.
#
#   bash tools/build-android.sh            # APK de depuración
#   bash tools/build-android.sh release    # AAB firmado para Play
#
# Se corre en la Terminal de macOS, no dentro de Claude:
# necesita internet (npm) y el SDK de Android.
# =========================================================
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"
MODO="${1:-debug}"

azul()  { printf "\033[1;35m▸ %s\033[0m\n" "$1"; }
malo()  { printf "\033[1;31m✗ %s\033[0m\n" "$1"; }
bien()  { printf "\033[1;32m✓ %s\033[0m\n" "$1"; }

# ---------- 0. Comprobaciones ----------
azul "Revisando el entorno"

case "$RAIZ" in
  *\ *) printf "\033[1;33m! La ruta tiene espacios: %s\033[0m\n" "$RAIZ"
        echo "  Gradle suele aguantarlo, pero es la causa número uno de errores raros."
        echo "  Si algo truena más abajo con rutas partidas a la mitad, renombra la"
        echo "  carpeta a ~/Desktop/aura-app y vuelve a correr esto."
        echo ;;
esac

command -v node >/dev/null || { malo "Falta Node. Instálalo con: brew install node"; exit 1; }
command -v java >/dev/null || { malo "Falta Java. Ábrelo desde Android Studio o: brew install --cask temurin@21"; exit 1; }
bien "node $(node -v) · java $(java -version 2>&1 | head -1 | cut -d'"' -f2)"

if [ -z "${ANDROID_HOME:-}" ]; then
  if [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
    bien "ANDROID_HOME → $ANDROID_HOME"
  else
    malo "No encuentro el SDK de Android."
    echo "  Abre Android Studio → Settings → Languages & Frameworks → Android SDK,"
    echo "  instala la plataforma 36, y vuelve a correr esto."
    exit 1
  fi
fi
export PATH="$ANDROID_HOME/platform-tools:$PATH"

# ---------- 1. Dependencias ----------
azul "Instalando dependencias"
npm install --silent

if [ ! -d node_modules/@capacitor/android ]; then
  npm install --silent @capacitor/core @capacitor/cli @capacitor/android \
    @capacitor/app @capacitor/browser @capacitor/preferences \
    @capacitor/splash-screen @capacitor/status-bar @capacitor/haptics
fi
if [ ! -d node_modules/@capacitor/assets ]; then
  npm install --silent -D @capacitor/assets
fi

# ---------- 1.5 Google nativo, solo si ya hay google-services.json ----------
# El plugin arrastra el Google Services Gradle plugin, que sin ese archivo
# rompe la compilación. Por eso va condicionado y no por defecto.
if [ -f google-services.json ] && [ ! -f android/app/google-services.json ]; then
  mkdir -p android/app 2>/dev/null || true
  cp google-services.json android/app/google-services.json 2>/dev/null || true
fi
if [ -f android/app/google-services.json ]; then
  if [ ! -d node_modules/@capacitor-firebase/authentication ]; then
    azul "Instalando el login nativo de Google"
    npm install --silent @capacitor-firebase/authentication firebase
  fi
  bien "google-services.json detectado — Google nativo habilitado"
else
  printf "\033[1;33m! Falta android/app/google-services.json\033[0m\n"
  echo "  Sin él, el botón de Google en el teléfono no funciona y hay que entrar"
  echo "  como invitado (que sí es una cuenta real, anónima, en Firebase)."
  echo "  Bájalo de Firebase Console → Configuración del proyecto → Tus apps → Android,"
  echo "  déjalo en la raíz del proyecto y vuelve a correr esto."
  echo
fi

# ---------- 2. El bundle de Firebase ----------
azul "Compilando el SDK de Firebase"
npm run build:firebase
bien "www/vendor/aura-firebase.js"

# ---------- 3. Proyecto Android ----------
if [ ! -d android ]; then
  azul "Creando el proyecto Android"
  npx cap add android
else
  bien "El proyecto android/ ya existe"
fi

# targetSdk 36: Play lo exige para apps nuevas desde el 31 de agosto de 2026
if [ -f android/variables.gradle ]; then
  /usr/bin/sed -i '' -E \
    -e 's/(compileSdkVersion *= *)[0-9]+/\136/' \
    -e 's/(targetSdkVersion *= *)[0-9]+/\136/' \
    android/variables.gradle
  bien "targetSdk y compileSdk en 36"
fi

# ---------- 4. Iconos y splash nativos ----------
azul "Generando iconos y splash de Android"
python3 tools/make-icons.py >/dev/null
npx capacitor-assets generate --android --iconBackgroundColor '#C9B6D6' \
  --splashBackgroundColor '#EEF0FA' --splashBackgroundColorDark '#1D182E' >/dev/null
bien "mipmaps y drawables escritos"

# ---------- 5. Sincronizar ----------
azul "Sincronizando la web con el proyecto nativo"
npx cap sync android

# ---------- 6. Compilar ----------
cd android
if [ "$MODO" = "release" ]; then
  if [ ! -f "$RAIZ/aura-release.keystore" ]; then
    malo "No hay keystore. Créalo una sola vez y guárdalo FUERA de esta Mac también:"
    echo
    echo "  keytool -genkeypair -v -keystore aura-release.keystore \\"
    echo "    -alias aura -keyalg RSA -keysize 2048 -validity 10000"
    echo
    echo "  Si lo pierdes, no puedes volver a actualizar la app en Play. Nunca."
    exit 1
  fi
  azul "Compilando el AAB firmado"
  ./gradlew bundleRelease
  bien "android/app/build/outputs/bundle/release/app-release.aab"
else
  azul "Compilando el APK de depuración"
  ./gradlew assembleDebug
  APK="$RAIZ/android/app/build/outputs/apk/debug/app-debug.apk"
  bien "$APK"
  echo
  if command -v adb >/dev/null && [ -n "$(adb devices | sed -n '2p')" ]; then
    azul "Instalando en el teléfono conectado"
    adb install -r "$APK" && bien "Aura instalada. Búscala en el cajón de apps."
  else
    echo "  Para instalarlo en tu teléfono:"
    echo "    · Con cable: activa Depuración USB y corre  adb install -r \"$APK\""
    echo "    · Sin cable: pásate el .apk por AirDrop o Drive y ábrelo en el teléfono"
    echo "      (te pedirá permitir instalación de orígenes desconocidos)."
  fi
fi
