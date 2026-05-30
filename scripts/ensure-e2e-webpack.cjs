#!/usr/bin/env node
/**
 * Playwright E2E launches Electron against `.webpack/main` without starting the dev server.
 * Requires a production-style renderer bundle on disk (same as after `npm run package`).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  path.join(root, '.webpack', 'main', 'index.js'),
  path.join(root, '.webpack', 'renderer', 'main_window', 'preload.js'),
];

const missing = required.filter((p) => !fs.existsSync(p));

if (missing.length === 0) {
  process.exit(0);
}

console.error('');
console.error('[e2e] Webpack output is missing or not E2E-safe.');
console.error('');
console.error('  Run once:  npm run package');
console.error('  (or start the app with npm start, wait for the first successful compile, then stop)');
console.error('  If this keeps failing, clear stale output first: rm -rf .webpack');
console.error('');
if (missing.length > 0) {
  console.error('Missing:');
  for (const p of missing) {
    console.error('  -', path.relative(root, p));
  }
}
console.error('');
process.exit(1);
