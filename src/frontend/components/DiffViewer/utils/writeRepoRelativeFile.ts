/**
 * Repo-Relative File Writer
 * ==========================
 *
 * Provides a single public function — {@link writeRepoRelativeFile} — that writes
 * a string to a file inside the git working tree.
 *
 * ### IPC strategy and fallback chain
 *
 * Primary path:
 *   `window.electronAPI.invoke('git-provider', { command: 'write-file', ... })`
 *
 * Fallback path (stale main process):
 *   If the main process responds with "Unknown command" (i.e. the app was started
 *   before the `write-file` IPC handler existed), we fall back to
 *   `window.electronAPI.writeFile(absolutePath, content)`.  This prevents the user
 *   from needing to restart the app during active development or after an incremental
 *   update.
 *
 * ### Path safety
 *
 * Both the IPC handler and the fallback resolve the final file path through
 * {@link resolveSafeRepoFileAbs}, which:
 *   1. Rejects absolute paths (must be repo-relative).
 *   2. Strips leading `./` and normalises backslashes to forward slashes.
 *   3. Rejects paths that contain `..` (path traversal guard).
 *   4. Verifies that the resolved absolute path is inside `repoPath` by checking
 *      that `path.relative(repoPath, absTarget)` does not start with `..`.
 *
 * ### Platform path module selection
 *
 * webpack bundles the Node `path` module via `path-browserify`, which always uses
 * POSIX semantics.  On Windows, the main-process uses `path.win32`, so we must also
 * use `path.win32` when constructing absolute paths — otherwise `resolve()` produces
 * paths with mixed separators that do not match what the main process expects.
 * The platform is read once at module load time from `window.electronAPI.getPlatform()`.
 */

import * as path from 'path';

// ---------------------------------------------------------------------------
// Platform-aware path module
// ---------------------------------------------------------------------------

/**
 * The platform string returned by the main process at startup.
 * Used to select the correct `path` variant for constructing absolute paths.
 * Defaults to empty string (→ POSIX) if the bridge is unavailable.
 */
let platformFromBridge = '';
try {
  platformFromBridge =
    typeof window !== 'undefined' && typeof window.electronAPI?.getPlatform === 'function'
      ? window.electronAPI.getPlatform()
      : '';
} catch {
  platformFromBridge = '';
}

/**
 * The `path` implementation appropriate for the current platform.
 * - `path.win32` on Windows, so paths match what the main process produces.
 * - `path.posix` everywhere else.
 */
const pathImpl = platformFromBridge === 'win32' ? path.win32 : path.posix;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extracts the `error` string from a git-provider IPC response object, or null if none. */
function pickGitProviderError(res: unknown): string | null {
  if (res != null && typeof res === 'object' && 'error' in res) {
    return String((res as { error: unknown }).error);
  }
  return null;
}

/**
 * Returns the platform-appropriate `path` implementation with all three required
 * methods (`isAbsolute`, `resolve`, `relative`), or null if none is available.
 *
 * Falls back through `path.posix`, `path.win32`, and the bare `path` export in case
 * the primary `pathImpl` is incomplete (e.g. in JSDOM or minimal test environments
 * that partially polyfill the `path` module).
 */
