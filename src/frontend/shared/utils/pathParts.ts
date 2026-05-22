/**
 * Cross-platform path helpers for renderer code (no Node `path` in browser bundle).
 * Handles `/` (POSIX) and `\\` (Windows).
 */

/**
 * Parent directory of a file path (no trailing separator).
 */
export function parentDirectoryFromFilePath(filePath: string): string {
  const trimmed = String(filePath ?? '').trim();
  if (!trimmed) {
    return '';
  }
  const lastFwd = trimmed.lastIndexOf('/');
  const lastBack = trimmed.lastIndexOf('\\');
  const lastSep = Math.max(lastFwd, lastBack);
  if (lastSep < 0) {
    return '';
  }
  if (lastSep === 0) {
    return trimmed.startsWith('/') ? '/' : trimmed.slice(0, 1);
  }
  return trimmed.slice(0, lastSep);
}

/**
 * Final path segment (file or folder name). Trailing separators are ignored.
 */
export function fileNameFromPath(filePath: string): string {
  let trimmed = String(filePath ?? '').trim();
  if (!trimmed) {
    return '';
  }
  trimmed = trimmed.replace(/[\\/]+$/, '');
  const lastFwd = trimmed.lastIndexOf('/');
  const lastBack = trimmed.lastIndexOf('\\');
  const lastSep = Math.max(lastFwd, lastBack);
  if (lastSep < 0) {
    return trimmed;
  }
  return trimmed.slice(lastSep + 1) || trimmed;
}
