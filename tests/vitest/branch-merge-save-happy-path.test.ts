// @vitest-environment jsdom
/**
 * Branch merge save — happy-path sequencing
 * =========================================
 *
 * The pre-existing {@link ./branch-merge-save.test.ts} suite covers individual
 * failure reasons, but no test asserts the full successful sequence end-to-end.
 * That gap matters because the order of git invocations is part of the
 * contract: switching to the target branch BEFORE the merge command,
 * `git add` AFTER the resolved file is written, and the worktree removal
 * happening AFTER the merge commit are all preconditions for the AI worktree
 * cleanup step to run without "branch is checked out elsewhere" errors.
 *
 *   U10 — happy path with no AI worktree records the canonical 9-step ordering
 *   U11 — passing `aiWorktreePath` adds a worktree-remove call AFTER the commit
 *   U12 — passing `aiWorktreePathB` removes both worktrees in order
 *   U13 — passing `alternateSourceBranch` deletes the secondary AI branch
 *   U14 — alternateSourceBranch equal to sourceBranch is treated as absent
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeBranchMergeSave } from '../../src/frontend/components/DiffViewer/utils/branchMergeSave';

/**
 * Builds a fake git-provider IPC handler that records every command in order
 * and returns a canned successful response for each step. Tests can override
 * specific commands by replacing entries in the optional `overrides` map.
 */
