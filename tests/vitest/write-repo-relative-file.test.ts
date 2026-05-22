// @vitest-environment jsdom
/**
 * Repo-relative file writer contracts
 * ===================================
 *
 * `writeRepoRelativeFile` is the renderer-side helper that the diff merge save
 * flow uses to overwrite the working-tree file with the user-resolved content.
 * It runs inside the Electron renderer where the entire git CLI is reachable
 * via IPC, so any path-traversal flaw or broken fallback path translates into
 * an arbitrary-write primitive.
 *
 * Coverage rows:
 *   U15 — happy path uses the `git-provider write-file` IPC and returns ok
 *   U16 — non-"unknown command" IPC errors are surfaced verbatim, no fallback
 *   U17 — "Unknown command" IPC error triggers the writeFile fallback
 *   U18 — fallback rejects path traversal (`..`), absolute paths, and empties
 *   U19 — fallback also rejects when `electronAPI.writeFile` is absent
 *
 * The path containment behaviour of {@link resolveSafeRepoFileAbs} is exercised
 * directly so a refactor that loosens the rules (e.g. accepts symlinks or
 * tolerates Windows drive prefixes) cannot ship without touching this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveSafeRepoFileAbs,
  writeRepoRelativeFile,
} from '../../src/frontend/components/DiffViewer/utils/writeRepoRelativeFile';

afterEach(() => {
  delete (window as any).electronAPI;
  vi.restoreAllMocks();
});

describe('writeRepoRelativeFile happy path', () => {
  /**
   * U15 — Successful primary path. The IPC handler returns `{ ok: true }` (or
   * any object without an `error` field) and the helper must report success
   * without touching the fallback path. The exact payload shape is asserted so
   * a refactor that drops `relativeFilePath` cannot regress the contract.
   */
  it('invokes git-provider write-file and returns ok on success', async () => {
    const writeFileFallback = vi.fn();
    const invoke = vi.fn(async (_channel: string, args: { command: string }) => {
      expect(args).toMatchObject({
        command: 'write-file',
        repoPath: '/repo',
        relativeFilePath: 'src/a.ts',
        content: 'hello',
      });
      return { ok: true };
    });
    (window as any).electronAPI = { invoke, writeFile: writeFileFallback };

    const result = await writeRepoRelativeFile('/repo', 'src/a.ts', 'hello');

    expect(result).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(writeFileFallback).not.toHaveBeenCalled();
  });
});

describe('writeRepoRelativeFile error surfacing', () => {
  /**
   * U16 — Non-"Unknown command" IPC errors are surfaced verbatim. We must NOT
   * fall back to `electronAPI.writeFile` for these — the main process already
   * reasoned about the path and refused, so trying again with the renderer's
   * looser path resolution would let the request slip past containment.
   */
  it('returns the IPC error without fallback for genuine failures', async () => {
    const writeFileFallback = vi.fn();
    const invoke = vi.fn(async () => ({ error: 'Path traversal denied' }));
    (window as any).electronAPI = { invoke, writeFile: writeFileFallback };

    const result = await writeRepoRelativeFile('/repo', 'src/a.ts', 'hello');

    expect(result).toEqual({ ok: false, error: 'Path traversal denied' });
    expect(writeFileFallback).not.toHaveBeenCalled();
  });

  /**
   * U17 — "Unknown command" IPC error triggers the fallback. This case is hit
   * after a hot-reload of the main process where the renderer keeps an old
   * session but the IPC table has shifted. The fallback uses
   * {@link resolveSafeRepoFileAbs} to convert the relative path before calling
   * `electronAPI.writeFile`. The test asserts the absolute path is built from
   * `repoPath` so the fallback cannot accidentally write outside the repo.
   */
  it('falls back to electronAPI.writeFile when the IPC reports an unknown command', async () => {
    const writeFileFallback = vi.fn(async () => undefined);
    const invoke = vi.fn(async () => ({ error: 'Unknown command: write-file' }));
    (window as any).electronAPI = { invoke, writeFile: writeFileFallback };

    const result = await writeRepoRelativeFile('/repo', 'src/a.ts', 'hello');

    expect(result).toEqual({ ok: true });
    expect(writeFileFallback).toHaveBeenCalledTimes(1);
    const [absPath, content] = writeFileFallback.mock.calls[0] as [string, string];
    expect(absPath).toBe('/repo/src/a.ts');
    expect(content).toBe('hello');
  });

  /**
   * U19 — Even when the IPC reports "Unknown command", we must NOT silently
   * succeed if the renderer has no `writeFile` API at all. This is the case
   * during the very first launch of an outdated installer; the user needs an
   * actionable error message that asks them to restart.
   */
  it('returns a clear error when fallback writeFile is unavailable', async () => {
    const invoke = vi.fn(async () => ({ error: 'Unknown command: write-file' }));
    (window as any).electronAPI = { invoke };

    const result = await writeRepoRelativeFile('/repo', 'src/a.ts', 'hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/restart the app/i);
      expect(result.error).toContain('Unknown command');
    }
  });
});

