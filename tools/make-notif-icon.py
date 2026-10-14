#!/usr/bin/env python3
"""
AURA — El icono de las notificaciones.

Android NO dibuja este icono a color: toma su canal alfa y pinta una
silueta del color del sistema. Un icono a color sale como un cuadro
blanco sólido, que es el error más común al agregar notificaciones.

Por eso es blanco puro sobre transparente. Y por eso se genera DESPUÉS
de capacitor-assets: esa herramienta escribe en las mismas carpetas
drawable-* y conviene que este archivo sea el último en llegar.
"""
from PIL import Image, ImageDraw
import os, sys

TAM = {"mdpi": 24, "hdpi": 36, "xhdpi": 48, "xxhdpi": 72, "xxxhdpi": 96}
RAIZ = os.path.join(os.path.dirname(__file__), "..", "android", "app", "src", "main", "res")


def destello(lado):
    E = 8                                  # se dibuja grande y se reduce
    im = Image.new("RGBA", (lado * E, lado * E), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = lado * E / 2
    r = lado * E * 0.40                    # margen: el sistema recorta lo que toque el borde
    g = r * 0.22                           # cintura de la estrella
    d.polygon([(c, c - r), (c + g, c - g), (c + r, c), (c + g, c + g),
               (c, c + r), (c - g, c + g), (c - r, c), (c - g, c - g)],
              fill=(255, 255, 255, 255))
    d.ellipse([c - r * .13, c - r * .13, c + r * .13, c + r * .13], fill=(255, 255, 255, 255))
    return im.resize((lado, lado), Image.LANCZOS)


def main():
    for carpeta, lado in TAM.items():
        ruta = os.path.join(RAIZ, "drawable-" + carpeta)
        os.makedirs(ruta, exist_ok=True)
        destello(lado).save(os.path.join(ruta, "ic_stat_aura.png"))
    print("ic_stat_aura en 5 densidades")


if __name__ == "__main__":
    try:
        main()
    except ImportError:
        print("Falta Pillow: pip3 install pillow", file=sys.stderr)
        sys.exit(1)
