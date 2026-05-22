// @vitest-environment jsdom
/**
 * Branch merge save against real git
 * ==================================
 *
 * The unit tests in `branch-merge-save-validation.test.ts` and
 * `branch-merge-save-happy-path.test.ts` exercise `completeBranchMergeSave`
 * with the IPC layer mocked. That guarantees the call sequence and payloads
 * are correct, but it cannot catch bugs that only surface against a real
 * git index — for example: a worktree-remove that does not actually free
 * the branch, a stage call that misses the working tree, or a commit that
 * silently produces an empty merge.
 *
 * This file boots a real on-disk git repository via
 * {@link createBranchMergeFixture} and provides a thin IPC adapter that
 * shells out to the real `git` binary for every `git-*` command. The
 * production code under test is unchanged.
 *
 *   E7  — Happy path: merge succeeds, file matches resolved content,
 *         source branch deleted, worktree removed, repo on target branch.
 *   E8  — Dirty tree rejection (matches `dirty_tree` reason).
 *   E9  — Missing source branch rejection (matches `source_ref_missing`).
 *   E10 — Operation-in-progress rejection (matches `op_in_progress`).
 *   E11 — Identical source/target rejected up front.
 *   E12 — Dual-AI: alternate source branch is deleted alongside the primary.
 *   E13 — Worktree-remove failure is non-fatal; merge still completes.
 *
 * Tests are skipped on systems without git installed (rare in CI but
 * possible locally) so they never produce a misleading red.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { completeBranchMergeSave } from '../../src/frontend/components/DiffViewer/utils/branchMergeSave';
import {
  createBranchMergeFixture,
  type BranchMergeFixture,
} from '../e2e/helpers/gitFixture';

/**
 * Detects whether `git` is available. The real-git suite is meaningless
 * without it, so we skip rather than fail.
 */
function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const GIT_AVAILABLE = gitAvailable();

/**
 * Captures stdout of a git invocation. Used by the IPC adapter to translate
 * git-* commands into structured payloads matching what the production
 * `git-provider` IPC handler returns.
 */
function gitOut(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).toString();
}

/**
 * Wraps a git invocation that may legitimately fail (e.g. a status check).
 * Returns the stdout on success and the error message on failure so the
 * adapter can mirror IPC's `{ error: string }` shape.
 */
function gitTry(cwd: string, args: string[]): { ok: true; stdout: string } | { ok: false; error: string } {
  try {
    return { ok: true, stdout: gitOut(cwd, args) };
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; message?: string };
    const msg = e.stderr?.toString().trim() || e.message || 'git failed';
    return { ok: false, error: msg };
  }
}

/**
 * Real-git IPC adapter. Translates the production `git-provider` IPC
 * channel into actual git invocations. Implements only the subset of
 * commands `completeBranchMergeSave` and `writeRepoRelativeFile` use.
 *
 * Returning shape mirrors the production handler — success cases are
 * objects with the relevant field (`exists`, `paths`, `merge`...) and
 * failures are `{ error: string }`.
 */
