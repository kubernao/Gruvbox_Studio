#!/usr/bin/env node
/**
 * Resolve the packaged Gruvbox Studio executable under out/ after npm run package.
 * Darwin: newest path matching .app/Contents/MacOS/ plus a single path segment (main binary).
 * Linux: newest file named like package.json productName under out/platform-dir/.
 * Windows: newest .exe under out (best-effort; skips uninstall stubs).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'out');

function readProductName() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return String(pkg.productName || pkg.name || 'Gruvbox Studio').trim() || 'Gruvbox Studio';
  } catch {
    return 'Gruvbox Studio';
  }
}

/** @param {string} dir */
function walkFiles(dir, onFile) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, onFile);
    } else if (ent.isFile()) {
      onFile(full);
    }
  }
}

function findCandidates() {
  const productName = readProductName();
  /** @type {{ full: string; mtimeMs: number }[]} */
  const hits = [];

  if (!fs.existsSync(outDir)) {
    return hits;
  }

  if (process.platform === 'darwin') {
    walkFiles(outDir, (full) => {
      if (!/\.app\/Contents\/MacOS\/[^/]+$/i.test(full)) return;
      try {
        const st = fs.statSync(full);
        if (st.isFile()) {
          hits.push({ full, mtimeMs: st.mtimeMs });
        }
      } catch {
        /* skip */
      }
    });
    return hits;
  }

  if (process.platform === 'win32') {
    walkFiles(outDir, (full) => {
      if (!/\.exe$/i.test(full)) return;
      if (/uninstall/i.test(full)) return;
      try {
        const st = fs.statSync(full);
        if (st.isFile()) {
          hits.push({ full, mtimeMs: st.mtimeMs });
        }
      } catch {
        /* skip */
      }
    });
    return hits;
  }

  // Linux and other Unix: `out/<platform-dir>/<productName>`
  walkFiles(outDir, (full) => {
    const base = path.basename(full);
    if (base !== productName) return;
    const parent = path.basename(path.dirname(full));
    if (!parent || parent === 'out') return;
    try {
      const st = fs.statSync(full);
      if (st.isFile()) {
        hits.push({ full, mtimeMs: st.mtimeMs });
      }
    } catch {
      /* skip */
    }
  });
  return hits;
}

function main() {
  const productName = readProductName();
  let hits = findCandidates();
  if (hits.length === 0) {
    process.stderr.write(
      '[e2e] No packaged app found under out/. Run `npm run package` from the repo root first.\n',
    );
    process.exit(1);
  }
  if (process.platform === 'darwin') {
    const mainSuffix = path.join(`${productName}.app`, 'Contents', 'MacOS', productName);
    const primary = hits.filter((h) => h.full.endsWith(mainSuffix));
    if (primary.length > 0) {
      hits = primary;
    }
  }
  hits.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const chosen = hits[0].full;
  process.stdout.write(`${chosen}\n`);
  process.exit(0);
}

main();
