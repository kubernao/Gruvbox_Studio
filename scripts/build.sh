#!/usr/bin/env bash
set -euo pipefail

# This script performs a full local bootstrap for Gruvbox Studio by installing
# JavaScript dependencies, building the Pi submodule, building the Rust sidecar,
# and finally starting the desktop app. We append a targeted
# Node deprecation-suppression flag for this workflow so known upstream runtime
# warnings (for example DEP0040 from transitive dependencies) do not pollute
# output or get misclassified as build failures by wrappers.

# Always run from Gruvbox_studio root (works whether you invoke this as
# `bash scripts/build.sh` from the studio repo or `bash build.sh` from scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PI_MONO_DIR="${STUDIO_ROOT}/submodules/pi-mono"
cd "${STUDIO_ROOT}"

copy_rust_sidecar() {
  # This function copies the release Rust artifact into dist-rust so Electron can
  # load the addon from a stable project path during local development startup.
  local release_dir="${STUDIO_ROOT}/rust-sidecar/target/release"
  local destination_dir="${STUDIO_ROOT}/dist-rust"
  local destination_file="${destination_dir}/gruvbox-file-ops.node"
  local source_file=""
  local candidates=(
    "${release_dir}/libgruvbox_file_ops.dylib"
    "${release_dir}/gruvbox_file_ops.dylib"
    "${release_dir}/libgruvbox_file_ops.so"
    "${release_dir}/gruvbox_file_ops.so"
    "${release_dir}/gruvbox_file_ops.dll"
    "${release_dir}/gruvbox_file_ops.node"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -f "${candidate}" ]]; then
      source_file="${candidate}"
      break
    fi
  done

  if [[ -z "${source_file}" ]]; then
    echo "ERROR: Rust sidecar artifact not found in ${release_dir}." >&2
    echo "Run: (cd rust-sidecar && cargo build --release)" >&2
    exit 1
  fi

  mkdir -p "${destination_dir}"
  cp "${source_file}" "${destination_file}"
}

if [[ -d "${STUDIO_ROOT}/.git" && -f "${STUDIO_ROOT}/.gitmodules" ]]; then
  git submodule update --init --recursive
fi

if [[ ! -f "${PI_MONO_DIR}/package.json" ]]; then
  echo "ERROR: Pi mono-repo checkout is missing at ${PI_MONO_DIR}." >&2
  echo "Run: git submodule update --init --recursive" >&2
  exit 1
fi

npm install
npm run build:pi
(cd rust-sidecar && cargo build --release)
copy_rust_sidecar
npm start
cd "${SCRIPT_DIR}"