function buildIpcAdapter() {
  return async (channel: string, payload: any) => {
    if (channel !== 'git-provider') {
      throw new Error(`Unhandled IPC channel ${channel} in real-git adapter`);
    }
    const { command, repoPath } = payload as { command: string; repoPath: string };

    switch (command) {
      case 'git-current-op-state': {
        const gitDir = path.join(repoPath, '.git');
        return {
          merge: existsSync(path.join(gitDir, 'MERGE_HEAD')),
          rebase:
            existsSync(path.join(gitDir, 'rebase-merge')) ||
            existsSync(path.join(gitDir, 'rebase-apply')),
          cherryPick: existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD')),
          revert: existsSync(path.join(gitDir, 'REVERT_HEAD')),
          bisect: existsSync(path.join(gitDir, 'BISECT_LOG')),
        };
      }

      case 'git-ref-exists': {
        const refName = String((payload as any).refName ?? '');
        const r = gitTry(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${refName}`]);
        return { exists: r.ok };
      }

      case 'git-status': {
        const r = gitTry(repoPath, ['status', '--porcelain=v1']);
        if (!r.ok) return { error: r.error };
        return r.stdout.split('\n').filter((line) => line.length > 0);
      }

      case 'git-switch-branch': {
        const branchName = String((payload as any).branchName ?? '');
        const r = gitTry(repoPath, ['switch', branchName]);
        return r.ok ? {} : { error: r.error };
      }

      case 'git-merge-no-commit': {
        const branchName = String((payload as any).branchName ?? '');
        const r = gitTry(repoPath, ['merge', '--no-commit', '--no-ff', branchName]);
        return r.ok ? {} : { error: r.error };
      }

      case 'git-merge-abort': {
        const r = gitTry(repoPath, ['merge', '--abort']);
        return r.ok ? {} : { error: r.error };
      }

      case 'git-unmerged-paths': {
        const r = gitTry(repoPath, ['diff', '--name-only', '--diff-filter=U']);
        if (!r.ok) return { error: r.error };
        return { paths: r.stdout.split('\n').filter((line) => line.length > 0) };
      }

      case 'write-file': {
        const rel = String((payload as any).relativeFilePath ?? '');
        const content = String((payload as any).content ?? '');
        if (!rel || rel.startsWith('/') || rel.includes('..')) {
          return { error: 'Unsafe relative path' };
        }
        writeFileSync(path.join(repoPath, rel), content, 'utf8');
        return {};
      }

      case 'git-add-path': {
        const rel = String((payload as any).relativeFilePath ?? '');
        const r = gitTry(repoPath, ['add', '--', rel]);
        return r.ok ? {} : { error: r.error };
      }

      case 'git-commit-merge': {
        const r = gitTry(repoPath, ['commit', '--no-edit']);
        return r.ok ? {} : { error: r.error };
      }

      case 'git-worktree-remove': {
        const wt = String((payload as any).worktreePath ?? '');
        const force = Boolean((payload as any).force);
        const args = ['worktree', 'remove'];
        if (force) args.push('--force');
        args.push(wt);
        const r = gitTry(repoPath, args);
        return r.ok ? {} : { error: r.error };
      }

      case 'git-branch-delete': {
        const branchName = String((payload as any).branchName ?? '');
        const r = gitTry(repoPath, ['branch', '-D', branchName]);
        return r.ok ? {} : { error: r.error };
      }

      default:
        return { error: `Unknown command ${command}` };
    }
  };
}

/**
 * Sets up `window.electronAPI` so the production `completeBranchMergeSave`
 * function can invoke our adapter. Reset between tests to avoid bleed.
 */
function installElectronShim() {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).electronAPI = {
    invoke: buildIpcAdapter(),
    getPlatform: () => process.platform,
  };
}

describe.skipIf(!GIT_AVAILABLE)('completeBranchMergeSave against real git', () => {
  let fixture: BranchMergeFixture;

  beforeEach(() => {
    installElectronShim();
  });

  afterEach(() => {
    fixture?.cleanup();
  });

  /**
   * E7 — Happy path. After save, the file contains the resolved content
   * we passed in, the source branch is gone, the worktree is gone, and the
   * working tree is on the target branch. This is the load-bearing case
   * the entire feature exists to support.
   */
  it('E7 — happy path: merges, deletes source branch, removes worktree, leaves repo on target', async () => {
    fixture = createBranchMergeFixture();

    const resolvedContent = 'line1\nline2\nline3-resolved-by-user\n';

    const result = await completeBranchMergeSave({
      repoPath: fixture.repoPath,
      relativeFilePath: fixture.relativeFilePath,
      targetBranch: fixture.targetBranch,
      sourceBranch: fixture.sourceBranch,
      content: resolvedContent,
      aiWorktreePath: fixture.aiWorktreePath ?? undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.branchDeleteWarning).toBeUndefined();

    // File on disk holds the user's resolved content
    const fileContent = readFileSync(
      path.join(fixture.repoPath, fixture.relativeFilePath),
      'utf8',
    );
    expect(fileContent).toBe(resolvedContent);

    // Source branch deleted
    const branches = gitOut(fixture.repoPath, ['branch']).split('\n');
    expect(branches.some((b) => b.includes(fixture.sourceBranch))).toBe(false);

    // Worktree no longer registered
    const wts = gitOut(fixture.repoPath, ['worktree', 'list']);
    expect(wts.includes(fixture.aiWorktreePath ?? '__never__')).toBe(false);

    // HEAD is on target branch
    const head = gitOut(fixture.repoPath, ['symbolic-ref', '--short', 'HEAD']).trim();
    expect(head).toBe(fixture.targetBranch);
  });

  /**
   * E8 — Dirty tree blocks merge. The fixture leaves an unstaged edit
   * after setup so `git status` returns non-empty entries.
   */
  it('E8 — refuses to merge when working tree is dirty', async () => {
    fixture = createBranchMergeFixture({ leaveDirtyTree: true });

    const result = await completeBranchMergeSave({
      repoPath: fixture.repoPath,
      relativeFilePath: fixture.relativeFilePath,
      targetBranch: fixture.targetBranch,
      sourceBranch: fixture.sourceBranch,
      content: 'whatever\n',
      aiWorktreePath: fixture.aiWorktreePath ?? undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('dirty_tree');
  });

  /**
   * E9 — Missing source branch is reported with the right reason. The
   * fixture deletes the branch (and its worktree) after setup.
   */
  it('E9 — refuses to merge when source branch no longer exists', async () => {
    fixture = createBranchMergeFixture({ deleteSourceBranchAfterSetup: true });

    const result = await completeBranchMergeSave({
      repoPath: fixture.repoPath,
      relativeFilePath: fixture.relativeFilePath,
      targetBranch: fixture.targetBranch,
      sourceBranch: fixture.sourceBranch,
      content: 'whatever\n',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('source_ref_missing');
  });

  /**
   * E10 — Operation in progress is reported with the right reason. The
   * fixture starts a merge --no-commit so .git/MERGE_HEAD exists.
   */
  it('E10 — refuses to merge when another git operation is in progress', async () => {
    fixture = createBranchMergeFixture({ leaveOperationInProgress: true });

    const result = await completeBranchMergeSave({
      repoPath: fixture.repoPath,
      relativeFilePath: fixture.relativeFilePath,
      targetBranch: fixture.targetBranch,
      sourceBranch: fixture.sourceBranch,
      content: 'whatever\n',
      aiWorktreePath: fixture.aiWorktreePath ?? undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('op_in_progress');
  });

  /**
   * E11 — Identical source and target branches are caught by input
   * validation before any IPC fires. Verifies real-git path agrees with
   * the unit-test contract.
   */
  it('E11 — rejects identical source and target branches before any git call', async () => {
    fixture = createBranchMergeFixture();

    const result = await completeBranchMergeSave({
      repoPath: fixture.repoPath,
      relativeFilePath: fixture.relativeFilePath,
      targetBranch: fixture.targetBranch,
      sourceBranch: fixture.targetBranch, // identical
      content: 'whatever\n',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_input');
  });

  /**
   * E12 — Dual-AI flow. The fixture has two source branches; the merge
   * uses one, then `completeBranchMergeSave` should also delete the
   * alternate via `alternateSourceBranch`.
   */
  it('E12 — deletes alternate source branch after dual-AI merge', async () => {
    fixture = createBranchMergeFixture({ withAlternateSourceBranch: true });

    const result = await completeBranchMergeSave({
      repoPath: fixture.repoPath,
      relativeFilePath: fixture.relativeFilePath,
      targetBranch: fixture.targetBranch,
      sourceBranch: fixture.sourceBranch,
      alternateSourceBranch: fixture.alternateSourceBranch ?? undefined,
      content: 'line1\nline2\nline3-merged\n',
      aiWorktreePath: fixture.aiWorktreePath ?? undefined,
      aiWorktreePathB: fixture.alternateAiWorktreePath ?? undefined,
    });

    expect(result.ok).toBe(true);

    const branches = gitOut(fixture.repoPath, ['branch']).split('\n');
    expect(branches.some((b) => b.includes(fixture.sourceBranch))).toBe(false);
    expect(branches.some((b) => b.includes(fixture.alternateSourceBranch!))).toBe(false);
  });

  /**
   * E13 — Worktree remove failure is non-fatal. We force this case by
   * passing a non-existent worktree path. The merge should still complete
   * and the source branch should be deleted; the warning is in the
   * `branchDeleteWarning` field only when *branch* delete fails.
   * Worktree-remove failure is logged but does not affect the result.
   */
  it('E13 — non-existent worktree path is logged but does not fail the merge', async () => {
    fixture = createBranchMergeFixture({ skipAiWorktree: true });

    const result = await completeBranchMergeSave({
      repoPath: fixture.repoPath,
      relativeFilePath: fixture.relativeFilePath,
      targetBranch: fixture.targetBranch,
      sourceBranch: fixture.sourceBranch,
      content: 'line1\nline2\nline3-merged\n',
      aiWorktreePath: '/tmp/nonexistent-worktree-zzzqqq',
    });

    expect(result.ok).toBe(true);
    // The source branch should still be deleted because that path runs
    // independent of the worktree-remove outcome.
    const branches = gitOut(fixture.repoPath, ['branch']).split('\n');
    expect(branches.some((b) => b.includes(fixture.sourceBranch))).toBe(false);
  });
});
