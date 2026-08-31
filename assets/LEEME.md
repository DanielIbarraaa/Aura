# assets/ — arte fuente

Aquí viven los originales en alta resolución. **No se publica esta carpeta**:
de aquí se generan los archivos que sí van en `www/` y en `web/`.

    marca/iconstar.png    Ícono principal. La estrella de ocho puntas, blanca,
                          sobre transparencia, 2000×2000. De aquí sale TODO el
                          juego de iconos.
    marca/iconoapp.png    Ícono de la aplicación tal como se veía antes: la
                          estrella ya montada sobre el squircle lila. Se conserva
                          como referencia de color.
    mascota/aurorIA-hoja.png   Hoja de personaje de aurorIA, la mascota:
                          cuatro vistas (frente 3/4, perfil, espalda, espalda 3/4).
    mascota/*.png         Recortes con fondo transparente que sí se usan en la web.

## Regenerar los iconos

    python3 tools/make-icons.py

Escribe en `www/` y `www/icons/`, y copia lo que necesita el sitio a
`web/assets/img/`.

## Regenerar los recortes de la mascota

    python3 tools/make-mascota.py
