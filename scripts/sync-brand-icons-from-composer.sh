#!/usr/bin/env bash
#
# Renders branding from an Icon Composer bundle via Apple's `ictool`: a full
# export fills the Electron `app-icon.png` (and Gruvbox_landing when this repo
# lives inside the Gruvbox monorepo), while an inner raster is padded to 1024
# for macOS Dock/Finder/icns. Lives under Gruvbox_studio so GitHub Actions and
# single-repo checkouts find it (`npm run build:mac-icon`). On non-macOS hosts
# the script exits 0 and leaves committed binaries unchanged.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO="$(cd "$SCRIPT_DIR/.." && pwd)"
PARENT="$(cd "$STUDIO/.." && pwd)"

STUDIO_PNG="$STUDIO/resources/app-icon.png"
STUDIO_MACOS_PNG="$STUDIO/resources/app-icon-macos.png"
STUDIO_ICNS="$STUDIO/resources/app-icon.icns"

COMPOSER_BUNDLE=""
if [[ -d "$PARENT/icon.icon" ]]; then
  COMPOSER_BUNDLE="$PARENT/icon.icon"
elif [[ -d "$STUDIO/icon.icon" ]]; then
  COMPOSER_BUNDLE="$STUDIO/icon.icon"
fi

LANDING_PNG=""
if [[ -d "$PARENT/Gruvbox_landing" ]]; then
  LANDING_PNG="$PARENT/Gruvbox_landing/assets/app-icon.png"
fi

ICON_EXPORT_PLATFORM="${ICON_EXPORT_PLATFORM:-macOS}"
ICON_EXPORT_RENDITION="${ICON_EXPORT_RENDITION:-Dark}"
ICON_EXPORT_SCALE="${ICON_EXPORT_SCALE:-1}"
ICON_WEB_W="${ICON_WEB_WIDTH:-1024}"
ICON_WEB_H="${ICON_WEB_HEIGHT:-1024}"
ICON_MAC_INNER_W="${ICON_MACOS_INNER_WIDTH:-824}"
ICON_MAC_INNER_H="${ICON_MACOS_INNER_HEIGHT:-824}"
ICON_MAC_PAD="${ICON_MACOS_PAD_SIDE:-1024}"
ICON_LIGHT_ANGLE="${ICON_LIGHT_ANGLE:-}"

find_ictool() {
  if [[ -n "${ICTOOL:-}" && -x "$ICTOOL" ]]; then
    echo "$ICTOOL"
    return 0
  fi
  local xcode_app="${XCODE_APP:-/Applications/Xcode.app}"
  local candidates=(
    "$HOME/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
    "$xcode_app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
    "/Applications/Xcode-beta.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
  )
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  command -v ictool 2>/dev/null || true
}

