#!/usr/bin/env python3
"""Renders the Pro logo (logo.svg) and writes the PNG, the icons and the share image from it.

    python3 tools/make_icons.py

The logo is rendered from logo.svg itself, not redrawn: edit logo.svg, run this, and every picture follows. Needs Pillow
(pip3 install pillow) and an SVG renderer: macOS Quick Look (built in, used first), else rsvg-convert, else cairosvg. The
renderer has to support masks and filters; ImageMagick's built-in one does not and draws nothing for this logo.

logo.svg has a background rectangle (the first <rect> before <defs>). Its colour is the background of every picture, so the icons are
square pictures of the logo on that colour, framed by changing the viewBox. Writes:
  logo.png                      1024x1024: logo.svg exactly as it is
  icons/icon-192.png, icons/icon-512.png      the app icon
  icons/icon-maskable-512.png   the logo inside the safe zone: Android crops it to a circle or squircle
  icons/apple-touch-icon.png    180x180
  icons/favicon.png             48x48, and favicon.ico (16, 32, 48) for browsers that ask for /favicon.ico
  og-image.png                  1200x630, the picture shown when the address is shared (the logo and the tagline on the logo's colour)
The names stay the same: index.html and manifest.webmanifest point at them, with ?v=<hash of the file> added by tools/stamp_icons.py
(cache busting: browsers keep old favicons).
"""
from __future__ import annotations

import io
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont
from stamp_icons import stamp  # tools/stamp_icons.py: ?v=<hash> on the icon addresses (cache busting)

ROOT = Path(__file__).resolve().parent.parent
SIZE = 1024  # every picture is made from a render this big, then scaled down
TAGLINE = ["Chat with AI professionals for", "software houses and social media"]  # the same words as the description in index.html and manifest.webmanifest, in two lines
TAGLINE_COLOUR = "#e6f6ff"
GLOWS = [((0, 0), 400, "#0b4f8a"), ((1200, 630), 420, "#0a6b8f")]  # soft colour in two corners of the share image: centre, radius, colour. Kept off the logo square, whose edge must stay invisible
FONTS = [("/System/Library/Fonts/HelveticaNeue.ttc", 12), ("/System/Library/Fonts/Helvetica.ttc", 0)]  # Helvetica Neue Thin (face 12), else Helvetica
TRACKING = 8  # extra pixels between the letters of the tagline

# the first <rect> before <defs> is the background; its fill is the colour of everything
BACKGROUND = re.compile(r"<rect\b[^>]*?/>")
VIEWBOX = re.compile(r'viewBox="([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)"')


def read_logo() -> tuple[str, str, tuple[float, float]]:
    """The SVG text, the background colour (#rrggbb) and the size of the drawing's viewBox."""
    svg = (ROOT / "logo.svg").read_text(encoding="utf-8")
    box = VIEWBOX.search(svg)
    if not box:
        sys.exit('logo.svg needs a viewBox="0 0 W H"')
    head = svg.split("<defs>", 1)[0]
    rect = BACKGROUND.search(head)
    fill = re.search(r'fill="(#[0-9a-fA-F]{6})"', rect.group(0)) if rect else None
    if not fill:
        sys.exit("logo.svg needs a background <rect ... fill=\"#rrggbb\"/> before <defs>: its colour is the background of the icons")
    return svg, fill.group(1), (float(box.group(3)), float(box.group(4)))


def frame(svg: str, centre: tuple[float, float], side: float, full: tuple[float, float]) -> str:
    """The same drawing seen through a square window of `side` units around `centre`. Rectangles that said 100% (the background and the mask's)
    get explicit numbers, because 100% would follow the new window and cut the drawing."""
    x, y = centre[0] - side / 2, centre[1] - side / 2
    head, tail = svg.split("<defs>", 1)
    bg = BACKGROUND.search(head).group(0)
    new_bg = re.sub(r'\s(?:x|y|width|height)="[^"]*"', "", bg).replace("<rect", f'<rect x="{x}" y="{y}" width="{side}" height="{side}"', 1)
    head = head.replace(bg, new_bg, 1)
    tail = tail.replace('width="100%"', f'width="{full[0]}"').replace('height="100%"', f'height="{full[1]}"')
    svg = head + "<defs>" + tail
    return VIEWBOX.sub(f'viewBox="{x} {y} {side} {side}"', svg, count=1)


