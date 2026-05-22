/**
 * Merge-open path resolution helpers for AI review turns.
 *
 * This module centralizes the "which file should DiffViewer open first" logic
 * so turn-complete behavior stays deterministic and testable. The assistant can
 * produce multiple changed paths, and hydration may occasionally miss the
 * preferred primary path. In that case we intentionally fall back to the first
 * valid repo-relative changed path rather than dropping the merge UI entirely.
 */

import { isPlausibleMergePath, normalizeMergePathCandidate } from './mergePathPolicy';

/**
 * Validates that a candidate path is repo-relative (not absolute, not empty).
 *
 * The merge viewer requires file paths relative to the repository root. This
 * guard rejects absolute POSIX/Windows paths and empty strings so callers never
 * pass invalid file targets to DiffViewer. It also blocks internal tool-state
 * directories (`.git` and `.gruvbox`) so AI memory/metadata files never become
 * merge-open candidates.
 */
export function isRepoRelativePath(candidate: string): boolean {
  const value = candidate.trim().replace(/\\/g, '/');
  if (value === '') {
    return false;
  }
  if (value.startsWith('/')) {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return false;
  }
  if (value === '.git' || value.startsWith('.git/')) {
    return false;
  }
  if (value === '.gruvbox' || value.startsWith('.gruvbox/')) {
    return false;
  }
  return isPlausibleMergePath(value);
}

/**
 * Picks the best file path to open for AI merge review.
 *
 * The primary hydrated path is preferred when present and valid. If it is
 * missing or stale, we prefer valid tool-touched paths that still exist in the
 * changed-path payload and then recover by selecting the first valid changed
 * path. The function returns an empty string when no actionable path exists,
 * allowing callers to skip merge-open safely.
 */
export function chooseMergeOpenPath(
  primaryRelativePath: string,
  changedRelativePaths?: string[],
  preferredRelativePaths?: string[],
): string {
  const primary = primaryRelativePath.trim();
  const changedCandidates = Array.isArray(changedRelativePaths)
    ? changedRelativePaths
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalizeMergePathCandidate(entry))
      .filter((entry) => isRepoRelativePath(entry))
    : [];

  if (isRepoRelativePath(primary)) {
    const hasPreferredCandidates = Array.isArray(preferredRelativePaths) && preferredRelativePaths.length > 0;
    if (!hasPreferredCandidates || changedCandidates.length === 0 || changedCandidates.includes(primary)) {
      return primary;
    }
  }

  const changedSet = new Set(changedCandidates);
  if (Array.isArray(preferredRelativePaths)) {
    for (const entry of preferredRelativePaths) {
      if (typeof entry !== 'string') {
        continue;
      }
      const preferred = entry.trim();
      if (!isRepoRelativePath(preferred)) {
        continue;
      }
      if (changedSet.size === 0 || changedSet.has(preferred)) {
        return preferred;
      }
    }
  }

  for (const candidate of changedCandidates) {
    if (isRepoRelativePath(candidate)) {
      return candidate;
    }
  }
  return '';
}

