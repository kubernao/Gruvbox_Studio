#!/usr/bin/env bash
# Copies app icons and marketing images into landing/assets/ for standalone deploy
# (e.g. gruvbox.studio root). After running, switch index.html to assets/* paths or
# use a deploy step that rewrites ../resources/ -> assets/ for production.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/landing/assets"
mkdir -p "$DEST"
cp "$ROOT/resources/app-icon.png" "$DEST/"
cp "$ROOT/resources/app-icon-macos.png" "$DEST/"
cp "$ROOT/assets/editor-gruvie-overview.png" "$DEST/"
if [[ "$(uname -s)" == "Darwin" ]]; then
  sips -z 32 32 "$DEST/app-icon.png" --out "$DEST/favicon-32.png" >/dev/null 2>&1
  sips -z 180 180 "$DEST/app-icon.png" --out "$DEST/apple-touch-icon.png" >/dev/null 2>&1
fi
echo "[sync-landing-assets] Wrote $DEST (app-icon.png, app-icon-macos.png, favicon-32.png, apple-touch-icon.png, editor-gruvie-overview.png)"

python3 "$(dirname "$0")/inline-landing-icons.py" 2>/dev/null || true
cp "$DEST/favicon-32.png" "$ROOT/landing/favicon.ico" 2>/dev/null || true
