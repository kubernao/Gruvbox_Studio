import { describe, expect, it } from 'vitest';
import {
  chooseMergeOpenPath,
  isRepoRelativePath,
} from '../../src/frontend/features/assistant/utils/mergeOpenPath';

/**
 * Regression coverage for assistant merge-open path selection.
 *
 * These tests lock the behavior that prevents merge UI regressions where
 * primary hydration is empty but changed files exist. The fallback must choose
 * a valid repo-relative changed path so AI edits still open in DiffViewer.
 */
describe('assistant merge-open path selection', () => {
  /**
   * The repo-relative predicate rejects absolute and empty candidates so callers
   * cannot pass invalid paths into DiffViewer.
   */
  it('validates repo-relative file paths', () => {
    expect(isRepoRelativePath('src/app.ts')).toBe(true);
    expect(isRepoRelativePath('docs/readme.md')).toBe(true);
    expect(isRepoRelativePath('drone')).toBe(false);
    expect(isRepoRelativePath('.git/config')).toBe(false);
    expect(isRepoRelativePath('.gruvbox/memory/project-memory.json')).toBe(false);
    expect(isRepoRelativePath('')).toBe(false);
    expect(isRepoRelativePath('   ')).toBe(false);
    expect(isRepoRelativePath('/abs/path.ts')).toBe(false);
    expect(isRepoRelativePath('C:\\abs\\path.ts')).toBe(false);
  });

  /**
   * Primary hydrated path always wins when valid.
   */
  it('prefers a valid primary path', () => {
    expect(chooseMergeOpenPath('src/main.ts', ['docs/readme.md'])).toBe('src/main.ts');
  });

  /**
   * If primary is missing/invalid, the first valid changed path is selected.
   */
  it('falls back to first valid changed path when primary is empty', () => {
    expect(chooseMergeOpenPath('', ['', '/tmp/nope.ts', 'docs/guide.md', 'src/next.ts'])).toBe('docs/guide.md');
  });

  /**
   * No actionable candidates means caller must skip merge open.
   */
  it('returns empty when no valid path exists', () => {
    expect(chooseMergeOpenPath('', ['', '   ', '/abs/path.ts', '.gruvbox/memory/project-memory.json'])).toBe('');
  });

  /**
   * A stale primary path should not be trusted when it no longer exists in the
   * changed-path payload; the resolver must pick the next authoritative path.
   */
  it('ignores stale primary path not present in changed list', () => {
    expect(
      chooseMergeOpenPath(
        'docs/stale.md',
        ['notes/chapter.md', 'src/next.ts'],
        ['notes/chapter.md'],
      ),
    ).toBe('notes/chapter.md');
  });

  /**
   * Preferred tool-touched files should win when they are valid and also
   * present in the changed-path set returned by status hydration.
   */
  it('prefers tool-touched path over changed-path order when available', () => {
    expect(
      chooseMergeOpenPath(
        '',
        ['docs/readme.md', 'notes/chapter.md'],
        ['notes/chapter.md', 'src/other.ts'],
      ),
    ).toBe('notes/chapter.md');
  });
});

