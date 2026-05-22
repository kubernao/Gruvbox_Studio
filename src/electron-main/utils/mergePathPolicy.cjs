/**
 * mergePathPolicy — filters repo-relative paths for AI merge review and tool validation.
 *
 * Rejects bare single-segment tokens without extensions (e.g. "drone") that often come from
 * mistaken write paths or bash redirection inference, while allowing conventional root files.
 */

const KNOWN_ROOT_BASENAMES = new Set([
  'readme',
  'makefile',
  'license',
  'licence',
  'dockerfile',
  'gemfile',
  'rakefile',
  'procfile',
  'changelog',
  'contributing',
  'authors',
  'copying',
]);

/**
 * Normalizes a candidate path to forward slashes without leading ./
 *
 * @param {unknown} rawPath
 * @returns {string}
 */
function normalizeMergePathCandidate(rawPath) {
  if (typeof rawPath !== 'string') {
    return '';
  }
  const trimmed = rawPath.trim().replaceAll('\\', '/');
  if (trimmed === '') {
    return '';
  }
  let withoutDot = trimmed.replace(/^\.\//, '');
  if (withoutDot.startsWith('@')) {
    withoutDot = withoutDot.slice(1).trim();
  }
  if (withoutDot === '' || withoutDot.startsWith('../') || withoutDot === '..') {
    return '';
  }
  return withoutDot;
}

/**
 * Returns true when the path is suitable for merge UI and structured file tools.
 *
 * @param {string} rawPath
 * @returns {boolean}
 */
function isPlausibleMergePath(rawPath) {
  const normalized = normalizeMergePathCandidate(rawPath);
  if (normalized === '') {
    return false;
  }
  if (normalized === '.git' || normalized.startsWith('.git/')) {
    return false;
  }
  if (normalized === '.gruvbox' || normalized.startsWith('.gruvbox/')) {
    return false;
  }
  if (normalized.includes('/')) {
    return true;
  }
  const lower = normalized.toLowerCase();
  const base = lower.includes('.') ? lower.slice(0, lower.lastIndexOf('.')) : lower;
  if (KNOWN_ROOT_BASENAMES.has(base) || KNOWN_ROOT_BASENAMES.has(lower)) {
    return true;
  }
  if (lower.includes('.')) {
    return true;
  }
  return false;
}

/**
 * Filters and deduplicates paths, keeping only plausible merge targets.
 *
 * @param {string[]} paths
 * @returns {{ plausible: string[], rejected: string[] }}
 */
function partitionMergePaths(paths) {
  const plausible = [];
  const rejected = [];
  const seen = new Set();
  for (const entry of paths || []) {
    const normalized = normalizeMergePathCandidate(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (isPlausibleMergePath(normalized)) {
      plausible.push(normalized);
    } else {
      rejected.push(normalized);
    }
  }
  plausible.sort((a, b) => a.localeCompare(b));
  rejected.sort((a, b) => a.localeCompare(b));
  return { plausible, rejected };
}

module.exports = {
  KNOWN_ROOT_BASENAMES,
  normalizeMergePathCandidate,
  isPlausibleMergePath,
  partitionMergePaths,
};
