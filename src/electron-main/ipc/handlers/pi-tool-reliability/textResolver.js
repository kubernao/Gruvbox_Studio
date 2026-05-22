/**
 * textResolver — fuzzy old-text matching for AI `edit` tool calls.
 *
 * When the AI provides an `oldText` snippet that does not appear verbatim in
 * the file, this module uses a Levenshtein-distance similarity score to find
 * the closest matching region above a configurable threshold. Used by
 * `pi-gui.js` to repair near-miss edit targets before retrying.
 *
 * Stateless pure functions; no IPC or file I/O.
 */

function levenshtein(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
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

function normalizeWs(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function tokenOverlap(a, b) {
  const ta = new Set(normalizeWs(a).toLowerCase().split(/\W+/).filter(Boolean));
  const tb = new Set(normalizeWs(b).toLowerCase().split(/\W+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

function similarity(a, b) {
  const aa = normalizeWs(a);
  const bb = normalizeWs(b);
  if (!aa || !bb) return 0;
  return Math.max(0, 1 - levenshtein(aa, bb) / Math.max(aa.length, bb.length));
}

function snippetAt(lines, start, count) {
  return lines.slice(start, start + count).join('\n');
}

function resolveFuzzyText({ oldText, fileText, highThreshold = 0.86, minGap = 0.08 }) {
  const needle = String(oldText ?? '');
  const hay = String(fileText ?? '');
  if (!needle || !hay) return { ok: false, reason: 'empty', bestScore: 0, secondBestScore: 0, bestSnippet: '' };
  if (hay.includes(needle)) return { ok: true, exact: true, bestScore: 1, secondBestScore: 0, bestSnippet: needle, ambiguous: false };
  const wsNeedle = normalizeWs(needle);
  if (wsNeedle && normalizeWs(hay).includes(wsNeedle)) {
    return { ok: true, exact: false, bestScore: 0.95, secondBestScore: 0, bestSnippet: wsNeedle, ambiguous: false };
  }
  const lines = hay.split(/\r?\n/);
  const needleLines = Math.max(1, needle.split(/\r?\n/).length);
  let best = { score: 0, snippet: '' };
  let second = { score: 0, snippet: '' };
  for (let i = 0; i < lines.length; i += 1) {
    const candidate = snippetAt(lines, i, needleLines);
    if (!candidate) continue;
    const tOverlap = tokenOverlap(needle, candidate);
    const lev = similarity(needle, candidate);
    const indentSignal = /^\s*/.exec(needle)?.[0].length === /^\s*/.exec(candidate)?.[0].length ? 1 : 0;
    const score = 0.5 * tOverlap + 0.35 * lev + 0.15 * indentSignal;
    if (score > best.score) {
      second = best;
      best = { score, snippet: candidate };
    } else if (score > second.score) {
      second = { score, snippet: candidate };
    }
  }
  const ok = best.score >= highThreshold && best.score - second.score >= minGap;
  return {
    ok,
    exact: false,
    ambiguous: !ok,
    bestScore: best.score,
    secondBestScore: second.score,
    bestSnippet: best.snippet,
  };
}

module.exports = {
  resolveFuzzyText,
};
