#!/usr/bin/env python3
"""Make the width variants the home page's srcset attributes point at.

  python3 scripts/make-responsive.py

Writes assets/photos/<name>-<width>.webp next to each source photo. Re-run after
swapping a photo; it overwrites. Needs Pillow.
"""
from pathlib import Path
from PIL import Image

PHOTOS = Path(__file__).resolve().parent.parent / "assets" / "photos"
QUALITY = 72

# source photo -> widths to emit (re-encoded at QUALITY; originals stay as the src fallback)
VARIANTS = {
    "family-mixed-grill.webp": [640, 960, 1280],
    "interior-dining-room.webp": [400, 600, 750],
    "storefront-exterior.webp": [300, 500, 750],
    "family-dining-booth.webp": [400, 750],
    "ultimate-hummus-pita-overhead.webp": [400, 700],
    "lamb-beef-gyro-wrap.webp": [400, 700],
    "lily-s-mixed-grill-platter.webp": [400, 700],
    "batata-harrah.webp": [400, 700],
    "bone-in-lamb-chops-platter.webp": [400, 700],
    "baklava.webp": [400, 700],
}

for name, widths in VARIANTS.items():
    src = Image.open(PHOTOS / name).convert("RGB")
    for w in widths:
        h = round(src.height * w / src.width)
        out = PHOTOS / f"{Path(name).stem}-{w}.webp"
        src.resize((w, h), Image.LANCZOS).save(out, "WEBP", quality=QUALITY, method=6)
        print(f"{out.name}: {w}x{h}, {out.stat().st_size // 1024} KiB")
