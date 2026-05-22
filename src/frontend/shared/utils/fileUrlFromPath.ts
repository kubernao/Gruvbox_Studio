/**
 * Builds a `file://` URL from an absolute OS path without importing Node's `url` module. Electron's
 * webpack renderer bundle does not ship Node core polyfills by default; using `pathToFileURL` from
 * `url` breaks production builds. This helper mirrors the common `file:///C:/...` (Windows) and
 * `file:///home/...` (POSIX) shapes well enough for local media playback via `HTMLAudioElement`.
 */

/**
 * Converts a local absolute path into a `file://` URL string suitable for `Audio`/`src` in Electron.
 *
 * @param absPath - Absolute path as returned from the main process or joined in the renderer.
 */
export function filePathToFileUrlForMedia(absPath: string): string {
  let p = absPath.replace(/\\/g, '/').trim();
  if (p === '') {
    return 'file:///';
  }
  if (/^[A-Za-z]:/.test(p)) {
    p = `/${p}`;
  } else if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  return encodeURI(`file://${p}`);
}
