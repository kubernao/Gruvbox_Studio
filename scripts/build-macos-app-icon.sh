#!/usr/bin/env bash
#
# Legacy fallback used when Icon Composer CLI export is unavailable: reads
# resources/app-icon.png, scales down the raster, pads it onto a 1024×1024
# Gruvbox background, writes the result back to resources/app-icon.png and
# Gruvbox_landing/assets/app-icon.png (when present), landing/assets/ copies, and
# rebuilds resources/app-icon.icns.
# Prefer `scripts/sync-brand-icons-from-composer.sh` whenever `icon.icon` and
# `ictool` are present so Liquid Glass composites stay accurate.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
SRC="$ROOT/resources/app-icon.png"
DEST_PNG="$ROOT/resources/app-icon.png"
LANDING_PNG="$REPO/Gruvbox_landing/assets/app-icon.png"
STUDIO_LANDING_ASSETS="$ROOT/landing/assets"
OUT_ICNS="$ROOT/resources/app-icon.icns"
INNER_MAX="${INNER_MAX:-560}"
PAD_COLOR="${PAD_COLOR:-1d2021}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[build-macos-app-icon] Skipping: not macOS (committed png/icns unchanged)."
  exit 0
fi

if [[ ! -f "$SRC" ]]; then
  echo "[build-macos-app-icon] Missing source: $SRC" >&2
  exit 1
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/gruvbox-icon.XXXXXX")"
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

MASTER="$WORKDIR/padded-1024.png"
cp "$SRC" "$WORKDIR/orig.png"

sips -Z "$INNER_MAX" "$WORKDIR/orig.png" --out "$WORKDIR/inner.png" >/dev/null 2>&1
sips --padToHeightWidth 1024 1024 --padColor "$PAD_COLOR" "$WORKDIR/inner.png" --out "$MASTER" >/dev/null 2>&1

cp "$MASTER" "$DEST_PNG"
cp "$MASTER" "$ROOT/resources/app-icon-macos.png"
if [[ -d "$REPO/Gruvbox_landing" ]]; then
  mkdir -p "$(dirname "$LANDING_PNG")"
  cp "$MASTER" "$LANDING_PNG"
fi
if [[ -d "$STUDIO_LANDING_ASSETS" || -d "$ROOT/landing" ]]; then
  mkdir -p "$STUDIO_LANDING_ASSETS"
  cp "$MASTER" "$STUDIO_LANDING_ASSETS/app-icon.png"
  cp "$MASTER" "$STUDIO_LANDING_ASSETS/app-icon-macos.png"
fi

ICONSET="$WORKDIR/AppIcon.iconset"
mkdir -p "$ICONSET"
sips -z 16 16 "$MASTER" --out "$ICONSET/icon_16x16.png" >/dev/null 2>&1
sips -z 32 32 "$MASTER" --out "$ICONSET/icon_16x16@2x.png" >/dev/null 2>&1
sips -z 32 32 "$MASTER" --out "$ICONSET/icon_32x32.png" >/dev/null 2>&1
sips -z 64 64 "$MASTER" --out "$ICONSET/icon_32x32@2x.png" >/dev/null 2>&1
sips -z 128 128 "$MASTER" --out "$ICONSET/icon_128x128.png" >/dev/null 2>&1
sips -z 256 256 "$MASTER" --out "$ICONSET/icon_128x128@2x.png" >/dev/null 2>&1
sips -z 256 256 "$MASTER" --out "$ICONSET/icon_256x256.png" >/dev/null 2>&1
sips -z 512 512 "$MASTER" --out "$ICONSET/icon_256x256@2x.png" >/dev/null 2>&1
sips -z 512 512 "$MASTER" --out "$ICONSET/icon_512x512.png" >/dev/null 2>&1
sips -z 1024 1024 "$MASTER" --out "$ICONSET/icon_512x512@2x.png" >/dev/null 2>&1

iconutil -c icns "$ICONSET" -o "$OUT_ICNS"
if [[ -d "$REPO/Gruvbox_landing" ]]; then
  echo "[build-macos-app-icon] Wrote $DEST_PNG, $LANDING_PNG, app-icon-macos.png, and $OUT_ICNS"
elif [[ -d "$ROOT/landing" ]]; then
  echo "[build-macos-app-icon] Wrote $DEST_PNG, $STUDIO_LANDING_ASSETS/app-icon.png, app-icon-macos.png, and $OUT_ICNS"
else
  echo "[build-macos-app-icon] Wrote $DEST_PNG, app-icon-macos.png, and $OUT_ICNS"
fi
