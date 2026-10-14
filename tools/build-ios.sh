#!/usr/bin/env bash
# =========================================================
# Aura — de la carpeta a la app corriendo en tu iPhone.
#
#   bash tools/build-ios.sh
#
# Se corre en la Terminal de macOS, no dentro de Claude: necesita
# Xcode, y Xcode solo existe en macOS.
#
# LO QUE ESTE SCRIPT NO HACE: firmar la app. Eso depende de tu cuenta
# de Apple y se configura UNA vez en Xcode, con el ratón. El script
# deja todo lo demás listo y al final te dice qué tocar.
# =========================================================
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"

azul() { printf "\033[1;35m▸ %s\033[0m\n" "$1"; }
malo() { printf "\033[1;31m✗ %s\033[0m\n" "$1"; }
bien() { printf "\033[1;32m✓ %s\033[0m\n" "$1"; }
ojo()  { printf "\033[1;33m! %s\033[0m\n" "$1"; }

# ---------- 0. Comprobaciones ----------
azul "Revisando el entorno"

[ "$(uname)" = "Darwin" ] || { malo "Esto solo corre en macOS. Xcode no existe en otro sistema."; exit 1; }
command -v node >/dev/null || { malo "Falta Node. Instálalo con: brew install node"; exit 1; }

if ! command -v xcodebuild >/dev/null; then
  malo "Falta Xcode."
  echo "  Bájalo de la Mac App Store. Son ~10 GB y tarda un buen rato;"
  echo "  déjalo descargando y vuelve a correr esto después."
  exit 1
fi

DEV="$(xcode-select -p 2>/dev/null || true)"
case "$DEV" in
  *CommandLineTools*|"")
    malo "xcode-select apunta a las Command Line Tools, no a Xcode."
    echo "  Con eso se compila C, pero no se arma una app de iPhone. Arréglalo:"
    echo
    echo "    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    echo
    exit 1 ;;
esac

if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  ojo "A Xcode le falta terminar su primera configuración. Corre esto y repite:"
  echo "    sudo xcodebuild -runFirstLaunch"
  exit 1
fi
bien "Xcode $(xcodebuild -version | head -1 | awk '{print $2}') · node $(node -v)"

# CocoaPods: Capacitor lo usa para meter los plugins nativos al proyecto.
if ! command -v pod >/dev/null; then
  azul "Falta CocoaPods — instalándolo"
  if command -v brew >/dev/null; then
    brew install cocoapods
  else
    malo "Falta CocoaPods y no hay Homebrew para instalarlo sin contraseña."
    echo "  Corre UNO de estos dos a mano y vuelve a abrir esto:"
    echo "    /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"  # Homebrew"
    echo "    sudo gem install cocoapods                                          # o directo"
    exit 1
  fi
fi
bien "CocoaPods $(pod --version)"

# ---------- 1. Dependencias ----------
azul "Instalando dependencias"
npm install --silent
[ -d node_modules/@capacitor/ios ] || npm install --silent @capacitor/ios
# El micrófono: ni el WKWebView de iOS ni el WebView de Android traen
# SpeechRecognition. Este plugin es el que de verdad escucha.
[ -d node_modules/@capacitor-community/speech-recognition ] || npm install --silent @capacitor-community/speech-recognition
[ -d node_modules/@capacitor/assets ] || npm install --silent -D @capacitor/assets
bien "node_modules al día"

# ---------- 2. Firebase nativo ----------
if [ -f GoogleService-Info.plist ]; then
  bien "GoogleService-Info.plist detectado"
else
  ojo "No hay GoogleService-Info.plist"
  echo "  Aura habla con Firebase desde el WebView con el SDK de la web, así que"
  echo "  la app abre y funciona sin ese archivo. Lo que NO va a funcionar es"
  echo "  App Check nativo."
  echo "  Si lo quieres: Firebase Console → Configuración del proyecto → Tus apps →"
  echo "  Agregar app → iOS, con el identificador  mx.pixelium.aura , y deja el"
  echo "  archivo en la raíz del proyecto."
  echo
fi

# ---------- 3. El bundle de Firebase ----------
azul "Compilando el SDK de Firebase"
npm run build:firebase
bien "www/vendor/aura-firebase.js"

