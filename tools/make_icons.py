#!/usr/bin/env python3
"""Draws the Pro logo (logo.svg: the circuit line that forms an F, with its two amber dots) and writes the PNG and the icons.

    python3 tools/make_icons.py

Needs Pillow (pip3 install pillow). Everything has a transparent background and is written to:
  logo.png                      1024x1024: logo.svg as a PNG, the whole 200x200 drawing
  icons/icon-192.png, icons/icon-512.png      the app icon (the splash screen colour comes from the manifest)
  icons/icon-maskable-512.png   the logo inside the safe zone: Android crops it to a circle or squircle
  icons/apple-touch-icon.png    180x180 (iOS puts black behind transparent icons; amber reads well on it)
  icons/favicon.png             48x48, and favicon.ico (16, 32, 48) for browsers that ask for /favicon.ico
  og-image.png                  1200x630, the picture shown when the address is shared (the logo and the tagline on the dark page colour)
The names stay the same: index.html and manifest.webmanifest point at them, with ?v=<hash of the file> added by tools/stamp_icons.py (cache busting: browsers keep old favicons). The shapes and colours are in logo.svg: change both together.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from stamp_icons import stamp  # tools/stamp_icons.py: ?v=<hash> on the icon addresses (cache busting)

ROOT = Path(__file__).resolve().parent.parent
LINE = [(55, 170), (55, 40), (155, 40), (155, 80), (100, 80), (100, 105), (145, 105), (145, 140), (100, 140)]  # viewBox 200
LINE_WIDTH, LINE_COLOUR = 16, "#f59e0b"  # round caps and joins
DOTS = [((55, 170), 12, "#fbbf24"), ((100, 140), 10, "#d97706")]  # centre, radius, colour: drawn over the line
BOX = (43, 32, 163, 182)  # the drawing's bounding box, strokes and dots included
CENTRE = ((BOX[0] + BOX[2]) / 2, (BOX[1] + BOX[3]) / 2)
SS = 4  # supersampling, for smooth edges
TAGLINE = ["Chat with AI professionals for", "software houses and social media"]  # the same words as the description in index.html and manifest.webmanifest, in two lines
PAGE = "#1c1917"  # the dark page colour behind the share image
FONTS = [("/System/Library/Fonts/HelveticaNeue.ttc", 12), ("/System/Library/Fonts/Helvetica.ttc", 0)]  # Helvetica Neue Thin (face 12), else Helvetica
TRACKING = 8  # extra pixels between the letters of the tagline


def draw(size: int, padding: float | None = None) -> Image.Image:
    """The logo on a transparent size x size canvas. padding=None draws logo.svg's whole 200x200 as it is; a number centres the
    drawing and leaves that share of the size empty on each side."""
    px = size * SS
    if padding is None:
        unit, ox, oy = px / 200, 0.0, 0.0
    else:
        unit = px / ((BOX[3] - BOX[1]) / (1 - 2 * padding))  # the drawing is taller than wide: its height sets the scale
        ox, oy = px / 2 - CENTRE[0] * unit, px / 2 - CENTRE[1] * unit

    def at(p):
        return ox + p[0] * unit, oy + p[1] * unit

    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = LINE_WIDTH * unit / 2
    for a, b in zip(LINE, LINE[1:]):
        d.line([at(a), at(b)], fill=LINE_COLOUR, width=round(2 * r))
    for p in LINE:  # a disc at every corner and end makes the joins and caps round
        x, y = at(p)
        d.ellipse([x - r, y - r, x + r, y + r], fill=LINE_COLOUR)
    for centre, radius, colour in DOTS:
        x, y = at(centre)
        d.ellipse([x - radius * unit, y - radius * unit, x + radius * unit, y + radius * unit], fill=colour)
    return img.resize((size, size), Image.LANCZOS)


def tagline_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path, index in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size, index=index)
    return ImageFont.load_default(size)  # not macOS: a plain font, the picture still works


def tracked(d: ImageDraw.ImageDraw, text: str, cx: float, baseline: float, font, fill: str, spacing: float) -> None:
    """Draws `text` centred on cx with `spacing` extra pixels between the letters."""
    widths = [font.getlength(c) for c in text]
    x = cx - (sum(widths) + spacing * (len(text) - 1)) / 2
    for c, cw in zip(text, widths):
        d.text((x, baseline), c, font=font, fill=fill, anchor="ls")
        x += cw + spacing


def og_image() -> Image.Image:
    """1200x630, all centred: the logo, then the tagline, on the dark page colour with soft amber glows behind."""
    w, h = 1200, 630
    glows = Image.new("RGB", (w, h), PAGE)
    d = ImageDraw.Draw(glows)
    d.ellipse([-220, -280, 540, 380], fill="#7c2d12")
    d.ellipse([720, 140, 1400, 780], fill="#78350f")
    d.ellipse([260, 440, 900, 920], fill="#451a03")
    img = Image.blend(Image.new("RGB", (w, h), PAGE), glows.filter(ImageFilter.GaussianBlur(120)), 0.7)
    logo = draw(250, padding=0)  # the drawing fills the height: 200 wide, 250 tall
    img.paste(logo, ((w - logo.width) // 2, 62), logo)
    d = ImageDraw.Draw(img)
    font = tagline_font(52)
    for i, line in enumerate(TAGLINE):
        tracked(d, line, w // 2, 432 + i * 62, font, "#fef3c7", TRACKING)
    return img


def main() -> None:
    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    draw(1024).save(ROOT / "logo.png", optimize=True)
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192)):
        draw(size, padding=0.08).save(out / name, optimize=True)
    # inside the maskable safe zone (a circle of 80% of the icon): the drawing's farthest point is 93 units from its centre, so it needs a 0.18 margin or more
    draw(512, padding=0.2).save(out / "icon-maskable-512.png", optimize=True)
    draw(180, padding=0.1).save(out / "apple-touch-icon.png", optimize=True)
    draw(48, padding=0.04).save(out / "favicon.png", optimize=True)
    draw(256, padding=0.04).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    og_image().save(ROOT / "og-image.png", optimize=True)
    stamp(ROOT)
    print("logo.png, icons/ (icon-192, icon-512, icon-maskable-512, apple-touch-icon, favicon.png) and favicon.ico, og-image.png written; ?v= updated in index.html and manifest.webmanifest")


if __name__ == "__main__":
    main()