build_icns_from_png_master() {
  local master_png="$1"
  local icns_out="$2"
  local WORKDIR ICONSET

  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/gruvbox-appicon.icns.XXXXXX")"
  ICONSET="$WORKDIR/AppIcon.iconset"
  mkdir -p "$ICONSET"
  trap 'rm -rf "$WORKDIR"' EXIT

  sips -z 16 16 "$master_png" --out "$ICONSET/icon_16x16.png" >/dev/null 2>&1
  sips -z 32 32 "$master_png" --out "$ICONSET/icon_16x16@2x.png" >/dev/null 2>&1
  sips -z 32 32 "$master_png" --out "$ICONSET/icon_32x32.png" >/dev/null 2>&1
  sips -z 64 64 "$master_png" --out "$ICONSET/icon_32x32@2x.png" >/dev/null 2>&1
  sips -z 128 128 "$master_png" --out "$ICONSET/icon_128x128.png" >/dev/null 2>&1
  sips -z 256 256 "$master_png" --out "$ICONSET/icon_128x128@2x.png" >/dev/null 2>&1
  sips -z 256 256 "$master_png" --out "$ICONSET/icon_256x256.png" >/dev/null 2>&1
  sips -z 512 512 "$master_png" --out "$ICONSET/icon_256x256@2x.png" >/dev/null 2>&1
  sips -z 512 512 "$master_png" --out "$ICONSET/icon_512x512.png" >/dev/null 2>&1
  sips -z 1024 1024 "$master_png" --out "$ICONSET/icon_512x512@2x.png" >/dev/null 2>&1

  iconutil -c icns "$ICONSET" -o "$icns_out"

  trap - EXIT
  rm -rf "$WORKDIR"
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[sync-brand-icons] Skip: non-macOS host (reuse committed PNG/icns)."
  exit 0
fi

ICTOOL_PATH="$(find_ictool)"

export_icon_with_ictool_to() {
  local out="$1"
  local w="$2"
  local h="$3"
  local sc="${ICON_EXPORT_SCALE:-1}"

  if "$ICTOOL_PATH" "$COMPOSER_BUNDLE" --export-image \
    --output-file "$out" \
    --platform "$ICON_EXPORT_PLATFORM" \
    --rendition "$ICON_EXPORT_RENDITION" \
    --width "$w" \
    --height "$h" \
    --scale "$sc" \
    ${ICON_LIGHT_ANGLE:+--light-angle "$ICON_LIGHT_ANGLE"}; then
    return 0
  fi
  echo "[sync-brand-icons] New \`ictool\` flags failed; trying legacy \`--export-preview\`…" >&2
  local angle="${ICON_LIGHT_ANGLE:--45}"
  "$ICTOOL_PATH" "$COMPOSER_BUNDLE" --export-preview \
    "$ICON_EXPORT_PLATFORM" "$ICON_EXPORT_RENDITION" "$w" "$h" "$sc" "$angle" "$out"
}

if [[ -d "$COMPOSER_BUNDLE" && -x "${ICTOOL_PATH:-}" ]]; then
  TMPWEB="$(mktemp "${TMPDIR:-/tmp}/gruvbox-icon-web.XXXXXX.png")"
  TMPINNER="$(mktemp "${TMPDIR:-/tmp}/gruvbox-icon-inner.XXXXXX.png")"
  TPMAC="$(mktemp "${TMPDIR:-/tmp}/gruvbox-icon-macos-1024.XXXXXX.png")"
  compose_cleanup() {
    rm -f "$TMPWEB" "$TMPINNER" "$TPMAC"
  }
  trap compose_cleanup EXIT

  if ! export_icon_with_ictool_to "$TMPWEB" "$ICON_WEB_W" "$ICON_WEB_H"; then
    echo "[sync-brand-icons] \`ictool\` (web/full) failed. If you see xcode-select errors, run:" >&2
    echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
    echo "Then retry. Try ICON_EXPORT_RENDITION=Dark|Default|Clear|TintedDark if your bundle uses a different name." >&2
    exit 1
  fi

  if ! export_icon_with_ictool_to "$TMPINNER" "$ICON_MAC_INNER_W" "$ICON_MAC_INNER_H"; then
    echo "[sync-brand-icons] \`ictool\` (macOS inner) export failed." >&2
    exit 1
  fi

  sips --padToHeightWidth "$ICON_MAC_PAD" "$ICON_MAC_PAD" "$TMPINNER" --out "$TPMAC" >/dev/null 2>&1

  mkdir -p "$(dirname "$STUDIO_PNG")"
  cp "$TMPWEB" "$STUDIO_PNG"
  if [[ -n "$LANDING_PNG" ]]; then
    mkdir -p "$(dirname "$LANDING_PNG")"
    cp "$TMPWEB" "$LANDING_PNG"
  fi
  cp "$TPMAC" "$STUDIO_MACOS_PNG"

  trap - EXIT
  rm -f "$TMPWEB" "$TMPINNER" "$TPMAC"

  build_icns_from_png_master "$STUDIO_MACOS_PNG" "$STUDIO_ICNS"

  echo "[sync-brand-icons] Updated from $COMPOSER_BUNDLE:"
  echo "  $STUDIO_PNG (${ICON_WEB_W}×${ICON_WEB_H})"
  [[ -n "$LANDING_PNG" ]] && echo "  $LANDING_PNG (landing favicon)"
  echo "  $STUDIO_MACOS_PNG (inner ${ICON_MAC_INNER_W}×${ICON_MAC_INNER_H} padded to ${ICON_MAC_PAD}px)"
  echo "  $STUDIO_ICNS"
  exit 0
fi

if [[ ! -x "${ICTOOL_PATH:-}" ]]; then
  echo "[sync-brand-icons] Icon Composer \`ictool\` not found (install Xcode Icon Composer)." >&2
  echo "[sync-brand-icons] Set ICTOOL to the executable path if it lives elsewhere." >&2
fi
if [[ ! -d "$COMPOSER_BUNDLE" ]]; then
  echo "[sync-brand-icons] No icon bundle at $PARENT/icon.icon or $STUDIO/icon.icon" >&2
fi

if [[ -f "$STUDIO_PNG" && -f "$STUDIO_MACOS_PNG" && -f "$STUDIO_ICNS" ]]; then
  echo "[sync-brand-icons] Reusing committed PNG/icns (no Icon Composer bundle on this machine)." >&2
  exit 0
fi

echo "[sync-brand-icons] Falling back to legacy padded raster (\`build-macos-app-icon.sh\`)." >&2
exec bash "$STUDIO/scripts/build-macos-app-icon.sh"
