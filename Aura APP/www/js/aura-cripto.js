/* =========================================================
   AURA — Cifrado del lado del dispositivo (esquema v2)

   POR QUÉ ESTE ARCHIVO EXISTE
   El esquema anterior derivaba la llave de cifrado directo del
   PIN. Eso tenía tres problemas:
     1. Cambiar el PIN obligaba a re-cifrar cada entrada.
     2. Cada entrada era un oráculo para adivinar el PIN.
     3. 100,000 iteraciones quedaron por debajo de lo que OWASP
        recomienda hoy (600,000 para PBKDF2-HMAC-SHA256).

   CÓMO FUNCIONA AHORA — cifrado de sobre
     código de acceso
        └─ PBKDF2-SHA256, 600k iteraciones ──> KEK
              └─ envuelve ──> DEK (256 bits, aleatoria)
                    └─ cifra el diario y las conversaciones

   La DEK nunca cambia. Cambiar el código solo vuelve a envolverla:
   una operación, no mil. Y como AES-GCM autentica, desenvolver con
   un código equivocado falla sola: no hace falta guardar un
   verificador aparte, que era justo el oráculo del esquema viejo.

   LO QUE ESTO NO RESUELVE — dilo en voz alta, no lo escondas
   Un código de 6 dígitos son un millón de combinaciones. Contra
   alguien que se robe una copia completa de la base y la ataque
   sin prisa, un millón de combinaciones caen en minutos por más
   iteraciones que le pongas. El cifrado protege frente a quien
   mire la base de datos, que es su propósito real. Para protección
   de verdad hay que usar frase de acceso, y por eso la opción
   existe aquí.
   ========================================================= */