def render(svg: str, size: int = SIZE) -> Image.Image:
    """Rasterise SVG text to an RGBA image of size x size."""
    if sys.platform == "darwin" and shutil.which("qlmanage"):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "logo.svg"
            src.write_text(svg, encoding="utf-8")
            subprocess.run(["qlmanage", "-t", "-s", str(size), "-o", tmp, str(src)], check=True, capture_output=True)
            return Image.open(Path(tmp) / "logo.svg.png").convert("RGBA").resize((size, size), Image.LANCZOS)
    if shutil.which("rsvg-convert"):
        png = subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-f", "png"], input=svg.encode(), check=True, capture_output=True).stdout
        return Image.open(io.BytesIO(png)).convert("RGBA")
    try:
        import cairosvg
    except ImportError:
        sys.exit("No SVG renderer: this needs macOS Quick Look, rsvg-convert (brew install librsvg) or cairosvg (pip3 install cairosvg)")
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size))).convert("RGBA")


def mark_box(exact: Image.Image, colour: str) -> tuple[float, float, float, float]:
    """Where the drawing (not the background) is, as fractions 0..1 of the picture: left, top, right, bottom."""
    flat = Image.new("RGB", exact.size, colour)
    diff = ImageChops.difference(exact.convert("RGB"), flat).convert("L").point(lambda v: 255 if v > 24 else 0)
    box = diff.getbbox()
    if not box:
        sys.exit("The render of logo.svg is empty: the renderer could not draw it")
    w, h = exact.size
    return box[0] / w, box[1] / h, box[2] / w, box[3] / h


def tagline_font(size: int):
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


def og_image(exact: Image.Image, colour: str) -> Image.Image:
    """1200x630, all centred: the logo, then the tagline, on the logo's own colour with soft glows in the corners. The logo picture is a
    square of that same colour, so it sits on the canvas without an edge."""
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), colour)
    for (cx, cy), radius, glow in GLOWS:
        ramp = Image.radial_gradient("L").resize((radius * 2, radius * 2), Image.BILINEAR)  # 0 at the centre, 255 only in the corners: the edge midpoints are at about 180
        fade = ramp.point(lambda v: int(max(0, 180 - v) * (255 / 180) * 0.55))  # strongest at the centre, exactly zero from the inscribed circle outwards
        img.paste(Image.new("RGB", (radius * 2, radius * 2), glow), (cx - radius, cy - radius), fade)
    side = 340
    logo = exact.resize((side, side), Image.LANCZOS)
    img.paste(logo, ((w - side) // 2, 14), logo)
    d = ImageDraw.Draw(img)
    font = tagline_font(52)
    for i, line in enumerate(TAGLINE):
        tracked(d, line, w // 2, 452 + i * 62, font, TAGLINE_COLOUR, TRACKING)
    return img


def main() -> None:
    svg, colour, full = read_logo()
    exact = render(svg)
    exact.save(ROOT / "logo.png", optimize=True)

    left, top, right, bottom = mark_box(exact, colour)
    cx, cy = (left + right) / 2 * full[0], (top + bottom) / 2 * full[1]  # the drawing's centre, in viewBox units
    height = (bottom - top) * full[1]

    def icon(padding: float) -> Image.Image:
        """The logo on its colour, the drawing's height filling 1 - 2 * padding of the picture, centred."""
        return render(frame(svg, (cx, cy), height / (1 - 2 * padding), full)).convert("RGB")

    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    plain = icon(0.14)
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192)):
        plain.resize((size, size), Image.LANCZOS).save(out / name, optimize=True)
    # the maskable safe zone is a circle of 80% of the icon: the drawing's corner is within it with a margin of 0.22 or more
    icon(0.24).resize((512, 512), Image.LANCZOS).save(out / "icon-maskable-512.png", optimize=True)
    plain.resize((180, 180), Image.LANCZOS).save(out / "apple-touch-icon.png", optimize=True)
    small = icon(0.06)
    small.resize((48, 48), Image.LANCZOS).save(out / "favicon.png", optimize=True)
    small.resize((256, 256), Image.LANCZOS).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    og_image(exact, colour).save(ROOT / "og-image.png", optimize=True)
    stamp(ROOT)
    print(f"logo.png, icons/ (icon-192, icon-512, icon-maskable-512, apple-touch-icon, favicon.png), favicon.ico and og-image.png written from logo.svg (background {colour}); ?v= updated in index.html and manifest.webmanifest")


if __name__ == "__main__":
    main()
