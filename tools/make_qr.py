"""Make the two QR code PNGs.

Usage (once, install the small QR library):   python -m pip install segno
Then:   python tools/make_qr.py https://USERNAME.github.io/REPO/

Writes qr-game.png (game link, to project for the class) and
qr-results.png (results page WITHOUT the key - add ?key=... yourself on your laptop).
"""
import sys
from pathlib import Path

import segno

if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
    sys.exit("Usage: python tools/make_qr.py https://USERNAME.github.io/REPO/")

base = sys.argv[1].rstrip("/") + "/"
root = Path(__file__).resolve().parent.parent
for name, url in (("qr-game.png", base), ("qr-results.png", base + "results.html")):
    segno.make(url, error="m").save(root / name, scale=16, border=4)
    print(f"{name}: {url}")
