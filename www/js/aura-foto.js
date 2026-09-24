/* =========================================================
   AURA — Foto de perfil

   DÓNDE VIVE Y POR QUÉ AHÍ
   En users/{uid}/privado/foto, su propio documento. Tres razones:

     - Las reglas ya permiten privado/{doc} solo al dueño, así que no
       hace falta tocarlas ni abrir un permiso nuevo.
     - Al estar en un documento aparte no viaja con privado/estado, que
       se lee en cada arranque. La foto se carga cuando toca y no le
       cuesta milisegundos al inicio.
     - No necesita Cloud Storage: un avatar de 256 px pesa decenas de
       kilobytes y cabe de sobra en un documento de Firestore, cuyo
       límite es 1 MiB. Montar un bucket, sus reglas y su CORS para
       esto sería más pieza de la que el problema pide.

   QUÉ SE GUARDA
   La imagen se reduce a 256x256 y se recomprime a JPEG en el propio
   teléfono ANTES de salir. No se sube el archivo original: una foto de
   cámara moderna pesa varios megabytes y traería de regalo los datos
   EXIF, que incluyen ubicación y modelo del aparato. Pasarla por un
   canvas la deja en píxeles limpios y sin metadatos.
   ========================================================= */
(function () {
  "use strict";

  var LADO = 256;              // suficiente para un avatar en pantallas 2x
  var CALIDAD = 0.82;          // JPEG: por debajo de esto se ve el bloqueo
  var MAX_BYTES = 220 * 1024;  // tope duro del dataURI resultante
  var TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

  var FB = function () { return window.AuraFB; };

  /* ---------- lectura del archivo ---------- */

  function leerArchivo(archivo) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error("No se pudo leer la imagen.")); };
      fr.readAsDataURL(archivo);
    });
  }

  function cargarImagen(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Ese archivo no parece una imagen.")); };
      img.src = src;
    });
  }

  /* ---------- recorte cuadrado centrado ----------
     Se recorta al centro en vez de deformar: una cara estirada se nota
     de inmediato y se ve peor que perder un poco de los bordes. */
  function recortarCuadrado(img) {
    var lienzo = document.createElement("canvas");
    lienzo.width = LADO; lienzo.height = LADO;
    var ctx = lienzo.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    var lado = Math.min(img.width, img.height);
    var sx = (img.width - lado) / 2;
    var sy = (img.height - lado) / 2;
    ctx.drawImage(img, sx, sy, lado, lado, 0, 0, LADO, LADO);
    return lienzo;
  }

  /** Procesa el archivo elegido y devuelve el dataURI listo para guardar. */
  async function procesar(archivo) {
    if (!archivo) throw new Error("No elegiste ninguna imagen.");
    if (archivo.type && TIPOS.indexOf(archivo.type) === -1 && archivo.type.indexOf("image/") !== 0) {
      throw new Error("Elige una imagen (JPG, PNG o WebP).");
    }
    // 25 MB de entrada: mas que eso suele ser un RAW o un video mal etiquetado.
    if (archivo.size > 25 * 1024 * 1024) throw new Error("Esa imagen pesa demasiado. Usa una más ligera.");

    var src = await leerArchivo(archivo);
    var img = await cargarImagen(src);
    var lienzo = recortarCuadrado(img);

    var uri = lienzo.toDataURL("image/jpeg", CALIDAD);
    // Si aun asi se paso (fotos con mucho detalle), se baja la calidad.
    var calidad = CALIDAD;
    while (uri.length > MAX_BYTES && calidad > 0.4) {
      calidad -= 0.12;
      uri = lienzo.toDataURL("image/jpeg", calidad);
    }
    if (uri.length > MAX_BYTES) throw new Error("No se pudo comprimir lo suficiente. Prueba con otra imagen.");
    return uri;
  }

  /* ---------- persistencia ---------- */

  function ref(uid) {
    var fb = FB();
    return fb.doc(fb.getFirestore(fb.app()), "users", uid, "privado", "foto");
  }

  async function guardar(uid, dataUri) {
    if (!uid || !FB()) return false;
    var fb = FB();
    await fb.setDoc(ref(uid), { dataUri: dataUri, actualizado: fb.serverTimestamp() });
    return true;
  }

  async function cargar(uid) {
    if (!uid || !FB()) return null;
    try {
      var snap = await FB().getDoc(ref(uid));
      return snap.exists() ? (snap.data().dataUri || null) : null;
    } catch (e) {
      console.warn("[Aura foto] no se pudo cargar:", e.message);
      return null;
    }
  }

  async function borrar(uid) {
    if (!uid || !FB()) return false;
    var fb = FB();
    // Se deja el documento con la foto vacia en vez de borrarlo: el
    // cliente no tiene permiso de delete sobre privado/* y un campo
    // nulo logra lo mismo sin pedir un permiso nuevo.
    await fb.setDoc(ref(uid), { dataUri: null, actualizado: fb.serverTimestamp() });
    return true;
  }

  /* ---------- iniciales, para cuando no hay foto ---------- */
  function iniciales(nombre) {
    var n = String(nombre || "").trim();
    if (!n) return "";
    return n.split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
  }

  window.AuraFoto = {
    LADO: LADO,
    MAX_BYTES: MAX_BYTES,
    procesar: procesar,
    guardar: guardar,
    cargar: cargar,
    borrar: borrar,
    iniciales: iniciales
  };
})();
