// @vitest-environment jsdom
/**
 * Branch merge save — input validation contracts
 * ==============================================
 *
 * `completeBranchMergeSave` is the function the AI diff merge dialog ultimately
 * invokes once the user resolves every hunk and clicks "Save merge". It is the
 * last gate before we mutate `main` (or whichever target branch the user picked),
 * so its input validation must be airtight: any path that lets bad input slip
 * through can corrupt the workspace or, worse, write to the wrong file.
 *
 * The pre-existing {@link ../../tests/vitest/branch-merge-save.test.ts} suite
 * covers IPC-level guards (op-in-progress, source-ref-missing, dirty-tree, and
 * the post-merge branch delete warning). This file fills the validation gaps
 * before any IPC is performed:
 *
 *   U6 — empty repoPath rejected
 *   U7 — empty/blank relativeFilePath rejected
 *   U8 — absolute relativeFilePath rejected (POSIX and Windows shapes)
 *   U9 — same source and target branch rejected
 *
 * Every guard must short-circuit BEFORE `window.electronAPI.invoke` is called.
 * The mock invoker is wired with a `vi.fn` so the test can assert the call count
 * stays at zero — a regression that bypasses validation would touch git.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeBranchMergeSave } from '../../src/frontend/components/DiffViewer/utils/branchMergeSave';

/** Standard happy-input shape used to build valid params and then mutate one field per test. */
function baseParams() {
  return {
    repoPath: '/repo',
    relativeFilePath: 'src/a.ts',
    targetBranch: 'main',
    sourceBranch: 'ai/proposal',
    content: 'merged-content',
  } as const;
}

describe('completeBranchMergeSave input validation', () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    invokeMock = vi.fn();
    (window as any).electronAPI = { invoke: invokeMock };
  });

  /**
   * U6 — Empty `repoPath` must be rejected with `missing_input` and never invoke
   * any IPC. This protects against the AI diff dialog opening for an unloaded
   * project (where the explorer root is null and gets coerced to '').
   */
  it('rejects an empty repoPath with missing_input and never calls IPC', async () => {
    const result = await completeBranchMergeSave({ ...baseParams(), repoPath: '   ' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_input');
    expect(result.retryable).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  /**
   * U7 — Empty `relativeFilePath` must be rejected the same way. This case
   * triggers when a session loses its file path during a tab switch and the
   * caller forgets to bail out before invoking the merge save.
   */
  it('rejects an empty relativeFilePath without invoking git', async () => {
    const result = await completeBranchMergeSave({ ...baseParams(), relativeFilePath: '' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_input');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  /**
   * U8 — An absolute `relativeFilePath` would let the merge save target a file
   * outside the repository root. The validation must reject both POSIX-style
   * (`/etc/passwd`) and Windows-style (`C:\Users\...`) absolutes BEFORE any IPC.
   * The lower-level `resolveSafeRepoFileAbs` enforces a second containment
   * check on the renderer side, but that defence-in-depth check should never be
   * the only barrier.
   */
  it('rejects POSIX absolute relativeFilePath without invoking git', async () => {
    const result = await completeBranchMergeSave({
      ...baseParams(),
      relativeFilePath: '/etc/passwd',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_input');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects Windows-style absolute relativeFilePath without invoking git', async () => {
    const result = await completeBranchMergeSave({
      ...baseParams(),
      relativeFilePath: 'C:\\Users\\pwn\\file.ts',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_input');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  /**
   * U9 — When source and target are the same branch the merge would either be
   * a no-op or produce a confusing "Already up to date" failure. The dialog
   * default is the AI branch on the source side and the user's main branch on
   * the target side, so this also catches a UI state where both selectors
   * collapse onto the same branch (e.g. after a manual rebase).
   */
  it('rejects when source and target branches are identical', async () => {
    const result = await completeBranchMergeSave({
      ...baseParams(),
      sourceBranch: 'main',
      targetBranch: 'main',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_input');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  /**
   * Whitespace-only branch names should be treated as empty. They occur when
   * the merge dialog is opened with stale data and the branch select is
   * uncontrolled.
   */
  it('rejects whitespace-only branch names', async () => {
    const blankSource = await completeBranchMergeSave({
      ...baseParams(),
      sourceBranch: '   ',
    });
    expect(blankSource.ok).toBe(false);
    expect(blankSource.reason).toBe('missing_input');

    const blankTarget = await completeBranchMergeSave({
      ...baseParams(),
      targetBranch: '\t',
    });
    expect(blankTarget.ok).toBe(false);
    expect(blankTarget.reason).toBe('missing_input');

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