# ---------- 4. Proyecto iOS ----------
if [ ! -d ios ]; then
  azul "Creando el proyecto iOS"
  npx cap add ios
else
  bien "El proyecto ios/ ya existe"
fi

if [ -f GoogleService-Info.plist ] && [ ! -f ios/App/App/GoogleService-Info.plist ]; then
  cp GoogleService-Info.plist ios/App/App/GoogleService-Info.plist
  ojo "Copié GoogleService-Info.plist a ios/App/App/"
  echo "  En Xcode hay que arrastrarlo al target App para que se incluya en la compilación."
fi

# ---------- 5. Iconos y pantalla de inicio ----------
azul "Generando iconos y splash de iOS"
python3 tools/make-icons.py >/dev/null
npx capacitor-assets generate --ios \
  --splashBackgroundColor '#EEF0FA' --splashBackgroundColorDark '#1D182E' >/dev/null
bien "AppIcon y LaunchScreen"

# ---------- 6. Permisos del Info.plist ----------
# Esto no es opcional ni cosmético: si la app toca el micrófono SIN estas
# dos llaves declaradas, iOS no muestra un error, TUMBA la app en ese
# instante. Y Apple rechaza la revisión si el texto no explica para qué.
azul "Declarando los permisos en el Info.plist"
PLIST="ios/App/App/Info.plist"
poner() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST" >/dev/null
}
poner NSMicrophoneUsageDescription "Aura usa el micrófono solo mientras mantienes el botón de hablar, para convertir en texto lo que dices. Nunca escucha en segundo plano."
poner NSSpeechRecognitionUsageDescription "Tu voz se convierte en texto con el reconocimiento de Apple, lo que implica que el audio sale del teléfono. Siempre puedes escribir en vez de hablar."
bien "micrófono y reconocimiento de voz declarados"

# ---------- 7. Sincronizar ----------
azul "Sincronizando la web con el proyecto nativo"
npx cap sync ios
bien "ios/App/App/public actualizado"

# ---------- 8. ¿Está el iPhone ahí? ----------
echo
if xcrun devicectl list devices 2>/dev/null | grep -qi "iphone"; then
  bien "Veo un iPhone conectado"
else
  ojo "No veo ningún iPhone conectado"
  echo "  Conéctalo por cable, desbloquéalo y dale \"Confiar\" cuando pregunte."
fi

# ---------- 9. A Xcode ----------
echo
azul "Abriendo Xcode"
npx cap open ios

cat <<'FIN'

──────────────────────────────────────────────────────────────
  LO QUE FALTA, Y LO TIENES QUE HACER TÚ (una sola vez)
──────────────────────────────────────────────────────────────

  Xcode se está abriendo. Adentro:

  1. En la columna izquierda, hasta arriba, haz clic en "App"
     (el icono azul). Luego la pestaña "Signing & Capabilities".

  2. Palomea "Automatically manage signing".
     En "Team" elige tu Apple ID. Si no aparece ninguno:
        Xcode → Settings → Accounts → + → Apple ID → entra con el tuyo.

  3. Si marca que el Bundle Identifier ya está tomado, cámbialo a algo
     tuyo, por ejemplo  mx.pixelium.aura.dan

  4. Arriba, junto al botón ▶, elige tu iPhone en la lista de destinos.

  5. Dale ▶ (o ⌘R).

  LA PRIMERA VEZ va a fallar con "Untrusted Developer". Es normal:
  en el iPhone ve a Ajustes → General → VPN y gestión de dispositivos,
  entra a tu Apple ID y dale "Confiar". Luego ▶ otra vez.

  OJO CON LA CUENTA GRATIS
  Firmada con un Apple ID normal, la app deja de abrir a los 7 DÍAS.
  No se borra: hay que reconectar el iPhone y volver a darle ▶.
  Con la cuenta de pago (99 USD al año) dura un año y puedes mandarla
  por TestFlight.

  DE AQUÍ EN ADELANTE
  Cada vez que cambies algo de www/, basta con:
      npx cap sync ios        (y ▶ en Xcode)
  No hace falta volver a correr este script completo.

FIN
