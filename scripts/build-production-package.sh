#!/usr/bin/env bash
set -euo pipefail

# This script creates a production-ready desktop release by first ensuring the
# repository checkout includes the Pi submodule, then installing dependencies,
# building Pi and Rust sidecar artifacts, and finally generating distributable
# installers with Electron Forge. Each step is explicit so release builds are
# easy to follow and debug when something is missing from the workspace.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PI_MONO_DIR="${PROJECT_ROOT}/submodules/pi-mono"

print_step() {
  local message="$1"
  echo
  echo "==> ${message}"
}

initialize_git_submodules() {
  # This function initializes Git submodules when the project is checked out as a
  # Git repository, matching the CI checkout step so local release builds receive
  # the same Pi mono-repo content that packaging expects under submodules/pi-mono.
  print_step "Initializing Git submodules"

  if [[ ! -d "${PROJECT_ROOT}/.git" ]]; then
    echo "Not a Git checkout; skipping submodule initialization."
    return
  fi

  if [[ ! -f "${PROJECT_ROOT}/.gitmodules" ]]; then
    echo "No .gitmodules file found; assuming pi-mono is vendored in the repository."
    return
  fi

  git -C "${PROJECT_ROOT}" submodule update --init --recursive
}

ensure_pi_mono_checkout() {
  # This function verifies that the Pi mono-repo checkout exists before any npm
  # work begins, because Gruvie packaging depends on submodules/pi-mono and an
  # uninitialized submodule leaves an empty directory that breaks later build steps.
  print_step "Verifying Pi submodule checkout"

  if [[ -f "${PI_MONO_DIR}/package.json" ]]; then
    return
  fi

  echo "ERROR: Pi mono-repo checkout is missing at ${PI_MONO_DIR}." >&2
  echo "From the Gruvbox Studio repository root, run:" >&2
  echo "  git submodule update --init --recursive" >&2
  echo "Then rerun this script (or npm run release:desktop)." >&2
  exit 1
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

install_pi_mono_dependencies() {
  # This function installs Pi mono-repo dependencies before build:pi runs, using
  # npm ci when a lockfile is present so release builds match CI determinism.
  print_step "Installing Pi mono-repo dependencies"

  if [[ -f "${PI_MONO_DIR}/package-lock.json" ]]; then
    npm --prefix "${PI_MONO_DIR}" ci
    return
  fi

  npm --prefix "${PI_MONO_DIR}" install
}

build_native_and_pi_artifacts() {
  # This function builds the Pi coding-agent CLI and Rust file-ops sidecar from
  # source so packaging can run without depending on extra helper files in scripts/.
  print_step "Building Pi CLI and Rust sidecar artifacts"
  npm run build:pi
  (cd "${PROJECT_ROOT}/rust-sidecar" && cargo build --release)
  copy_rust_sidecar_artifact
}

copy_rust_sidecar_artifact() {
  # This function copies the Rust release artifact into dist-rust as
  # gruvbox-file-ops.node so the packaged application can include it reliably.
  local release_dir="${PROJECT_ROOT}/rust-sidecar/target/release"
  local output_dir="${PROJECT_ROOT}/dist-rust"
  local output_file="${output_dir}/gruvbox-file-ops.node"
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

  mkdir -p "${output_dir}"
  cp "${source_file}" "${output_file}"
}

verify_pi_integration_paths() {
  # This function validates the exact Pi integration files used by Gruvbox
  # Studio at runtime and fails fast with actionable guidance if missing.
  local pi_cli_path="${PI_MONO_DIR}/packages/coding-agent/dist/cli.js"
  local editor_bridge_path="${PI_MONO_DIR}/.pi/extensions/gruvbox-editor-bridge.ts"
  local pi_node_modules="${PI_MONO_DIR}/node_modules"

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

  if [[ ! -d "$pi_node_modules" ]]; then
    echo "ERROR: Pi mono-repo node_modules missing at $pi_node_modules" >&2
    echo "Run: npm --prefix submodules/pi-mono ci" >&2
    exit 1
  fi
}

verify_rust_sidecar_path() {
  # This function validates that the compiled Rust native addon was copied into
  # dist-rust before packaging, because file operations in the desktop app fail
  # at runtime when this artifact is absent from extraResource output.
  local rust_addon_path="${PROJECT_ROOT}/dist-rust/gruvbox-file-ops.node"

  print_step "Validating Rust sidecar artifact"

  if [[ ! -f "$rust_addon_path" ]]; then
    echo "ERROR: Rust sidecar not found at $rust_addon_path" >&2
    echo "Run: npm run build:rust" >&2
    exit 1
  fi
}

verify_keytar_runtime_module() {
  # This function validates that keytar is available in node_modules because the
  # main-process bundle resolves it as an external dependency at runtime and
  # falls back to file-based credential storage when the module is missing.
  local keytar_entry="${PROJECT_ROOT}/node_modules/keytar/lib/keytar.js"
  local keytar_native="${PROJECT_ROOT}/node_modules/keytar/build/Release/keytar.node"

  print_step "Validating keytar runtime module"

  if [[ ! -f "$keytar_entry" || ! -f "$keytar_native" ]]; then
    echo "ERROR: keytar runtime module is incomplete under ${PROJECT_ROOT}/node_modules/keytar." >&2
    echo "Run: npm ci" >&2
    exit 1
  fi
}

build_mac_icons() {
  # This function refreshes platform icon assets before packaging so macOS and
  # other makers receive the current brand icons referenced by forge.config.js.
  print_step "Syncing brand icons"
  bash "${PROJECT_ROOT}/scripts/sync-brand-icons-from-composer.sh"
}

make_distribution_artifacts() {
  # This function produces platform installer artifacts from the packaged app so
  # the build output can be shared as a release candidate. Electron Forge premake
  # hooks rebuild prerequisites, but we already validated them above for fast failure.
  print_step "Generating distribution artifacts"
  npx cross-env NODE_ENV=production electron-forge make
}

verify_packaged_runtime_assets() {
  # This function validates that packaged outputs contain Pi CLI, Gruvbox Pi
  # extensions, Pi runtime dependencies, and the Rust sidecar required at runtime,
  # so release builds fail early when packaging layout changes drop mandatory assets.
  local search_roots=(
    "${PROJECT_ROOT}/out"/*/*.app/Contents/Resources
    "${PROJECT_ROOT}/out"/*/resources
  )
  local checked_root_count=0
  local found_valid_pi_root=""
  local found_rust_sidecar=0
  local found_keytar_module=0

  print_step "Verifying packaged runtime assets"

  for root in "${search_roots[@]}"; do
    if [[ ! -d "$root" ]]; then
      continue
    fi

    checked_root_count=$((checked_root_count + 1))

    local pi_roots=(
      "${root}/pi-mono"
      "${root}/submodules/pi-mono"
    )

    for pi_root in "${pi_roots[@]}"; do
      local cli_path="${pi_root}/packages/coding-agent/dist/cli.js"
      local bridge_path="${pi_root}/.pi/extensions/gruvbox-editor-bridge.ts"
      local pi_node_modules="${pi_root}/node_modules"

      if [[ -f "$cli_path" && -f "$bridge_path" && -d "$pi_node_modules" ]]; then
        found_valid_pi_root="$pi_root"
        break
      fi
    done

    if [[ -f "${root}/dist-rust/gruvbox-file-ops.node" ]]; then
      found_rust_sidecar=1
    fi

    if [[ -f "${root}/node_modules/keytar/lib/keytar.js" && -f "${root}/node_modules/keytar/build/Release/keytar.node" ]]; then
      found_keytar_module=1
    fi

    if [[ -f "${root}/app.asar.unpacked/node_modules/keytar/lib/keytar.js" && -f "${root}/app.asar.unpacked/node_modules/keytar/build/Release/keytar.node" ]]; then
      found_keytar_module=1
    fi

    if [[ -n "$found_valid_pi_root" && "$found_rust_sidecar" -eq 1 && "$found_keytar_module" -eq 1 ]]; then
      echo "Verified packaged Pi assets in: ${found_valid_pi_root}"
      echo "Verified packaged Rust sidecar in: ${root}/dist-rust"
      if [[ -f "${root}/node_modules/keytar/lib/keytar.js" ]]; then
        echo "Verified packaged keytar runtime module in: ${root}/node_modules/keytar"
      else
        echo "Verified packaged keytar runtime module in: ${root}/app.asar.unpacked/node_modules/keytar"
      fi
      return
    fi
  done

  if [[ "$checked_root_count" -eq 0 ]]; then
    echo "ERROR: No packaged resource directories were found under ${PROJECT_ROOT}/out." >&2
    exit 1
  fi

  if [[ -z "$found_valid_pi_root" ]]; then
    echo "ERROR: Packaged app is missing Pi CLI, Gruvbox extensions, and/or Pi node_modules." >&2
    exit 1
  fi

  if [[ "$found_rust_sidecar" -ne 1 ]]; then
    echo "ERROR: Packaged app is missing dist-rust/gruvbox-file-ops.node." >&2
    exit 1
  fi

  echo "ERROR: Packaged app is missing node_modules/keytar runtime files." >&2
  exit 1
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
  initialize_git_submodules
  ensure_pi_mono_checkout
  install_dependencies
  install_pi_mono_dependencies
  build_native_and_pi_artifacts
  verify_pi_integration_paths
  verify_rust_sidecar_path
  verify_keytar_runtime_module
  build_mac_icons
  make_distribution_artifacts
  verify_packaged_runtime_assets
  print_completion
}

main "$@"