describe('resolveSafeRepoFileAbs containment rules', () => {
  /**
   * U18a — Absolute paths must be rejected so the helper can never escape
   * `repoPath`. Both POSIX and Windows shapes are covered.
   */
  it('rejects POSIX absolute paths', () => {
    expect(resolveSafeRepoFileAbs('/repo', '/etc/passwd')).toBeNull();
  });

  /**
   * FAIL-EXPECTED (tracked in docs/merge-editor-test-findings.md).
   *
   * The renderer-side path module defaults to POSIX in non-Electron tests, so
   * `path.posix.isAbsolute('C:/Windows/System32')` returns false and the input
   * is resolved as a sub-path of the repo (e.g. `/repo/C:/Windows/System32`).
   * On a real Windows client the bundled `path.win32` would catch it, but the
   * renderer should treat any drive-letter prefix as absolute regardless of
   * the platform module so cross-platform IPC payloads stay safe.
   */
  it.fails('rejects Windows-style absolute paths even under POSIX-mode renderer', () => {
    expect(resolveSafeRepoFileAbs('/repo', 'C:\\Windows\\System32')).toBeNull();
  });

  /**
   * U18b — Path traversal segments are rejected even when the resolved path
   * happens to land inside `repoPath`. We refuse `..` outright rather than
   * trying to sanitise it: a resolver that normalises `src/../etc/passwd` to
   * `etc/passwd` could still escape under a different working directory.
   */
  it('rejects paths containing parent-directory traversal segments', () => {
    expect(resolveSafeRepoFileAbs('/repo', '../outside.txt')).toBeNull();
    expect(resolveSafeRepoFileAbs('/repo', 'src/../../outside.txt')).toBeNull();
    expect(resolveSafeRepoFileAbs('/repo', './..')).toBeNull();
  });

  /**
   * U18c — Empty / whitespace-only / null-ish paths are rejected. Without this
   * guard the resolver would happily compute the repo root itself as the
   * target and overwrite the entire working tree.
   */
  it('rejects empty or whitespace-only paths', () => {
    expect(resolveSafeRepoFileAbs('/repo', '')).toBeNull();
    expect(resolveSafeRepoFileAbs('/repo', '   ')).toBeNull();
  });

  /**
   * Returning the strip-leading-`./` and strip-leading-`@` behaviours under
   * test so a refactor cannot silently break the Pi tool's `@cwd-relative`
   * file convention.
   */
  it('strips leading ./ and Pi @cwd-relative prefix and returns the resolved absolute path', () => {
    expect(resolveSafeRepoFileAbs('/repo', './src/a.ts')).toBe('/repo/src/a.ts');
    expect(resolveSafeRepoFileAbs('/repo', '@src/a.ts')).toBe('/repo/src/a.ts');
    expect(resolveSafeRepoFileAbs('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
  });

  /**
   * Backslashes are normalised to forward slashes before resolution so the
   * accept flow works on Windows clients that supply mixed-separator paths.
   * The result is still POSIX-shaped because the renderer-side path module
   * defaults to POSIX semantics in tests.
   */
  it('normalises backslashes to forward slashes', () => {
    expect(resolveSafeRepoFileAbs('/repo', 'src\\nested\\a.ts')).toBe('/repo/src/nested/a.ts');
  });
});

describe('writeRepoRelativeFile traversal rejection (renderer fallback)', () => {
  /**
   * U18 — When the IPC reports "Unknown command" and the renderer falls back,
   * `resolveSafeRepoFileAbs` is the last line of defence. A path that fails
   * containment must abort the write and surface the original IPC error.
   */
  beforeEach(() => {
    (window as any).electronAPI = {
      invoke: vi.fn(async () => ({ error: 'Unknown command: write-file' })),
      writeFile: vi.fn(),
    };
  });

  it('does not invoke writeFile when the relative path traverses out of the repo', async () => {
    const result = await writeRepoRelativeFile('/repo', '../outside.txt', 'oops');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown command');
    }
    expect(((window as any).electronAPI.writeFile as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('does not invoke writeFile when the relative path is absolute', async () => {
    const result = await writeRepoRelativeFile('/repo', '/etc/passwd', 'oops');

    expect(result.ok).toBe(false);
    expect(((window as any).electronAPI.writeFile as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
