#!/usr/bin/env python3
"""Embed landing favicon/header logo as data URIs in landing/index.html."""
from __future__ import annotations
import base64, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
LANDING, ICON, HTML = ROOT / "landing", ROOT / "landing/assets/favicon-32.png", ROOT / "landing/index.html"

def main() -> int:
    if not ICON.is_file():
        print(f"[inline-landing-icons] Missing {ICON}", file=sys.stderr)
        return 1
    uri = "data:image/png;base64," + base64.b64encode(ICON.read_bytes()).decode("ascii")
    html = HTML.read_text(encoding="utf-8")
    html = re.sub(r'<link rel="icon"[^>]+sizes="32x32"[^>]*/>', f'<link rel="icon" type="image/png" href="{uri}" sizes="32x32" />', html, count=1)
    html = re.sub(r'<link rel="icon" type="image/png" href="[^"]*" />', f'<link rel="icon" type="image/png" href="{uri}" />', html, count=1)
    html = re.sub(r'<link rel="apple-touch-icon" href="[^"]*" />', f'<link rel="apple-touch-icon" href="{uri}" />', html, count=1)
    html = re.sub(
        r'<img src="[^"]*" width="32" height="32" alt="Gruvbox Studio app icon"[^>]*/>',
        f'<img src="{uri}" width="32" height="32" alt="Gruvbox Studio app icon" decoding="async" />',
        html, count=1,
    )
    if "<base " not in html:
        html = html.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n  <base href="./" />', 1)
    HTML.write_text(html, encoding="utf-8")
    print(f"[inline-landing-icons] Updated {HTML}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