function buildHappyPathInvoker(overrides: Record<string, () => unknown> = {}) {
  const calls: Array<{ command: string; payload: Record<string, unknown> }> = [];
  const defaults: Record<string, () => unknown> = {
    'git-current-op-state': () => ({
      merge: false, rebase: false, cherryPick: false, revert: false, bisect: false,
    }),
    'git-ref-exists': () => ({ ok: true, exists: true }),
    'git-status': () => [],
    'git-branch-list': () => ({ branches: [{ name: 'feature/current', isCurrent: true }, { name: 'main', isCurrent: false }] }),
    'git-switch-branch': () => ({ ok: true }),
    'git-merge-no-commit': () => ({ ok: true }),
    'git-unmerged-paths': () => ({ paths: [] }),
    'write-file': () => ({ ok: true }),
    'git-add-path': () => ({ ok: true }),
    'git-commit-merge': () => ({ ok: true }),
    'git-commit-staged': () => ({ ok: true }),
    'git-worktree-remove': () => ({ ok: true }),
    'git-branch-delete': () => ({ ok: true }),
  };
  const handlers = { ...defaults, ...overrides };
  const invoke = vi.fn(async (_channel: string, args: { command: string } & Record<string, unknown>) => {
    const { command, ...payload } = args;
    calls.push({ command, payload });
    const handler = handlers[command];
    if (handler === undefined) {
      return { ok: true };
    }
    return handler();
  });
  return { invoke, calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('completeBranchMergeSave happy path', () => {
  /**
   * U10 — Canonical sequence with no AI worktree.
   *
   * The test asserts the exact order of git commands. This is intentional:
   * if a future refactor reorders `git-add-path` before `write-file`, the
   * resolved content will not be staged and the merge commit will revert to
   * the conflict markers.
   */
  it('records the canonical 9-step git sequence and returns ok', async () => {
    const { invoke, calls } = buildHappyPathInvoker();
    (window as any).electronAPI = { invoke };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/fix-auth',
      content: 'resolved-content',
    });

    expect(result.ok).toBe(true);
    expect(result.statusMessage).toBe('Branch merge completed.');
    expect(result.branchDeleteWarning).toBeUndefined();

    const ordering = calls.map((c) => c.command);
    expect(ordering).toEqual([
      'git-current-op-state',
      'git-ref-exists',
      'git-status',
      'git-branch-list',
      'git-switch-branch',
      'git-merge-no-commit',
      'git-unmerged-paths',
      'write-file',
      'git-add-path',
      'git-unmerged-paths',
      'git-commit-merge',
      'git-branch-delete',
    ]);

    // Spot-check the most critical payloads. A regression that switches to the
    // wrong branch or merges the target into the source instead of vice-versa
    // would silently rewrite history.
    const switchCall = calls.find((c) => c.command === 'git-switch-branch');
    expect(switchCall?.payload.branchName).toBe('main');

    const mergeCall = calls.find((c) => c.command === 'git-merge-no-commit');
    expect(mergeCall?.payload.branchName).toBe('ai/fix-auth');

    const writeCall = calls.find((c) => c.command === 'write-file');
    expect(writeCall?.payload.relativeFilePath).toBe('src/a.ts');
    expect(writeCall?.payload.content).toBe('resolved-content');

    const addCall = calls.find((c) => c.command === 'git-add-path');
    expect(addCall?.payload.relativeFilePath).toBe('src/a.ts');

    const deleteCall = calls.find((c) => c.command === 'git-branch-delete');
    expect(deleteCall?.payload.branchName).toBe('ai/fix-auth');
    expect(deleteCall?.payload.force).toBe(false);
  });

  it('force-deletes ai/pi proposal branches after multi-file queue finalize', async () => {
    const { invoke, calls } = buildHappyPathInvoker({
      'git-status': () => [{ status: 'M', file: 'src/a.ts' }],
    });
    (window as any).electronAPI = { invoke };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/pi/w1/master/1779415240957',
      content: 'resolved-content',
      allowDirtyFromMergeQueue: true,
    });

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.command)).not.toContain('git-merge-no-commit');

    const deleteCall = calls.find((c) => c.command === 'git-branch-delete');
    expect(deleteCall?.payload.branchName).toBe('ai/pi/w1/master/1779415240957');
    expect(deleteCall?.payload.force).toBe(true);
  });

  /**
   * U11 — `aiWorktreePath` triggers a `git-worktree-remove` AFTER the merge
   * commit but BEFORE the source branch delete. Reversing this order would
   * cause "branch is checked out elsewhere" errors.
   */
  it('removes the AI worktree between commit and branch delete when provided', async () => {
    const { invoke, calls } = buildHappyPathInvoker();
    (window as any).electronAPI = { invoke };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/fix-auth',
      content: 'merged',
      aiWorktreePath: '/repo/.wt/ai-fix-auth',
    });

    expect(result.ok).toBe(true);

    const ordering = calls.map((c) => c.command);
    const commitIdx = ordering.indexOf('git-commit-merge');
    const removeIdx = ordering.indexOf('git-worktree-remove');
    const deleteIdx = ordering.indexOf('git-branch-delete');

    expect(commitIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(commitIdx);
    expect(deleteIdx).toBeGreaterThan(removeIdx);

    const removeCall = calls.find((c) => c.command === 'git-worktree-remove');
    expect(removeCall?.payload.worktreePath).toBe('/repo/.wt/ai-fix-auth');
    expect(removeCall?.payload.force).toBe(true);
  });

  /**
   * U12 — Dual-AI flows pass two worktree paths. Both must be removed, in the
   * order they were supplied, before the source branch delete runs.
   */
  it('removes both AI worktrees when aiWorktreePathB is also supplied', async () => {
    const { invoke, calls } = buildHappyPathInvoker();
    (window as any).electronAPI = { invoke };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/main',
      content: 'merged',
      aiWorktreePath: '/repo/.wt/a',
      aiWorktreePathB: '/repo/.wt/b',
      alternateSourceBranch: 'ai/main/b',
    });

    expect(result.ok).toBe(true);

    const removeCalls = calls.filter((c) => c.command === 'git-worktree-remove');
    expect(removeCalls).toHaveLength(2);
    expect(removeCalls[0].payload.worktreePath).toBe('/repo/.wt/a');
    expect(removeCalls[1].payload.worktreePath).toBe('/repo/.wt/b');

    // Both removes must precede the first branch delete to avoid the
    // "branch checked out elsewhere" failure mode.
    const ordering = calls.map((c) => c.command);
    const lastRemoveIdx = ordering.lastIndexOf('git-worktree-remove');
    const firstDeleteIdx = ordering.indexOf('git-branch-delete');
    expect(firstDeleteIdx).toBeGreaterThan(lastRemoveIdx);
  });

  /**
   * U13 — `alternateSourceBranch` triggers a second branch delete. Both deletes
   * must run, in the order (primary, alternate), so a UI listing reflects the
   * correct cleanup ordering when the second delete fails.
   */
  it('deletes both source and alternate branches in order', async () => {
    const { invoke, calls } = buildHappyPathInvoker();
    (window as any).electronAPI = { invoke };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/main',
      alternateSourceBranch: 'ai/main/b',
      content: 'merged',
    });

    expect(result.ok).toBe(true);

    const deletes = calls.filter((c) => c.command === 'git-branch-delete');
    expect(deletes).toHaveLength(2);
    expect(deletes[0].payload.branchName).toBe('ai/main');
    expect(deletes[1].payload.branchName).toBe('ai/main/b');
  });

  /**
   * U14 — When `alternateSourceBranch` equals `sourceBranch` (or is empty after
   * trimming) only one delete should run. Without this guard the second delete
   * would fail with "branch not found" and the caller would see a spurious
   * `branchDeleteWarning` even though the merge itself succeeded cleanly.
   */
  it('does not delete the alternate branch when it equals the primary source branch', async () => {
    const { invoke, calls } = buildHappyPathInvoker();
    (window as any).electronAPI = { invoke };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/main',
      alternateSourceBranch: 'ai/main',
      content: 'merged',
    });

    expect(result.ok).toBe(true);
    expect(result.branchDeleteWarning).toBeUndefined();

    const deletes = calls.filter((c) => c.command === 'git-branch-delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].payload.branchName).toBe('ai/main');
  });

  /**
   * Regression: a non-fatal worktree-remove failure must NOT abort the rest
   * of the cleanup. The merge already committed, so the user should still get
   * `result.ok === true` and the branch delete should still run. We exercise
   * this here so a future refactor cannot accidentally promote the warning to
   * a fatal failure.
   */
  it('treats worktree removal failures as non-fatal warnings (merge still succeeds)', async () => {
    const { invoke, calls } = buildHappyPathInvoker({
      'git-worktree-remove': () => ({ error: 'worktree busy' }),
    });
    (window as any).electronAPI = { invoke };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/fix-auth',
      content: 'merged',
      aiWorktreePath: '/repo/.wt/ai-fix-auth',
    });

    // Branch delete still runs after the worktree-remove warning.
    expect(result.ok).toBe(true);
    const ordering = calls.map((c) => c.command);
    expect(ordering).toContain('git-branch-delete');
  });
});