(function () {
  "use strict";

  var VERSION = 2;
  var ITERACIONES = 600000;      // OWASP Password Storage Cheat Sheet
  var HASH = "SHA-256";
  var BYTES_SAL = 16;
  var BYTES_IV = 12;             // AES-GCM: 96 bits es el tamaño recomendado

  /* Alfabeto Crockford base32: sin I, L, O, U.
     Quita justo las letras que se confunden al copiar a mano un
     código de recuperación, que es donde más caro sale un typo. */
  var ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  /* ---------- base64 sin reventar con buffers grandes ----------
     String.fromCharCode(...array) pasa cada byte como argumento y
     truena por límite de argumentos alrededor de los 100 KB. Un
     diario de dos años lo alcanza. Por eso va por trozos. */
  function b64(buf) {
    var bytes = new Uint8Array(buf), trozo = 0x8000, partes = [];
    for (var i = 0; i < bytes.length; i += trozo) {
      partes.push(String.fromCharCode.apply(null, bytes.subarray(i, i + trozo)));
    }
    return btoa(partes.join(""));
  }

  function unb64(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function aleatorio(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  /* ---------- KEK: del código de acceso a una llave ---------- */
  async function derivarKEK(codigo, sal, iteraciones, usos) {
    var base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(codigo), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: sal, iterations: iteraciones || ITERACIONES, hash: HASH },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      usos || ["wrapKey", "unwrapKey"]
    );
  }

  /* ---------- envolver / desenvolver la DEK ---------- */
  async function envolver(dek, kek) {
    var iv = aleatorio(BYTES_IV);
    var ct = await crypto.subtle.wrapKey("raw", dek, kek, { name: "AES-GCM", iv: iv });
    return { iv: b64(iv), ct: b64(ct) };
  }

  async function desenvolver(sobre, kek, extraible) {
    // Si el código es incorrecto, AES-GCM falla en la etiqueta de
    // autenticación y esto lanza. Ese throw ES la verificación.
    //
    // extraible solo se pide en el camino de cambio de código, donde
    // hay que volver a envolver la DEK: wrapKey exige extraerla. En
    // el uso normal la DEK sale no extraíble y nunca vuelve a claro.
    return crypto.subtle.unwrapKey(
      "raw",
      unb64(sobre.ct),
      kek,
      { name: "AES-GCM", iv: unb64(sobre.iv) },
      { name: "AES-GCM", length: 256 },
      extraible === true,
      ["encrypt", "decrypt"]
    );
  }

  /* ---------- código de recuperación ----------
     120 bits en 24 caracteres, mostrados en seis grupos de cuatro.
     Existe porque sin él, olvidar el código destruye los datos del
     usuario de forma permanente — y eso choca con su derecho de
     acceso del artículo 22 de la LFPDPPP. */
  function generarCodigoRecuperacion() {
    var bytes = aleatorio(15);           // 15 bytes = 120 bits = 24 caracteres exactos
    var s = "", acumulador = 0, bits = 0;
    for (var i = 0; i < bytes.length; i++) {
      acumulador = (acumulador << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        s += ALFABETO[(acumulador >> bits) & 31];
      }
    }
    return s.replace(/(.{4})(?=.)/g, "$1-");
  }

  function normalizarRecuperacion(codigo) {
    return String(codigo || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
      .replace(/I/g, "1").replace(/L/g, "1").replace(/O/g, "0").replace(/U/g, "V");
  }

  /* =========================================================
     API
     ========================================================= */

  /** ¿Este estado ya tiene bóveda v2? */
  function existe(cripto) {
    return !!(cripto && cripto.v === VERSION && cripto.dek && cripto.salCodigo);
  }

  /** ¿Este estado viene del esquema viejo y hay que migrarlo? */
  function esV1(estado) {
    return !!(estado && estado.diarySalt && estado.diaryCheck && !existe(estado.cripto));
  }

  /**
   * Crea la bóveda. Devuelve el bloque a guardar y el código de
   * recuperación, que hay que mostrar UNA vez y nunca guardar.
   */
  async function crear(codigo) {
    if (!codigo || String(codigo).length < 4) throw new Error("El código es demasiado corto.");

    var dek = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );

    var salCodigo = aleatorio(BYTES_SAL);
    var salRec = aleatorio(BYTES_SAL);
    var codigoRec = generarCodigoRecuperacion();

    var kekCodigo = await derivarKEK(String(codigo), salCodigo, ITERACIONES);
    var kekRec = await derivarKEK(normalizarRecuperacion(codigoRec), salRec, ITERACIONES);

    var cripto = {
      v: VERSION,
      kdf: "PBKDF2-" + HASH,
      iteraciones: ITERACIONES,
      cifrado: "AES-256-GCM",
      salCodigo: b64(salCodigo),
      salRecuperacion: b64(salRec),
      dek: await envolver(dek, kekCodigo),
      dekRecuperacion: await envolver(dek, kekRec),
      creado: new Date().toISOString()
    };

    return { cripto: cripto, codigoRecuperacion: codigoRec, llave: await desenvolver(cripto.dek, kekCodigo) };
  }

  /** Abre la bóveda con el código. Devuelve la DEK, o null si no es. */
  async function abrir(cripto, codigo) {
    if (!existe(cripto)) return null;
    try {
      var kek = await derivarKEK(String(codigo), unb64(cripto.salCodigo), cripto.iteraciones);
      return await desenvolver(cripto.dek, kek);
    } catch (e) { return null; }
  }

  /** Abre con el código de recuperación. */
  async function abrirConRecuperacion(cripto, codigoRec) {
    if (!existe(cripto) || !cripto.dekRecuperacion) return null;
    try {
      var kek = await derivarKEK(
        normalizarRecuperacion(codigoRec), unb64(cripto.salRecuperacion), cripto.iteraciones
      );
      return await desenvolver(cripto.dekRecuperacion, kek);
    } catch (e) { return null; }
  }

  /**
   * Cambia el código. NO re-cifra nada: solo vuelve a envolver la
   * DEK. Por eso es instantáneo aunque el diario tenga mil entradas.
   * El código de recuperación sigue siendo válido: es el respaldo
   * del usuario y cambiar el código no debería invalidarlo.
   */
  async function cambiarCodigo(cripto, codigoViejo, codigoNuevo) {
    if (!existe(cripto)) throw new Error("No hay bóveda que cambiar.");
    var kekVieja = await derivarKEK(String(codigoViejo), unb64(cripto.salCodigo), cripto.iteraciones);
    var dek;
    try {
      dek = await desenvolver(cripto.dek, kekVieja, true);
    } catch (e) {
      throw new Error("El código actual no es correcto.");
    }
    return reenvolver(cripto, dek, codigoNuevo);
  }

  /**
   * Restablece el código usando el código de recuperación, para quien
   * olvidó el suyo. Sin esto, olvidarlo destruiría los datos de forma
   * permanente y eso choca con el derecho de acceso del titular.
   */
  async function restablecerConRecuperacion(cripto, codigoRec, codigoNuevo) {
    if (!existe(cripto) || !cripto.dekRecuperacion) throw new Error("Esta cuenta no tiene código de recuperación.");
    var kekRec = await derivarKEK(
      normalizarRecuperacion(codigoRec), unb64(cripto.salRecuperacion), cripto.iteraciones
    );
    var dek;
    try {
      dek = await desenvolver(cripto.dekRecuperacion, kekRec, true);
    } catch (e) {
      throw new Error("El código de recuperación no es correcto.");
    }
    return reenvolver(cripto, dek, codigoNuevo);
  }

  /** Vuelve a envolver una DEK extraíble con un código nuevo. Interno. */
  async function reenvolver(cripto, dekExtraible, codigoNuevo) {
    if (!codigoNuevo || String(codigoNuevo).length < 4) throw new Error("El código es demasiado corto.");
    var salNueva = aleatorio(BYTES_SAL);
    var kekNueva = await derivarKEK(String(codigoNuevo), salNueva, ITERACIONES);
    var copia = Object.assign({}, cripto);
    copia.salCodigo = b64(salNueva);
    copia.dek = await envolver(dekExtraible, kekNueva);
    copia.actualizado = new Date().toISOString();
    return copia;
  }

  /* ---------- cifrar y descifrar contenido ---------- */
  async function cifrar(dek, texto) {
    var iv = aleatorio(BYTES_IV);
    var ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv }, dek, new TextEncoder().encode(String(texto))
    );
    return { iv: b64(iv), ct: b64(ct) };
  }

  async function descifrar(dek, sobre) {
    if (!sobre || !sobre.iv || !sobre.ct) return null;
    var claro = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(sobre.iv) }, dek, unb64(sobre.ct)
    );
    return new TextDecoder().decode(claro);
  }

  /** Cifra un objeto completo (por ejemplo, la memoria de aurorIA). */
  async function cifrarJSON(dek, valor) { return cifrar(dek, JSON.stringify(valor)); }

  async function descifrarJSON(dek, sobre) {
    var s = await descifrar(dek, sobre);
    if (s === null) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  /* =========================================================
     Migración v1 -> v2

     Regla de oro: no se borra nada del esquema viejo hasta que TODO
     lo viejo quedó descifrado y re-cifrado y verificado. Si algo
     falla a medio camino, se devuelve error y el estado original
     sigue intacto.
     ========================================================= */
  async function derivarV1(pin, salB64) {
    var base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: unb64(salB64), iterations: 100000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }

  /**
   * Convierte un estado v1 al esquema v2 usando el PIN viejo.
   * Devuelve { cripto, entradas, codigoRecuperacion, llave } o lanza.
   * NO modifica el estado que recibe.
   */
  async function migrarV1(estado, pin) {
    if (!esV1(estado)) throw new Error("Este estado no es del esquema anterior.");

    // 1. Verificar el PIN con el verificador viejo.
    var llaveVieja = await derivarV1(String(pin), estado.diarySalt);
    var chk = estado.diaryCheck;
    var ok = false;
    try {
      ok = (await descifrar(llaveVieja, chk)) === "aura_ok";
    } catch (e) { ok = false; }
    if (!ok) throw new Error("El PIN no es correcto.");

    // 2. Descifrar TODO antes de tocar nada.
    var viejas = Array.isArray(estado.diaryEntries) ? estado.diaryEntries : [];
    var claras = [];
    for (var i = 0; i < viejas.length; i++) {
      var e = viejas[i];
      if (!e || !e.iv || !e.ct) { claras.push({ entrada: e, texto: null }); continue; }
      var t = null;
      try { t = await descifrar(llaveVieja, e); } catch (err) { t = null; }
      if (t === null) {
        // Una entrada ilegible detiene la migración. Mejor dejar el
        // esquema viejo en pie que perder texto del usuario.
        throw new Error("Una entrada del diario no se pudo descifrar (posición " + i + "). No se migró nada.");
      }
      claras.push({ entrada: e, texto: t });
    }

    // 3. Crear la bóveda nueva.
    var nueva = await crear(String(pin));

    // 4. Re-cifrar con la DEK y verificar cada una en el acto.
    var entradas = [];
    for (var j = 0; j < claras.length; j++) {
      var orig = claras[j].entrada, texto = claras[j].texto;
      if (texto === null) { entradas.push(orig); continue; }
      var sobre = await cifrar(nueva.llave, texto);
      var comprobado = await descifrar(nueva.llave, sobre);
      if (comprobado !== texto) throw new Error("Falló la verificación al re-cifrar. No se migró nada.");
      var copia = Object.assign({}, orig);
      copia.iv = sobre.iv; copia.ct = sobre.ct;
      entradas.push(copia);
    }

    return {
      cripto: nueva.cripto,
      entradas: entradas,
      codigoRecuperacion: nueva.codigoRecuperacion,
      llave: nueva.llave
    };
  }

  /* ---------- fuerza del código, para la interfaz ---------- */
  function fuerza(codigo) {
    var s = String(codigo || "");
    if (!s) return { nivel: 0, etiqueta: "" };
    var soloDigitos = /^\d+$/.test(s);
    if (soloDigitos) {
      if (s.length < 6) return { nivel: 1, etiqueta: "Débil — usa al menos 6 dígitos" };
      if (s.length < 8) return { nivel: 2, etiqueta: "Aceptable" };
      return { nivel: 3, etiqueta: "Buena" };
    }
    if (s.length < 8) return { nivel: 2, etiqueta: "Aceptable — alárgala" };
    if (s.length < 12) return { nivel: 3, etiqueta: "Buena" };
    return { nivel: 4, etiqueta: "Muy buena" };
  }

  window.AuraCripto = {
    VERSION: VERSION,
    ITERACIONES: ITERACIONES,
    existe: existe,
    esV1: esV1,
    crear: crear,
    abrir: abrir,
    abrirConRecuperacion: abrirConRecuperacion,
    cambiarCodigo: cambiarCodigo,
    restablecerConRecuperacion: restablecerConRecuperacion,
    cifrar: cifrar,
    descifrar: descifrar,
    cifrarJSON: cifrarJSON,
    descifrarJSON: descifrarJSON,
    migrarV1: migrarV1,
    fuerza: fuerza,
    _b64: b64,
    _unb64: unb64
  };
})();
