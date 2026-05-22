#!/usr/bin/env bash
set -euo pipefail

# This script creates a production-ready desktop release by first ensuring
# dependencies are installed, then building package artifacts in production mode,
# and finally generating distributable installers with Electron Forge. It is
# intentionally explicit so each release step is easy to follow and debug.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

print_step() {
  local message="$1"
  echo
  echo "==> ${message}"
}

install_dependencies() {
  # This function installs JavaScript dependencies using npm ci when a lockfile
  # exists so release builds are deterministic, and falls back to npm install
  # for environments where a lockfile is unavailable.
  if [[ -f "${PROJECT_ROOT}/package-lock.json" ]]; then
    print_step "Installing dependencies with npm ci"
    npm ci
    return
  fi

  print_step "Installing dependencies with npm install"
  npm install
}

build_pi_cli() {
  # This function builds the Pi mono-repo artifacts so the coding-agent CLI
  # exists before packaging, preventing runtime startup failures in Gruvie.
  print_step "Building Pi CLI artifacts"
  npm run build:pi
}

verify_pi_integration_paths() {
  # This function validates the exact Pi integration files used by Gruvbox
  # Studio at runtime and fails fast with actionable guidance if missing.
  local pi_cli_path="${PROJECT_ROOT}/submodules/pi-mono/packages/coding-agent/dist/cli.js"
  local editor_bridge_path="${PROJECT_ROOT}/submodules/pi-mono/.pi/extensions/gruvbox-editor-bridge.ts"

  print_step "Validating Pi integration prerequisites"

  if [[ ! -f "$pi_cli_path" ]]; then
    echo "ERROR: Pi CLI not found at $pi_cli_path" >&2
    echo "Run: npm run build:pi" >&2
    exit 1
  fi

  if [[ ! -f "$editor_bridge_path" ]]; then
    echo "ERROR: Gruvbox editor bridge extension missing at $editor_bridge_path" >&2
    exit 1
  fi
}

build_production_package() {
  # This function compiles the application and packages it with production
  # environment settings so the output matches release expectations.
  print_step "Building production package"
  npm run build:prepare
  npm run build:prod
}

make_distribution_artifacts() {
  # This function produces platform installer artifacts from the packaged app so
  # the build output can be shared as a release candidate.
  print_step "Generating distribution artifacts"
  npx cross-env NODE_ENV=production electron-forge make
}

verify_packaged_pi_assets() {
  # This function validates that packaged outputs actually contain the Pi CLI and
  # Gruvbox extension files required at runtime, so release builds fail early when
  # packaging layout changes drop mandatory integration assets.
  local search_roots=(
    "${PROJECT_ROOT}/out"/*/*.app/Contents/Resources
    "${PROJECT_ROOT}/out"/*/resources
  )
  local checked_root_count=0
  local found_valid_root=0

  print_step "Verifying packaged Pi assets"

  for root in "${search_roots[@]}"; do
    if [[ ! -d "$root" ]]; then
      continue
    fi

    checked_root_count=$((checked_root_count + 1))

    local cli_in_pi_root="${root}/pi-mono/packages/coding-agent/dist/cli.js"
    local bridge_in_pi_root="${root}/pi-mono/.pi/extensions/gruvbox-editor-bridge.ts"
    local cli_in_submodules="${root}/submodules/pi-mono/packages/coding-agent/dist/cli.js"
    local bridge_in_submodules="${root}/submodules/pi-mono/.pi/extensions/gruvbox-editor-bridge.ts"

    if [[ -f "$cli_in_pi_root" && -f "$bridge_in_pi_root" ]]; then
      found_valid_root=1
      echo "Verified packaged Pi assets in: ${root}/pi-mono"
      break
    fi

    if [[ -f "$cli_in_submodules" && -f "$bridge_in_submodules" ]]; then
      found_valid_root=1
      echo "Verified packaged Pi assets in: ${root}/submodules/pi-mono"
      break
    fi
  done

  if [[ "$checked_root_count" -eq 0 ]]; then
    echo "ERROR: No packaged resource directories were found under ${PROJECT_ROOT}/out." >&2
    exit 1
  fi

  if [[ "$found_valid_root" -ne 1 ]]; then
    echo "ERROR: Packaged app is missing Pi CLI and/or Gruvbox extension files." >&2
    exit 1
  fi
}

print_completion() {
  # This function provides a clear completion message and points to the standard
  # Electron Forge output folders used by this project.
  print_step "Production build and packaging complete"
  echo "Packaged app output: ${PROJECT_ROOT}/out"
  echo "Installer artifacts: ${PROJECT_ROOT}/out/make"
}

main() {
  # This function coordinates the end-to-end production release workflow in a
  # single command to keep local release execution simple and repeatable.
  cd "${PROJECT_ROOT}"
  install_dependencies
  build_pi_cli
  verify_pi_integration_paths
  build_production_package
  make_distribution_artifacts
  verify_packaged_pi_assets
  print_completion
}

main "$@"
