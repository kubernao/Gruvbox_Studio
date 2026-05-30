'use strict';

/**
 * Runs `cargo build --release` in rust-sidecar, then copies the native artifact.
 * Uses %USERPROFILE%/.cargo/bin (or $HOME/.cargo/bin) when `cargo` is not on PATH
 * (common in IDE terminals on Windows).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcRust = path.join(root, 'rust-sidecar');

function resolveCargoExecutable() {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return 'cargo';
  const binDir = path.join(home, '.cargo', 'bin');
  const name = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const full = path.join(binDir, name);
  return fs.existsSync(full) ? full : 'cargo';
}

function run(name, args, options) {
  const r = spawnSync(name, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (r.error) {
    console.error(`[build-rust-sidecar] Failed to spawn ${name}:`, r.error.message);
    if (r.error.code === 'ENOENT' && /cargo(\.exe)?$/i.test(String(name))) {
      console.error(
        '[build-rust-sidecar] cargo not found. Install Rust (https://rustup.rs/) or add ~/.cargo/bin to PATH.',
      );
    }
    process.exit(1);
  }
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

const cargo = resolveCargoExecutable();
run(cargo, ['build', '--release'], { cwd: srcRust, env: process.env });

run(process.execPath, [path.join(root, 'scripts', 'copy-rust-native.cjs')], {
  cwd: root,
  env: process.env,
});
