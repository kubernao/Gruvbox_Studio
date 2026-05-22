import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/**
 * Runs git and captures stdout. Used by fixture helpers when an operation's
 * output is needed (e.g. resolving the symbolic-ref of a worktree to confirm
 * setup) — keeps the regular `runGit` quiet for the common no-output case.
 */
function runGitCapture(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).toString();
}

export type GitE2EFixtures = {
  /** Directory with files but no `.git` (for non-repo UI). */
  nonRepoDir: string;
  /** Initialized repo with two commits on `tracked.md` and an unstaged working-tree edit. */
  repoDir: string;
};

/**
 * Creates disposable directories under the OS temp folder. Caller should remove when done if desired.
 */
export function createGitE2EFixtures(): GitE2EFixtures {
  const base = mkdtempSync(path.join(tmpdir(), 'gruvbox-git-e2e-'));
  const nonRepoDir = path.join(base, 'no-git');
  const repoDir = path.join(base, 'with-git');
  mkdirSync(nonRepoDir, { recursive: true });
  mkdirSync(repoDir, { recursive: true });

  writeFileSync(path.join(nonRepoDir, 'readme.txt'), 'not a git repo\n');

  runGit(repoDir, ['init']);
  runGit(repoDir, ['config', 'user.email', 'e2e@gruvbox.test']);
  runGit(repoDir, ['config', 'user.name', 'Gruvbox E2E']);
  writeFileSync(path.join(repoDir, 'tracked.md'), 'line1\n');
  runGit(repoDir, ['add', 'tracked.md']);
  runGit(repoDir, ['commit', '-m', 'first']);
  writeFileSync(path.join(repoDir, 'tracked.md'), 'line1\nline2\n');
  runGit(repoDir, ['add', 'tracked.md']);
  runGit(repoDir, ['commit', '-m', 'second']);
  writeFileSync(path.join(repoDir, 'tracked.md'), 'line1\nline2\nline3-uncommitted\n');

  return { nonRepoDir, repoDir };
}

/**
 * Configuration options for {@link createBranchMergeFixture}. Each flag
 * shapes a real-git scenario that the branch-merge-save E2E suite exercises
 * against the production code path.
 */
export interface BranchMergeFixtureOptions {
  /**
   * Force the repo into the middle of a git operation (a half-finished
   * `merge --no-commit`) so that `git-current-op-state` returns a non-clean
   * status. Used to validate the `op_in_progress` rejection path.
   */
  leaveOperationInProgress?: boolean;
  /**
   * Leave an unstaged edit in the working tree to validate the `dirty_tree`
   * rejection path. The edit is applied to `tracked.md` after both commits.
   */
  leaveDirtyTree?: boolean;
  /**
   * Skip creating the AI worktree. Used to verify that branch-merge save
   * still works without a worktree (file-only flow).
   */
  skipAiWorktree?: boolean;
  /**
   * Delete the source branch before returning the fixture. Used to validate
   * the `source_ref_missing` rejection path.
   */
  deleteSourceBranchAfterSetup?: boolean;
  /**
   * Optional secondary source branch (sets up the dual-AI merge scenario
   * that `completeBranchMergeSave` cleans up via `alternateSourceBranch`).
   */
  withAlternateSourceBranch?: boolean;
}

/**
 * Materialised paths and metadata returned by {@link createBranchMergeFixture}.
 * Consumers use these strings as the `repoPath`, `aiWorktreePath`, etc. when
 * invoking `completeBranchMergeSave` against a real git index.
 */
export interface BranchMergeFixture {
  /** Absolute path to the primary repo root (the user's working tree). */
  repoPath: string;
  /** Absolute path to the AI worktree (or `null` when `skipAiWorktree` is set). */
  aiWorktreePath: string | null;
  /** Absolute path to the alternate AI worktree, when configured. */
  alternateAiWorktreePath: string | null;
  /** The branch the user wants to merge INTO. */
  targetBranch: string;
  /** The branch the AI proposed (the source of the merge). */
  sourceBranch: string;
  /** Optional alternate source branch (set when `withAlternateSourceBranch` is true). */
  alternateSourceBranch: string | null;
  /** Repo-relative path of the file the AI edited. */
  relativeFilePath: string;
  /**
   * Path to a session metadata JSON file mirroring what the AI agent writes
   * to `~/.gruvbox/ai-sessions/...` so the consuming test can pass an
   * absolute path through the same plumbing as a real session.
   */
  sessionJsonPath: string;
  /**
   * Cleanup callback. Removes every path the fixture created. Tests should
   * call this in a `finally` block to keep `tmp` lean.
   */
  cleanup: () => void;
}

/**
 * Builds a real on-disk git repository with two branches, one or two AI
 * worktrees, and a session metadata JSON suitable for exercising
 * `completeBranchMergeSave` end-to-end.
 *
 * Layout (defaults):
 *   /tmp/gruvbox-branch-merge-XXXX/
 *     repo/                         primary working tree, on `main`
 *       tracked.md                  committed line1\nline2\n
 *     ai-worktree/                  worktree of the SAME repo, on
 *                                   `ai/proposal-1`, with an extra line
 *     session.json                  metadata blob the consumer can read
 *
 * Edge variants (option flags) layer on top of this base layout. Only one
 * variant should be enabled per fixture instance — combinations are not
 * exercised because the production code paths short-circuit on the first
 * rejection reason.
 */
