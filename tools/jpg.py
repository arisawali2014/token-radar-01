#!/usr/bin/env python3
"""Tune .shots/*.png into screenshots/*.jpg inside the 300-350 KB band.

The gate caps each screenshot at 512 KiB with a long side at most 1440 px and a
short side at least 800 px; the dossier wants three near the cap without passing
it, so each image is saved as JPEG at the highest quality that still lands in
the band (quality 70-95, stepping down by 5)."""
import os
import sys
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, ".shots")
DST = os.path.join(REPO, "screenshots")
LO, HI = 300 * 1024, 350 * 1024
CAP = 512 * 1024

os.makedirs(DST, exist_ok=True)
names = sorted(n for n in os.listdir(SRC) if n.lower().endswith(".png"))
if len(names) < 3:
    sys.exit(f"jpg: .shots/ holds {len(names)} PNGs, need 3")

for name in names:
    img = Image.open(os.path.join(SRC, name)).convert("RGB")
    w, h = img.size
    assert max(w, h) <= 1440 and min(w, h) >= 800, f"{name} is {w}x{h}"
    stem = os.path.splitext(name)[0]
    dest = os.path.join(DST, stem + ".jpg")
    picked = None
    for q in (95, 90, 85, 80, 75, 70, 65, 60):
        img.save(dest, "JPEG", quality=q, optimize=True)
        size = os.path.getsize(dest)
        if LO <= size <= HI or (size < LO and q == 60):
            picked = (q, size)
            break
        if size < LO:
            # A lower quality only shrinks it further; keep this one if it is
            # the closest above the floor, else fall through to the smallest.
            picked = (q, size)
            break
        # size > HI: try a lower quality.
    q, size = picked
    assert size <= CAP, f"{dest} is {size} bytes, past the 512 KiB cap"
    print(f"jpg: {os.path.basename(dest)} {w}x{h} quality={q} {size} bytes ({size/1024:.0f} KB)")
print("jpg: done")
