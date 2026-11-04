#!/usr/bin/env python3
"""Make pictures small and square so they fit a chat avatar: crop to the shape, scale down, re-save as a light JPEG.

Usage:  python3 tools/make_image.py personas/*.jpg                  256x256 JPEG in place; the originals are kept in personas/originals/
        python3 tools/make_image.py personas/maria.jpg --size 128   a smaller one
        python3 tools/make_image.py photo.png --out build           writes build/photo.jpg, nothing else is touched

Options:
  --size 256        width of the result in pixels; the picture is cropped to a square. "WxH" (e.g. 200x260) crops to that shape instead
  --quality 82      JPEG quality 1-95 (lower = smaller file)
  --focus 0.4       where the crop sits when the picture is cut: 0 = top, 0.5 = middle, 1 = bottom. Portraits keep the face better
                    a little above the middle, so the default is 0.4 (only matters when the picture is not already the right shape)
  --format jpg      jpg (default) or webp
  --out DIR         write the results into DIR; the sources are left alone and nothing is backed up
  --no-backup       in place without keeping the originals (they cannot be recovered)

In place (no --out): each original is first moved to an "originals" folder next to it, and the small version takes its name. Running it
again, for example with another --size, always starts from that saved original, never from an already shrunk copy.

Also done: phone photos' rotation (EXIF) is applied, metadata is dropped, transparent pictures are put on white.

Needs:  pip install pillow
"""
import argparse
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps

FORMATS = {"jpg": ("JPEG", ".jpg"), "webp": ("WEBP", ".webp")}


def parse_size(text):
    """'256' -> (256, 256), '200x260' -> (200, 260)."""
    try:
        w, _, h = text.lower().partition("x")
        size = (int(w), int(h or w))
    except ValueError:
        raise argparse.ArgumentTypeError(f'"{text}" is not a size: use 256 or 200x260')
    if min(size) < 8 or max(size) > 8000:
        raise argparse.ArgumentTypeError("the size must be between 8 and 8000 pixels")
    return size


def load(path):
    """Open a picture upright (EXIF rotation applied) and flat (transparency put on white), as RGB."""
    img = ImageOps.exif_transpose(Image.open(path))
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
        flat = Image.new("RGB", img.size, "white")
        flat.paste(img, mask=img.getchannel("A"))
        return flat
    return img.convert("RGB")


def make(src, dest, size, quality, focus, fmt):
    """Crop `src` to `size` (cover, cut around `focus`), shrink it and save it to `dest`."""
    img = ImageOps.fit(load(src), size, Image.LANCZOS, centering=(0.5, focus))
    kind, _ = FORMATS[fmt]
    options = {"quality": quality, "optimize": True, "progressive": True} if kind == "JPEG" else {"quality": quality, "method": 6}
    img.save(dest, kind, **options)


def main():
    ap = argparse.ArgumentParser(description="Crop, shrink and re-save pictures so they fit a chat avatar.")
    ap.add_argument("pictures", nargs="+", type=Path, help="pictures to process")
    ap.add_argument("--size", type=parse_size, default=(256, 256))
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--focus", type=float, default=0.4)
    ap.add_argument("--format", choices=FORMATS, default="jpg")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--no-backup", action="store_true")
    args = ap.parse_args()
    if not 1 <= args.quality <= 95:
        ap.error("--quality must be between 1 and 95")
    if not 0 <= args.focus <= 1:
        ap.error("--focus must be between 0 and 1")

    suffix = FORMATS[args.format][1]
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
    failed = 0
    for path in args.pictures:
        if not path.is_file():
            print(f"skip   {path}: not a file", file=sys.stderr)
            failed += 1
            continue
        if args.out:
            src, dest = path, args.out / (path.stem + suffix)
        else:
            dest = path.with_suffix(suffix)
            saved = path.parent / "originals" / path.name
            if saved.exists():
                src = saved  # an earlier run kept the original: always start from it
            elif args.no_backup:
                src = path
            else:
                saved.parent.mkdir(exist_ok=True)
                shutil.copy2(path, saved)  # a copy, so a failure below never leaves the picture missing
                src = saved
        before = src.stat().st_size
        try:
            make(src, dest, args.size, args.quality, args.focus, args.format)
        except Exception as e:  # a broken or unsupported file must not stop the rest of the batch
            print(f"skip   {path}: {e}", file=sys.stderr)
            failed += 1
            continue
        if not args.out and dest != path and path.exists():
            path.unlink()  # a PNG became a JPG: the PNG is in originals/ (or --no-backup asked for it to go)
        with Image.open(dest) as done:
            print(f"{dest}: {done.width}x{done.height}, {before / 1024:.0f} KB -> {dest.stat().st_size / 1024:.0f} KB")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
