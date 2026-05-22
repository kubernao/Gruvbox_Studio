import { describe, expect, it } from 'vitest';
import { isMissingGitShowFileRevision } from '../../src/frontend/components/DiffViewer/utils/fetchRepoFileRevision';

describe('isMissingGitShowFileRevision', () => {
  it('treats explicit not_found results as missing revisions', () => {
    expect(isMissingGitShowFileRevision({ ok: false, reason: 'not_found' })).toBe(true);
  });

  it('treats git show stderr for branch-only files as missing revisions', () => {
    expect(
      isMissingGitShowFileRevision({
        ok: false,
        error: "fatal: path 'story/chapter_1.md' exists on disk, but not in 'master'",
      }),
    ).toBe(true);
  });

  it('leaves unrelated git errors alone', () => {
    expect(isMissingGitShowFileRevision({ ok: false, error: 'permission denied' })).toBe(false);
  });
});
