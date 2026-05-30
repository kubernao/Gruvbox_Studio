/**
 * Persists recently opened workspace folder paths in localStorage so the welcome
 * screen and future session restore can surface familiar project roots without a
 * dedicated backend.
 */

const STORAGE_KEY = 'gruvbox.recentWorkspaces.v1';
const MAX_RECENT = 10;

/**
 * Returns the most recently opened workspace paths, newest first, deduplicated
 * case-insensitively on Windows-style paths.
 */
export function getRecentWorkspaces(): string[] {
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
 * Records a workspace folder as recently opened, moving it to the front of the
 * MRU list and trimming the list to {@link MAX_RECENT} entries.
 */
export function recordRecentWorkspace(path: string): void {
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
    ...getRecentWorkspaces().filter(
      (entry) => entry.replace(/\\/g, '/').toLowerCase() !== normalizedKey,
    ),
  ].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota or privacy-mode failures.
  }
}
