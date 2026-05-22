/**
 * `gitTabRepoCheck.ts` separates the lightweight “detect git repo / resolve root” IPC calls from the
 * follow-up refreshes invoked when opening the Version Control tab. Keeping this logic outside the hook
 * makes it trivial to regression-test that we never implicitly switch or create branches (previously an
 * unconditional `master` policy caused noisy failures and violated multi-worktree expectations). Refresh
 * steps stay side-effect-only reads (status/log/remotes/branches).
 */

import {
  readGitProviderBooleanResult,
  readGitProviderResolvedRepoRoot,
} from './utils/gitProviderUtils';

/**
 * Queries the Electron git provider to determine whether `repoPath` is inside a Git work tree and, when
 * it is, resolves the canonical work-tree root reported by Git. Only `is-git-repo` and
 * `resolve-git-repo-root` are invoked — no switches, deletes, or creates — so opening a workspace never
 * mutates branch state.
 *
 * @param invokeGitProvider - Same callback the Git tab hook uses (`git-provider` IPC).
 * @param repoPath - Workspace path chosen for VC (may sit inside nested folders).
 */
export async function verifyGitRepositoryAndResolveRoot(
  invokeGitProvider: (command: string, payload?: Record<string, unknown>) => Promise<unknown>,
  repoPath: string,
): Promise<{ isGitRepo: boolean; resolvedWorkTreeRoot: string | null }> {
  const result = await invokeGitProvider('is-git-repo');
  const isGitRepo = readGitProviderBooleanResult(result);
  if (!isGitRepo) {
    return { isGitRepo: false, resolvedWorkTreeRoot: null };
  }
  const rootRes = await invokeGitProvider('resolve-git-repo-root', {
    directoryPath: repoPath,
  });
  const resolved = readGitProviderResolvedRepoRoot(rootRes);
  return { isGitRepo: true, resolvedWorkTreeRoot: resolved ?? null };
}

export type GitTabRepoCheckRefreshFns = {
  refreshStatus: () => Promise<void>;
  refreshLog: () => Promise<void>;
  refreshTrackedFiles: () => Promise<void>;
  refreshGitRemotes: () => Promise<void>;
  refreshFileLog: () => Promise<void>;
  refreshBranches: () => Promise<void>;
};

/**
 * Runs the Git tab read-only refreshes executed after repo detection succeeds: repo-wide history and
 * status, tracked files and remotes, and optional file/branches scopes when `selectedDocument` is set.
 * None of these steps perform branch mutation.
 *
 * @param selectedDocument - Relative path within the workspace; when empty, skips file/branches scopes.
 * @param fns - Callbacks forwarding to hook-owned `invokeGitProvider`-backed refreshes.
 */
export async function runGitTabRepoCheckRefreshSteps(
  selectedDocument: string,
  fns: GitTabRepoCheckRefreshFns,
): Promise<void> {
  await Promise.all([fns.refreshStatus(), fns.refreshLog()]);
  await Promise.all([fns.refreshTrackedFiles(), fns.refreshGitRemotes()]);
  if (selectedDocument !== '') {
    await fns.refreshFileLog();
    await fns.refreshBranches();
  }
}
