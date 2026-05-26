/**
 * mergePathPolicy — filters repo-relative paths for AI merge review and tool validation.
 *
 * Rejects bare single-segment tokens without extensions (e.g. "drone") that often come from
 * mistaken write paths or bash redirection inference, while allowing conventional root files.
 * Logic mirrors {@link ../../electron-main/utils/mergePathPolicy.cjs} for main/renderer parity.
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
 */
export function normalizeMergePathCandidate(rawPath: unknown): string {
  if (typeof rawPath !== 'string') {
    return '';
  }
  const trimmed = rawPath.trim().replace(/\\/g, '/');
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
 */
export function isPlausibleMergePath(rawPath: string): boolean {
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
 */
export function partitionMergePaths(paths: string[]): { plausible: string[]; rejected: string[] } {
  const plausible: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const entry of paths) {
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

/**
 * Builds a sorted merge queue from raw changed-path candidates.
 */
export function buildMergeQueuePaths(rawPaths: string[] | undefined): {
  queue: string[];
  rejected: string[];
} {
  const raw = Array.isArray(rawPaths) ? rawPaths : [];
  const { plausible, rejected } = partitionMergePaths(
    raw.map((entry) => normalizeMergePathCandidate(entry)).filter(Boolean),
  );
  return { queue: plausible, rejected };
}