function getSafePathImpl(): {
  isAbsolute: (p: string) => boolean;
  resolve: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
} | null {
  const hasRequiredMethods = (p: unknown): p is {
    isAbsolute: (p: string) => boolean;
    resolve: (...parts: string[]) => string;
    relative: (from: string, to: string) => string;
  } =>
    p != null &&
    typeof (p as any).isAbsolute === 'function' &&
    typeof (p as any).resolve    === 'function' &&
    typeof (p as any).relative   === 'function';

  if (hasRequiredMethods(pathImpl)) return pathImpl;

  // Try other variants from the bundled path module
  const fallback = (path as any)?.posix ?? (path as any)?.win32 ?? path;
  if (hasRequiredMethods(fallback)) return fallback;

  return null; // no usable path implementation found
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves a repo-relative file path to an absolute path and verifies it is
 * contained within `repoPath`.
 *
 * Returns `null` when the path is invalid, absolute, contains `..`, or would
 * escape the repo root.  This mirrors the safety rules enforced by the main-process
 * `resolveSafeRepoRelativeFile` function.
 *
 * @param repoPath         - Absolute path to the git working tree root.
 * @param relativeFilePath - Repo-relative path to the target file.
 * @returns The absolute path, or null if the path is unsafe.
 */
export function resolveSafeRepoFileAbs(
  repoPath: string,
  relativeFilePath: string,
): string | null {
  const safePath = getSafePathImpl();
  if (!safePath) return null;

  try {
    const raw = typeof relativeFilePath === 'string' ? relativeFilePath.trim() : '';

    // Empty or already-absolute paths are invalid
    if (!raw || safePath.isAbsolute(raw)) return null;

    // Normalise: forward slashes, strip leading ./, strip Pi `@` cwd-relative prefix
    let normalizedRel = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalizedRel.startsWith('@')) {
      normalizedRel = normalizedRel.slice(1).trim();
    }
    if (!normalizedRel) return null;

    // Reject any path that could traverse upward
    if (normalizedRel.includes('..')) return null;

    const absRepo   = safePath.resolve(repoPath);
    const absTarget = safePath.resolve(absRepo, normalizedRel);

    // Confirm the resolved path is still inside the repo root
    const rel = safePath.relative(absRepo, absTarget);
    if (rel.startsWith('..') || safePath.isAbsolute(rel)) return null;

    return absTarget;
  } catch {
    return null; // path.resolve can throw on invalid inputs in some environments
  }
}

/**
 * Writes `content` to a file at `repoPath/relativeFilePath`.
 *
 * Tries the `git-provider write-file` IPC command first.  If the main process
 * returns an "Unknown command" error (stale process that predates the command),
 * it falls back to `window.electronAPI.writeFile` with a resolved absolute path.
 *
 * @param repoPath         - Absolute path to the git working tree root.
 * @param relativeFilePath - Repo-relative path of the file to write.
 *                           Must not be absolute or contain `..`.
 * @param content          - UTF-8 string to write.
 * @returns `{ ok: true }` on success, or `{ ok: false, error: string }` on failure.
 */
export async function writeRepoRelativeFile(
  repoPath: string,
  relativeFilePath: string,
  content: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const invoke = window.electronAPI?.invoke;
  if (!invoke) {
    return { ok: false, error: 'Electron invoke is not available.' };
  }

  const trimmedRepo = repoPath.trim();

  // ---- Primary path: git-provider write-file IPC ----
  const result: unknown = await invoke('git-provider', {
    command: 'write-file',
    repoPath: trimmedRepo,
    relativeFilePath,
    content,
  });

  const err = pickGitProviderError(result);
  if (err === null) {
    return { ok: true }; // success
  }

  // ---- Check whether this is a "command not found" error ----
  // If the main process recognises the command but the write failed, surface the error
  // immediately rather than trying the fallback.
  const isUnknownCommand =
    err.includes('Unknown command') || err.includes('unknown command');

  if (!isUnknownCommand) {
    return { ok: false, error: err };
  }

  // ---- Fallback: direct writeFile via resolved absolute path ----
  // The main process is a version that predates the write-file IPC command.
  // Resolve the absolute path here in the renderer and use the lower-level writeFile API.
  const abs = resolveSafeRepoFileAbs(trimmedRepo, relativeFilePath);
  if (!abs) {
    // Path resolution failed — surface the original IPC error
    return { ok: false, error: err };
  }

  const writeFile = window.electronAPI?.writeFile;
  if (typeof writeFile !== 'function') {
    return {
      ok: false,
      error:
        `${err} (fallback writeFile unavailable; restart the app to load the ` +
        `latest main process).`,
    };
  }

  try {
    await writeFile(abs, content);
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
