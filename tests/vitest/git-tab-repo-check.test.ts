/**
 * Guards the Git-tab “repo check” IPC surface: verifying a folder is a repo and hydrating read-only VC state must
 * not flip the user onto `master` or create branches. These tests target `gitTabRepoCheck.ts`, which `useGitTab`
 * invokes after resolving the repo root.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  runGitTabRepoCheckRefreshSteps,
  verifyGitRepositoryAndResolveRoot,
} from '@/frontend/features/git/gitTabRepoCheck';

describe('verifyGitRepositoryAndResolveRoot', () => {
  it('never invokes git-switch-branch or git-branch-create for master during repo probe', async () => {
    const calls: Array<{ cmd: string; payload?: Record<string, unknown> }> = [];
    const invokeGitProvider = vi.fn(
      async (command: string, payload: Record<string, unknown> = {}) => {
        calls.push({ cmd: command, payload });
        if (command === 'is-git-repo') {
          return true;
        }
        if (command === 'resolve-git-repo-root') {
          return { root: '/tmp/fixture' };
        }
        return { ok: true };
      },
    );

    await verifyGitRepositoryAndResolveRoot(invokeGitProvider, '/tmp/fixture/workspace');

    const commands = calls.map((c) => c.cmd);
    expect(commands).toContain('is-git-repo');
    expect(commands).toContain('resolve-git-repo-root');

    expect(commands.some((cmd) => cmd === 'git-switch-branch')).toBe(false);
    expect(commands.some((cmd) => cmd === 'git-branch-create')).toBe(false);
    for (const entry of calls) {
      expect(entry.payload?.branchName).not.toBe('master');
    }
  });

  it('skips resolve when not a repo', async () => {
    const invokeGitProvider = vi.fn(async (command: string) =>
      command === 'is-git-repo' ? false : { ok: true },
    );

    const out = await verifyGitRepositoryAndResolveRoot(invokeGitProvider, '/nope');

    expect(out.isGitRepo).toBe(false);
    expect(out.resolvedWorkTreeRoot).toBeNull();
    expect(invokeGitProvider).toHaveBeenCalledTimes(1);
  });
});

describe('runGitTabRepoCheckRefreshSteps', () => {
  it('invokes tracked/remotes scopes and optional file branches when selectedDocument is non-empty', async () => {
    const stubs = {
      refreshStatus: vi.fn(async () => {}),
      refreshLog: vi.fn(async () => {}),
      refreshTrackedFiles: vi.fn(async () => {}),
      refreshGitRemotes: vi.fn(async () => {}),
      refreshFileLog: vi.fn(async () => {}),
      refreshBranches: vi.fn(async () => {}),
    };

    await runGitTabRepoCheckRefreshSteps('src/a.ts', stubs);

    expect(stubs.refreshStatus).toHaveBeenCalledTimes(1);
    expect(stubs.refreshLog).toHaveBeenCalledTimes(1);
    expect(stubs.refreshTrackedFiles).toHaveBeenCalledTimes(1);
    expect(stubs.refreshGitRemotes).toHaveBeenCalledTimes(1);
    expect(stubs.refreshFileLog).toHaveBeenCalledTimes(1);
    expect(stubs.refreshBranches).toHaveBeenCalledTimes(1);
  });

  it('skips file log and branches when no document selected', async () => {
    const stubs = {
      refreshStatus: vi.fn(async () => {}),
      refreshLog: vi.fn(async () => {}),
      refreshTrackedFiles: vi.fn(async () => {}),
      refreshGitRemotes: vi.fn(async () => {}),
      refreshFileLog: vi.fn(async () => {}),
      refreshBranches: vi.fn(async () => {}),
    };

    await runGitTabRepoCheckRefreshSteps('', stubs);

    expect(stubs.refreshFileLog).not.toHaveBeenCalled();
    expect(stubs.refreshBranches).not.toHaveBeenCalled();
  });
});
