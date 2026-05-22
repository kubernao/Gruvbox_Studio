import { GIT_INDEX_REVISION } from './gitIndexRevision';
import { fetchRepoFileRevision, isMissingGitShowFileRevision } from './fetchRepoFileRevision';

export interface DiffBlobSessionArgs {
  repoPath: string;
  filePath: string;
  leftVersionHash: string;
  rightVersionHash: string;
}

export interface DiffBlobSessionResult {
  leftText: string;
  rightText: string;
}

/**
 * Loads full file text for both diff sides. Uses the index blob for the left side when
 * both hashes are empty (working-tree `git diff`, which compares index vs worktree).
 */
export async function loadDiffBlobSession(args: DiffBlobSessionArgs): Promise<DiffBlobSessionResult> {
  const isWorkingTreeDiff = args.leftVersionHash === '' && args.rightVersionHash === '';
  const leftRev = isWorkingTreeDiff ? GIT_INDEX_REVISION : args.leftVersionHash;
  const rightRev = isWorkingTreeDiff ? '' : args.rightVersionHash;

  const [left, right] = await Promise.all([
    fetchRepoFileRevision({
      repoPath: args.repoPath,
      filePath: args.filePath,
      revision: leftRev,
    }),
    fetchRepoFileRevision({
      repoPath: args.repoPath,
      filePath: args.filePath,
      revision: rightRev,
    }),
  ]);

  const leftText = left.ok
    ? left.content
    : isMissingGitShowFileRevision(left)
      ? ''
      : null;
  if (leftText === null) {
    const msg = !left.ok ? left.error ?? left.reason ?? 'Failed to load left file revision' : 'Failed to load left file revision';
    throw new Error(msg);
  }
  const rightText = right.ok
    ? right.content
    : isMissingGitShowFileRevision(right)
      ? ''
      : null;
  if (rightText === null) {
    const msg = !right.ok ? right.error ?? right.reason ?? 'Failed to load right file revision' : 'Failed to load right file revision';
    throw new Error(msg);
  }

  return { leftText, rightText };
}
