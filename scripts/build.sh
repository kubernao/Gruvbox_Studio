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
cd "${STUDIO_ROOT}"

npm install
npm run build:pi
npm run build:rust
npm start
cd "${SCRIPT_DIR}"
