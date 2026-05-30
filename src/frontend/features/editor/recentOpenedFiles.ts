/**
 * Tracks recently opened file paths within the current app session and across
 * restarts so quick-open can surface familiar documents ahead of the full tree.
 */

const STORAGE_KEY = 'gruvbox.recentOpenedFiles.v1';
const MAX_RECENT = 30;

/**
 * Returns recently opened absolute file paths, newest first.
 */
export function getRecentOpenedFiles(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  } catch {
    return [];
  }
}

/**
 * Records a file path as recently opened for quick-open MRU ordering.
 */
export function recordOpenedFile(path: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const trimmed = path.trim();
  if (trimmed === '') {
    return;
  }
  const normalizedKey = trimmed.replace(/\\/g, '/').toLowerCase();
  const next = [
    trimmed,
    ...getRecentOpenedFiles().filter(
      (entry) => entry.replace(/\\/g, '/').toLowerCase() !== normalizedKey,
    ),
  ].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
}