export function createBranchMergeFixture(
  options: BranchMergeFixtureOptions = {},
): BranchMergeFixture {
  const base = mkdtempSync(path.join(tmpdir(), 'gruvbox-branch-merge-'));
  const repoPath = path.join(base, 'repo');
  const aiWorktreePath = options.skipAiWorktree ? null : path.join(base, 'ai-worktree');
  const alternateAiWorktreePath = options.withAlternateSourceBranch
    ? path.join(base, 'ai-worktree-alt')
    : null;

  const targetBranch = 'main';
  const sourceBranch = 'ai/proposal-1';
  const alternateSourceBranch = options.withAlternateSourceBranch ? 'ai/proposal-2' : null;
  const relativeFilePath = 'tracked.md';

  // ---- Primary repo setup --------------------------------------------------
  mkdirSync(repoPath, { recursive: true });
  runGit(repoPath, ['init', '-b', targetBranch]);
  runGit(repoPath, ['config', 'user.email', 'fixture@gruvbox.test']);
  runGit(repoPath, ['config', 'user.name', 'Gruvbox Fixture']);
  // Force commit.gpgSign=false so machines with global signing settings don't
  // explode the fixture during commit calls.
  runGit(repoPath, ['config', 'commit.gpgSign', 'false']);
  writeFileSync(path.join(repoPath, relativeFilePath), 'line1\nline2\n');
  runGit(repoPath, ['add', relativeFilePath]);
  runGit(repoPath, ['commit', '-m', 'baseline']);

  // ---- Source branch with the AI proposal ---------------------------------
  runGit(repoPath, ['branch', sourceBranch]);
  runGit(repoPath, ['checkout', sourceBranch]);
  writeFileSync(
    path.join(repoPath, relativeFilePath),
    'line1\nline2\nline3-from-ai\n',
  );
  runGit(repoPath, ['add', relativeFilePath]);
  runGit(repoPath, ['commit', '-m', 'ai proposal 1']);
  runGit(repoPath, ['checkout', targetBranch]);

  // ---- Optional alternate source branch ------------------------------------
  if (alternateSourceBranch) {
    runGit(repoPath, ['branch', alternateSourceBranch]);
    runGit(repoPath, ['checkout', alternateSourceBranch]);
    writeFileSync(
      path.join(repoPath, relativeFilePath),
      'line1\nline2\nline3-from-ai-alt\n',
    );
    runGit(repoPath, ['add', relativeFilePath]);
    runGit(repoPath, ['commit', '-m', 'ai proposal 2']);
    runGit(repoPath, ['checkout', targetBranch]);
  }

  // ---- AI worktree --------------------------------------------------------
  if (aiWorktreePath) {
    runGit(repoPath, ['worktree', 'add', aiWorktreePath, sourceBranch]);
    // Sanity check — confirms HEAD points at the source branch
    const head = runGitCapture(aiWorktreePath, ['symbolic-ref', '--short', 'HEAD']).trim();
    if (head !== sourceBranch) {
      throw new Error(
        `AI worktree HEAD expected ${sourceBranch} but got ${head} — fixture is broken`,
      );
    }
  }

  if (alternateAiWorktreePath && alternateSourceBranch) {
    runGit(repoPath, ['worktree', 'add', alternateAiWorktreePath, alternateSourceBranch]);
  }

  // ---- Optional poisoning to exercise rejection paths ---------------------
  if (options.leaveOperationInProgress) {
    // Start a merge against the source branch but do not commit. This leaves
    // .git/MERGE_HEAD on disk so `git-current-op-state` reports a merge in
    // progress.
    try {
      execFileSync('git', ['merge', '--no-commit', '--no-ff', sourceBranch], {
        cwd: repoPath,
        stdio: 'ignore',
      });
    } catch {
      // Non-zero exit is expected when the merge has conflicts; the marker
      // files we need (.git/MERGE_HEAD) are written before the conflict-exit.
    }
  }

  if (options.leaveDirtyTree) {
    writeFileSync(path.join(repoPath, relativeFilePath), 'line1\nline2\nLOCAL_DIRTY\n');
  }

  if (options.deleteSourceBranchAfterSetup) {
    if (aiWorktreePath) {
      // Worktree must be removed before the branch can be deleted
      runGit(repoPath, ['worktree', 'remove', '--force', aiWorktreePath]);
    }
    runGit(repoPath, ['branch', '-D', sourceBranch]);
  }

  // ---- Session JSON --------------------------------------------------------
  const sessionJsonPath = path.join(base, 'session.json');
  writeFileSync(
    sessionJsonPath,
    JSON.stringify(
      {
        repoPath,
        targetBranch,
        sourceBranch,
        alternateSourceBranch,
        relativeFilePath,
        aiWorktreePath,
        alternateAiWorktreePath,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  // ---- Cleanup --------------------------------------------------------------
  const cleanup = (): void => {
    try {
      execFileSync('rm', ['-rf', base], { stdio: 'ignore' });
    } catch {
      // Best effort — never let cleanup mask a test failure
    }
  };

  return {
    repoPath,
    aiWorktreePath: aiWorktreePath ?? null,
    alternateAiWorktreePath: alternateAiWorktreePath ?? null,
    targetBranch,
    sourceBranch,
    alternateSourceBranch,
    relativeFilePath,
    sessionJsonPath,
    cleanup,
  };
}
