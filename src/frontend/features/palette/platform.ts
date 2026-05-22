/**
 * Renderer bundles often omit `process`; use preload `getPlatform()` when available.
 */
let cachedPlatform: string | null = null;

export function getRendererPlatform(): string {
  if (cachedPlatform !== null) {
    return cachedPlatform;
  }
  if (typeof window !== 'undefined' && typeof window.electronAPI?.getPlatform === 'function') {
    try {
      const p = window.electronAPI.getPlatform();
      if (typeof p === 'string' && p !== '') {
        cachedPlatform = p;
        return cachedPlatform;
      }
    } catch {
      /* ignore */
    }
  }
  if (typeof process !== 'undefined' && typeof process.platform === 'string') {
    cachedPlatform = process.platform;
    return cachedPlatform;
  }
  cachedPlatform = 'win32';
  return cachedPlatform;
}

export function isDarwin(): boolean {
  return getRendererPlatform() === 'darwin';
}

export function isWin32(): boolean {
  return getRendererPlatform() === 'win32';
}
