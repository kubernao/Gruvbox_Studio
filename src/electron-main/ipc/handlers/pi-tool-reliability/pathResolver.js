/**
 * pathResolver — fuzzy file-path resolution for AI tool calls.
 *
 * When the AI tool call contains a path that does not exist verbatim on disk,
 * this module walks the workspace directory tree (skipping {@link IGNORE_DIRS})
 * and returns the closest match above a configurable confidence threshold.
 * Used by `pi-gui.js` to repair malformed `path` arguments before retrying.
 *
 * Main-process only. All file I/O is synchronous to keep it cheap in the
 * hot path of a streaming tool-call handler.
 */

const fs = require('fs');
const path = require('node:path');

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', '.cursor']);
const FILE_INDEX_CACHE_TTL_MS = 15_000;
const FILE_INDEX_CACHE_LIMIT = 4000;
const fileIndexCache = new Map();

function normalizeSlashes(input) {
  return String(input ?? '').replace(/\\/g, '/').trim();
}

function splitSegments(input) {
  return normalizeSlashes(input)
    .split('/')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function levenshtein(a, b) {
  const s = String(a);
  const t = String(b);
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const aa = normalizeSlashes(a).toLowerCase();
  const bb = normalizeSlashes(b).toLowerCase();
  if (!aa || !bb) return 0;
  const dist = levenshtein(aa, bb);
  return Math.max(0, 1 - dist / Math.max(aa.length, bb.length));
}

function collectFiles(root, limit = 4000) {
  const out = [];
  const stack = [root];
  while (stack.length > 0 && out.length < limit) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name.toLowerCase())) {
          stack.push(abs);
        }
      } else if (entry.isFile()) {
        out.push(abs);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

function getCachedFiles(root, limit = FILE_INDEX_CACHE_LIMIT) {
  const cacheKey = path.resolve(root);
  const now = Date.now();
  const cached = fileIndexCache.get(cacheKey);
  if (cached && now - cached.updatedAt <= FILE_INDEX_CACHE_TTL_MS) {
    return cached.files;
  }
  const files = collectFiles(cacheKey, limit);
  fileIndexCache.set(cacheKey, { updatedAt: now, files });
  return files;
}

function scoreCandidate(queryPath, absPath, cwd, recentPaths = []) {
  const rel = normalizeSlashes(path.relative(cwd, absPath));
  const pathSimilarity = similarity(queryPath, rel);
  const qSeg = splitSegments(queryPath);
  const cSeg = splitSegments(rel);
  const overlap = qSeg.length === 0 ? 0 : qSeg.filter((v) => cSeg.includes(v)).length / qSeg.length;
  const qBase = path.basename(normalizeSlashes(queryPath)).toLowerCase();
  const cBase = path.basename(rel).toLowerCase();
  const basenameBonus = qBase && cBase ? (qBase === cBase ? 1 : similarity(qBase, cBase)) : 0;
  const qExt = path.extname(qBase);
  const cExt = path.extname(cBase);
  const extensionBonus = qExt && cExt && qExt === cExt ? 1 : 0;
  const recencyBonus = recentPaths.some((p) => normalizeSlashes(p).toLowerCase().endsWith(rel.toLowerCase())) ? 1 : 0;
  const score = 0.45 * pathSimilarity + 0.25 * overlap + 0.15 * basenameBonus + 0.1 * extensionBonus + 0.05 * recencyBonus;
  return { absPath, relPath: rel, score };
}

function resolveFuzzyPath({
  queryPath,
  cwd,
  recentPaths = [],
  highConfidenceThreshold = 0.82,
  confidenceMargin = 0.06,
}) {
  const raw = normalizeSlashes(queryPath);
  if (!raw) {
    return { resolved: null, confidence: 0, candidates: [] };
  }
  const absoluteDirect = path.isAbsolute(raw) ? raw : path.join(cwd, raw);
  if (fs.existsSync(absoluteDirect)) {
    return { resolved: absoluteDirect, confidence: 1, candidates: [{ absPath: absoluteDirect, relPath: normalizeSlashes(path.relative(cwd, absoluteDirect)), score: 1 }] };
  }
  const files = getCachedFiles(cwd);
  const ranked = files
    .map((file) => scoreCandidate(raw, file, cwd, recentPaths))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const best = ranked[0];
  const second = ranked[1];
  const margin = best && second ? best.score - second.score : best ? best.score : 0;
  if (!best || best.score < highConfidenceThreshold || margin < confidenceMargin) {
    return { resolved: null, confidence: best?.score ?? 0, candidates: ranked };
  }
  return { resolved: best.absPath, confidence: best.score, margin, candidates: ranked };
}

module.exports = {
  resolveFuzzyPath,
};
