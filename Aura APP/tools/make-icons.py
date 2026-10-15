#!/usr/bin/env python3
"""Genera TODO el juego de iconos de Aura a partir de assets/marca/iconstar.png,
que es el ícono principal: la estrella de ocho puntas, blanca, sobre transparencia.

    python3 tools/make-icons.py

Escribe en www/ y www/icons/, y copia a web/assets/img/ lo que usa el sitio.
El color del squircle está muestreado de assets/marca/iconoapp.png, que se
conserva solo como referencia.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESTRELLA = os.path.join(RAIZ, "assets", "marca", "iconstar.png")
APP = os.path.join(RAIZ, "www")
WEB = os.path.join(RAIZ, "web", "assets", "img")

LILA_BORDE  = (191, 169, 208)   # orilla del degradado
LILA_CENTRO = (222, 207, 232)   # centro, más claro
RADIO_ESQUINA = 0.23            # del lado, para el squircle

_estrella = Image.open(ESTRELLA).convert("RGBA")
_estrella = _estrella.crop(_estrella.split()[3].getbbox())


def lila(size):
    """Degradado radial lila, del mismo tono que el ícono original."""
    im = Image.new("RGB", (size, size), LILA_BORDE)
    d = ImageDraw.Draw(im)
    dr = [c - b for b, c in zip(LILA_BORDE, LILA_CENTRO)]
    for i in range(90, 0, -1):
        t = i / 90
        r = size * 0.78 * t
        col = tuple(int(b + d_ * (1 - t)) for b, d_ in zip(LILA_BORDE, dr))
        d.ellipse([size/2 - r, size/2 - r*1.05, size/2 + r, size/2 + r*1.05], fill=col)
    return im.filter(ImageFilter.GaussianBlur(size / 40)).convert("RGBA")


def squircle(size):
    """El fondo lila recortado en cuadrado de esquinas redondeadas."""
    base = lila(size)
    mascara = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mascara).rounded_rectangle(
        [0, 0, size * 4 - 1, size * 4 - 1], radius=int(size * 4 * RADIO_ESQUINA), fill=255)
    base.putalpha(mascara.resize((size, size), Image.LANCZOS))
    return base


def con_estrella(fondo, ratio, resplandor=True):
    """Monta la estrella centrada, con un halo suave detrás."""
    size = fondo.width
    ancho = int(size * ratio)
    s = _estrella.resize((ancho, int(ancho * _estrella.height / _estrella.width)), Image.LANCZOS)
    pos = ((size - s.width) // 2, (size - s.height) // 2)
    if resplandor:
        halo = Image.new("RGBA", fondo.size, (0, 0, 0, 0))
        halo.alpha_composite(s, pos)
        halo = halo.filter(ImageFilter.GaussianBlur(size * 0.055))
        halo.putalpha(halo.split()[3].point(lambda v: int(v * 0.75)))
        fondo.alpha_composite(halo)
    fondo.alpha_composite(s, pos)
    return fondo


def guardar(im, *rutas):
    for r in rutas:
        os.makedirs(os.path.dirname(r), exist_ok=True)
        im.save(r)


def main():
    os.makedirs(os.path.join(APP, "icons"), exist_ok=True)
    os.makedirs(WEB, exist_ok=True)

    # 1. Ícono de app (purpose "any"): squircle + estrella
    for n in (512, 192, 32, 16):
        im = con_estrella(squircle(n), 0.52, resplandor=n >= 96)
        if n in (512, 192):
            guardar(im, f"{APP}/icon-{n}.png")
        else:
            guardar(im, f"{APP}/favicon-{n}.png")
    guardar(con_estrella(squircle(512), 0.52), f"{WEB}/icon-512.png")
    guardar(con_estrella(squircle(32), 0.52, resplandor=False), f"{WEB}/favicon-32.png")

    # 2. Maskable: a sangre, estrella dentro de la zona segura del 66%
    for n in (512, 192):
        guardar(con_estrella(lila(n), 0.50), f"{APP}/icons/maskable-{n}.png")
    guardar(con_estrella(lila(512), 0.50), f"{WEB}/maskable-512.png")

    # 3. Apple touch: iOS recorta las esquinas él mismo, así que va a sangre
    apple = con_estrella(lila(180), 0.54).convert("RGB")
    guardar(apple, f"{APP}/icons/apple-touch-icon.png", f"{WEB}/apple-touch-icon.png")

    # 4. Adaptativo de Android: la estrella sola es exactamente la capa frontal
    fg = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    con_estrella(fg, 0.44)
    guardar(fg, f"{APP}/icons/adaptive-foreground-432.png")
    guardar(lila(432).convert("RGB"), f"{APP}/icons/adaptive-background-432.png")

    # 5. La estrella sola, ligera, para usarla como máscara del logotipo
    #    (la web y la app la pintan con el color de la marca en cada tema)
    marca = _estrella.resize((192, int(192 * _estrella.height / _estrella.width)), Image.LANCZOS)
    lienzo = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
    lienzo.alpha_composite(marca, (0, (192 - marca.height) // 2))
    guardar(lienzo, f"{APP}/assets/iconstar.png", f"{WEB}/iconstar.png")

    # 6. Splash de Capacitor
    guardar(con_estrella(lila(2732), 0.26).convert("RGB"), f"{APP}/icons/splash-2732.png")

    # 7. Lo que consume @capacitor/assets para generar los recursos de Android.
    #    Los nombres son fijos: los busca en assets/ por convención.
    RES = os.path.join(RAIZ, "assets")
    guardar(con_estrella(squircle(1024), 0.52), f"{RES}/icon.png")
    fg1k = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    con_estrella(fg1k, 0.44)
    guardar(fg1k, f"{RES}/icon-foreground.png")
    guardar(lila(1024).convert("RGB"), f"{RES}/icon-background.png")
    guardar(con_estrella(lila(2732), 0.26).convert("RGB"), f"{RES}/splash.png")

    oscuro = Image.new("RGBA", (2732, 2732), (29, 24, 46, 255))   # --bg-0 del tema oscuro
    guardar(con_estrella(oscuro, 0.26).convert("RGB"), f"{RES}/splash-dark.png")

    print("Iconos generados desde assets/marca/iconstar.png")
    print("  www/: icon-192, icon-512, favicon-16, favicon-32")
    print("  www/icons/: maskable-192/512, apple-touch-icon, adaptive-*, splash-2732")
    print("  www/assets/ y web/assets/img/: iconstar.png (la estrella sola, para el logotipo)")
    print("  web/assets/img/: icon-512, maskable-512, favicon-32, apple-touch-icon")
    print("  assets/: icon, icon-foreground, icon-background, splash, splash-dark (para @capacitor/assets)")


if __name__ == "__main__":
    main()
