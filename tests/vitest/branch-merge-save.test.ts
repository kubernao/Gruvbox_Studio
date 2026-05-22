// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeBranchMergeSave } from '../../src/frontend/components/DiffViewer/utils/branchMergeSave';

describe('completeBranchMergeSave reliability guardrails', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fails with source_ref_missing when AI source ref no longer exists', async () => {
    (window as any).electronAPI = {
      invoke: vi.fn(async (_channel: string, args: { command: string }) => {
        if (args.command === 'git-current-op-state') {
          return { merge: false, rebase: false, cherryPick: false, revert: false, bisect: false };
        }
        if (args.command === 'git-ref-exists') {
          return { ok: true, exists: false };
        }
        return { ok: true };
      }),
    };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/stale',
      content: 'merged',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('source_ref_missing');
    expect(result.statusMessage).toContain('no longer exists');
  });

  it('fails with op_in_progress when another git operation is active', async () => {
    (window as any).electronAPI = {
      invoke: vi.fn(async (_channel: string, args: { command: string }) => {
        if (args.command === 'git-current-op-state') {
          return { merge: true, rebase: false, cherryPick: false, revert: false, bisect: false };
        }
        return { ok: true };
      }),
    };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/fresh',
      content: 'merged',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('op_in_progress');
  });

  it('fails with dirty_tree when workspace is not clean', async () => {
    (window as any).electronAPI = {
      invoke: vi.fn(async (_channel: string, args: { command: string }) => {
        if (args.command === 'git-current-op-state') {
          return { merge: false, rebase: false, cherryPick: false, revert: false, bisect: false };
        }
        if (args.command === 'git-ref-exists') {
          return { ok: true, exists: true };
        }
        if (args.command === 'git-status') {
          return [{ status: 'M', file: 'src/x.ts' }];
        }
        return { ok: true };
      }),
    };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/fresh',
      content: 'merged',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('dirty_tree');
  });

  it('returns success with warning when branch cleanup fails after commit', async () => {
    (window as any).electronAPI = {
      invoke: vi.fn(async (_channel: string, args: { command: string }) => {
        switch (args.command) {
          case 'git-current-op-state':
            return { merge: false, rebase: false, cherryPick: false, revert: false, bisect: false };
          case 'git-ref-exists':
            return { ok: true, exists: true };
          case 'git-status':
            return [];
          case 'git-branch-list':
            return { branches: [{ name: 'feature/current', isCurrent: true }, { name: 'main', isCurrent: false }] };
          case 'git-switch-branch':
          case 'git-merge-no-commit':
          case 'write-file':
          case 'git-add-path':
          case 'git-commit-merge':
            return { ok: true };
          case 'git-unmerged-paths':
            return { paths: [] };
          case 'git-worktree-remove':
            return { ok: true };
          case 'git-branch-delete':
            return { error: 'branch is protected' };
          default:
            return { ok: true };
        }
      }),
    };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/fresh',
      content: 'merged',
      aiWorktreePath: '/repo/.wt/ai-fresh',
    });

    expect(result.ok).toBe(true);
    expect(result.branchDeleteWarning).toContain('could not be deleted');
  });

  it('restores the original branch when merge-no-commit fails after switch', async () => {
    const invoke = vi.fn(async (_channel: string, args: { command: string; branchName?: string }) => {
      switch (args.command) {
        case 'git-current-op-state':
          return { merge: false, rebase: false, cherryPick: false, revert: false, bisect: false };
        case 'git-ref-exists':
          return { ok: true, exists: true };
        case 'git-status':
          return [];
        case 'git-branch-list':
          return { branches: [{ name: 'feature/current', isCurrent: true }, { name: 'main', isCurrent: false }] };
        case 'git-switch-branch':
          return { ok: true };
        case 'git-merge-no-commit':
          return { error: 'simulated merge failure' };
        case 'git-merge-abort':
          return { ok: true };
        default:
          return { ok: true };
      }
    });
    (window as any).electronAPI = { invoke };

    const result = await completeBranchMergeSave({
      repoPath: '/repo',
      relativeFilePath: 'src/a.ts',
      targetBranch: 'main',
      sourceBranch: 'ai/fresh',
      content: 'merged',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('merge_failed');
    const switchCalls = invoke.mock.calls.filter(([, payload]) => payload.command === 'git-switch-branch');
    expect(switchCalls).toHaveLength(2);
    expect(switchCalls[0][1].branchName).toBe('main');
    expect(switchCalls[1][1].branchName).toBe('feature/current');
  });
});

