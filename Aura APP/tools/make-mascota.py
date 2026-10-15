#!/usr/bin/env python3
"""Recorta las cuatro vistas de aurorIA desde la hoja de personaje y las deja
con fondo transparente en assets/mascota/, más los tamaños que usa la web.

    python3 tools/make-mascota.py

Solo necesita Pillow. Cada vista se aísla por relleno por difusión sobre la
máscara de opacidad, así que las dos figuras que se traslapan en la hoja
(espalda y espalda 3/4) salen separadas y limpias.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops as IC

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOJA = os.path.join(RAIZ, "assets", "mascota", "aurorIA-hoja.png")
SALIDA = os.path.join(RAIZ, "assets", "mascota")
WEB = os.path.join(RAIZ, "web", "assets", "img")
APP = os.path.join(RAIZ, "www", "assets")

# rectángulo donde buscar el cuerpo de cada vista
VISTAS = [
    ("frente",    (200, 220, 380, 420)),
    ("perfil",    (650, 220, 760, 420)),
    ("espalda",   (880, 240, 1000, 430)),
    ("espalda34", (1150, 330, 1300, 520)),
]
Y_TEXTO = 565          # debajo de aquí, cualquier pixel oscuro es una etiqueta
UMBRAL_BLANCO = 243


def cargar():
    im = Image.open(HOJA).convert("RGB")
    W, H = im.size
    r, g, b = im.split()
    mn = IC.darker(IC.darker(r, g), b)
    mx = IC.lighter(IC.lighter(r, g), b)

    blanco = mn.point(lambda v: 255 if v > UMBRAL_BLANCO else 0)

    # el fondo es el blanco conectado a los bordes: se rellena desde las esquinas
    fondo = blanco.copy()
    for xy in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1), (W // 2, 0), (W // 2, H - 1)]:
        if fondo.getpixel(xy) == 255:
            ImageDraw.floodfill(fondo, xy, 128, thresh=0)
    fondo = fondo.point(lambda v: 255 if v == 128 else 0)

    # etiquetas de texto: pixeles oscuros solo por debajo de las figuras
    texto = mx.point(lambda v: 255 if v < 150 else 0)
    px = texto.load()
    for y in range(0, min(Y_TEXTO, H)):
        for x in range(W):
            px[x, y] = 0
    texto = texto.filter(ImageFilter.MaxFilter(7))

    opaco = IC.subtract(IC.invert(fondo), texto)
    opaco = opaco.point(lambda v: 255 if v > 127 else 0)
    return im, opaco, mn


def semilla(opaco, rect):
    """Punto opaco cerca del centro del rectángulo dado."""
    x0, y0, x1, y1 = rect
    px = opaco.load()
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    for radio in range(0, max(x1 - x0, y1 - y0)):
        for dx in range(-radio, radio + 1):
            for dy in (-radio, radio):
                x, y = cx + dx, cy + dy
                if x0 <= x < x1 and y0 <= y < y1 and px[x, y] == 255:
                    return (x, y)
        for dy in range(-radio, radio + 1):
            for dx in (-radio, radio):
                x, y = cx + dx, cy + dy
                if x0 <= x < x1 and y0 <= y < y1 and px[x, y] == 255:
                    return (x, y)
    raise SystemExit("No encontré el cuerpo en %s" % (rect,))


def vista(im, opaco, mn, rect):
    # 2 px de dilatación: lo justo para pegar la corona de estrellas al cuerpo
    # sin fusionar las dos figuras que se traslapan.
    unido = opaco.filter(ImageFilter.MaxFilter(5))
    ImageDraw.floodfill(unido, semilla(opaco, rect), 128, thresh=0)
    solo = unido.point(lambda v: 255 if v == 128 else 0)
    figura = IC.multiply(opaco, solo)

    # alfa: opaco por dentro, degradado suave en el borde
    interior = figura.filter(ImageFilter.MinFilter(5))
    borde = IC.subtract(figura, interior)
    suave = mn.point(lambda v: min(255, (255 - v) * 4))
    alpha = IC.add(interior, IC.multiply(borde, suave))

    rgba = im.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba.crop(alpha.point(lambda v: 255 if v > 10 else 0).getbbox())


def main():
    for d in (SALIDA, WEB, APP):
        os.makedirs(d, exist_ok=True)
    im, opaco, mn = cargar()

    recortes = {}
    for nombre, rect in VISTAS:
        v = vista(im, opaco, mn, rect)
        v.save(os.path.join(SALIDA, "aurorIA-%s.png" % nombre))
        recortes[nombre] = v
        print("  aurorIA-%s.png  %dx%d" % (nombre, v.width, v.height))

    frente = recortes["frente"]
    frente.save(os.path.join(WEB, "aurorIA.png"))
    for nombre in ("perfil", "espalda", "espalda34"):
        recortes[nombre].save(os.path.join(WEB, "aurorIA-%s.png" % nombre))

    # avatar: cabeza y corona, para la burbuja del chat
    cab = frente.crop((0, 0, frente.width, int(frente.height * 0.42)))
    lado = max(cab.size)
    cuadro = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    cuadro.alpha_composite(cab, ((lado - cab.width) // 2, (lado - cab.height) // 2))
    avatar = cuadro.resize((256, 256), Image.LANCZOS)
    for d in (SALIDA, APP, WEB):
        avatar.save(os.path.join(d, "aurorIA-avatar.png"))
    print("  aurorIA-avatar.png  256x256")
    print("Listo: assets/mascota/, web/assets/img/ y www/assets/")


if __name__ == "__main__":
    main()
