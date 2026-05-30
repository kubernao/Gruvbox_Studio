#!/usr/bin/env node
/**
 * E2E preflight: ensure `npm run package` has produced a runnable app under `out/`.
 * Exits 0 when `scripts/resolve-packaged-app.cjs` succeeds; otherwise runs package once and retries.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function runResolve() {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'resolve-packaged-app.cjs')], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
}

function runPackage() {
  return spawnSync('npm run package', {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
  });
}

function main() {
  let proc = runResolve();
  if (proc.status === 0 && String(proc.stdout || '').trim() !== '') {
    process.exit(0);
  }

  process.stderr.write('\n[e2e] Packaged app missing; running `npm run package` once...\n\n');
  const pkg = runPackage();
  if (pkg.status !== 0) {
    process.stderr.write('\n[e2e] `npm run package` failed. Fix build errors above, then retry.\n');
    process.exit(1);
  }

  proc = runResolve();
  if (proc.status === 0 && String(proc.stdout || '').trim() !== '') {
    process.exit(0);
  }

  process.stderr.write('\n[e2e] Packaged app still not found under out/ after package.\n');
  process.exit(1);
}

main();
