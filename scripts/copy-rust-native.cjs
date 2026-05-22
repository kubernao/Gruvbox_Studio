'use strict';

/**
 * After `cargo build --release`, copy the cdylib artifact to dist-rust/gruvbox-file-ops.node
 * so Node can load it as a native addon (.node is the DLL/so/dylib).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'rust-sidecar', 'target', 'release');
const outDir = path.join(root, 'dist-rust');
const outFile = path.join(outDir, 'gruvbox-file-ops.node');

/** Prefer the artifact for the current OS so a stale cross-build in target/release is not picked first. */
function artifactNamesForPlatform() {
  switch (process.platform) {
    case 'win32':
      return ['gruvbox_file_ops.dll', 'gruvbox_file_ops.node'];
    case 'darwin':
      return ['libgruvbox_file_ops.dylib', 'gruvbox_file_ops.dylib', 'gruvbox_file_ops.node'];
    default:
      return ['libgruvbox_file_ops.so', 'gruvbox_file_ops.so', 'gruvbox_file_ops.node'];
  }
}

const fallbackNames = ['gruvbox_file_ops.dll', 'gruvbox_file_ops.so', 'libgruvbox_file_ops.so', 'libgruvbox_file_ops.dylib'];

function findArtifact() {
  const candidates = [...artifactNamesForPlatform(), ...fallbackNames];
  for (const name of candidates) {
    const p = path.join(releaseDir, name);
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

const src = findArtifact();
if (!src) {
  console.error(
    '[copy-rust-native] No release cdylib found under',
    releaseDir,
    '— run: cd rust-sidecar && cargo build --release',
  );
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, outFile);
console.log('[copy-rust-native]', path.relative(root, src), '→', path.relative(root, outFile));
