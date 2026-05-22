/**
 * Branch Merge Save
 * =================
 *
 * Executes the full git branch-merge sequence after the user has resolved all
 * hunks in the diff viewer.  The sequence mirrors what `git merge` normally does
 * automatically, but gives us full control at each step so we can write our own
 * resolved content rather than letting git overwrite the file with conflict markers.
 *
 * ### Step-by-step sequence
 *
 *   1. **Check for an in-progress git operation** — if a merge, rebase, cherry-pick,
 *      revert, or bisect is already underway, bail out immediately.
 *
 *   2. **Verify the source branch exists** — it may have been deleted or never pushed
 *      (common in AI-proposal flows where the branch is ephemeral).
 *
 *   3. **Verify a clean working tree** — `git merge --no-commit` refuses to run on a
 *      dirty tree.  We check upfront to give a clearer error message.
 *
 *   4. **Switch to the target branch** — `git switch <targetBranch>`.
 *
 *   5. **Merge without committing** — `git merge --no-commit <sourceBranch>`.
 *      This stages the merge but leaves the commit open so we can overwrite the file
 *      with our resolved content.
 *
 *   6. **Check for conflicts in other files** — if the merge produced conflicts outside
 *      the file we're resolving, abort and tell the user to handle those manually.
 *
 *   7. **Write the resolved content** — overwrite the file with the merged text the
 *      user approved in the diff viewer.
 *
 *   8. **Stage the resolved file** — `git add <relativeFilePath>`.
 *
 *   9. **Confirm no remaining unresolved paths** — a final check before committing.
 *
 *  10. **Commit the merge** — `git commit` with the standard merge message.
 *
 *  11. **Remove the AI worktree** (optional) — if `aiWorktreePath` is provided, remove
 *      it before deleting the source branch.
 *
 *  12. **Delete the source branch** — non-fatal; a warning is returned if this fails
 *      (e.g. the branch is checked out elsewhere).
 *
 * ### Error handling
 *
 * Every step returns a structured `BranchMergeSaveResult` with an `ok` flag and a
 * human-readable `statusMessage`.  If a step after the merge has started fails, the
 * sequence runs `git merge --abort` to leave the repo in a clean state before returning.
 */

import { writeRepoRelativeFile } from './writeRepoRelativeFile';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Extracts the `error` string from a git-provider IPC response object, or null if none. */
export function pickGitProviderError(res: unknown): string | null {
  if (res != null && typeof res === 'object' && 'error' in res) {
    return String((res as { error: unknown }).error);
  }
  return null;
}

/**
 * Normalises a repo-relative path to forward slashes and strips a leading `./`
 * so paths can be compared regardless of how the caller formatted them.
 *
 * @example
 *   normalizeRepoRelPath('.\\src\\app.ts')  // → 'src/app.ts'
 *   normalizeRepoRelPath('./src/app.ts')    // → 'src/app.ts'
 */
export function normalizeRepoRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}


/**
 * Thin wrapper around `window.electronAPI.invoke('git-provider', ...)` that injects
 * `command` and `repoPath` into every call.  Throws when the IPC bridge is absent
 * so all callers can handle the same error type.
 *
 * @param command  - The git-provider sub-command (e.g. 'git-status', 'git-merge-abort').
 * @param repoPath - Absolute path to the working tree root.
 * @param payload  - Additional key-value pairs forwarded to the IPC handler.
 */
async function gitInvoke(
  command: string,
  repoPath: string,
  payload: Record<string, unknown> = {},
) {
  const invoke = window.electronAPI?.invoke;
  if (!invoke) {
    throw new Error('Electron invoke is not available.');
  }
  return invoke('git-provider', { command, repoPath, ...payload });
}


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters required to execute a branch merge save. */
export type BranchMergeSaveParams = {
  /** Absolute path to the git working tree root. */
  repoPath: string;
  /** Repo-relative path of the file being merged (must not be absolute). */
  relativeFilePath: string;
  /** Branch the resolved content will be merged into (e.g. 'main'). */
  targetBranch: string;
  /** Branch supplying the proposed changes (e.g. 'ai/fix-auth'). */
  sourceBranch: string;
  /** Fully resolved file content as a UTF-8 string. */
  content: string;
  /**
   * If provided, this git worktree path will be removed (via `git worktree remove --force`)
   * before the source branch is deleted.  Used in AI-proposal flows where the source branch
   * is backed by a temporary worktree that must be cleaned up first.
   */
  aiWorktreePath?: string;
  /** Remove second AI worktree before deleting branches (dual-AI flow). */
  aiWorktreePathB?: string;
  /** Delete this branch after merge (second AI variant; not used as merge parent). */
  alternateSourceBranch?: string;
  /**
   * When true, skip the clean-working-tree guard so a multi-file merge queue can
   * finalize after intermediate per-file writes left staged paths on the target branch.
   */
  allowDirtyFromMergeQueue?: boolean;
};

/** Structured result returned by {@link completeBranchMergeSave}. */
export type BranchMergeSaveResult = {
  ok: boolean;
  /** Non-fatal warning shown when the merge succeeded but the branch delete failed. */
  branchDeleteWarning?: string;
  /** Human-readable summary of the outcome, suitable for display in the status bar. */
  statusMessage?: string;
  /**
   * Machine-readable failure reason used by the caller to append actionable hints.
   * Only present when `ok` is false.
   */
  reason?:
    | 'missing_input'      // Required parameters were empty or invalid
    | 'dirty_tree'         // Working tree has uncommitted changes
    | 'source_ref_missing' // Source branch no longer exists
    | 'op_in_progress'     // Another git operation (merge/rebase/etc.) is active
    | 'switch_failed'      // git switch to target branch failed
    | 'merge_failed'       // git merge --no-commit failed
    | 'save_failed'        // Writing the resolved file content failed
    | 'stage_failed'       // git add failed
    | 'unresolved_paths'   // Conflicts exist in other files after the merge
    | 'commit_failed'      // git commit failed
    | 'unknown_error';     // Unexpected exception
  /** When true, the caller may offer a retry button. */
  retryable?: boolean;
};

// ---------------------------------------------------------------------------
// Intermediate per-file save (multi-file queue)
// ---------------------------------------------------------------------------

/**
 * Applies one resolved file to the target branch during a multi-file AI merge queue.
 * Switches to the target branch, writes content, and stages the path without merging
 * or deleting the AI proposal branch/worktree.
 */
/**
 * Removes AI worktrees and deletes proposal branches after a successful merge apply.
 */
function isEphemeralAiProposalBranch(branchName: string): boolean {
  const name = branchName.trim();
  return name.startsWith('ai/pi/');
}

async function cleanupAiProposalArtifacts(
  repo: string,
  params: Pick<BranchMergeSaveParams, 'aiWorktreePath' | 'aiWorktreePathB' | 'alternateSourceBranch' | 'sourceBranch'>,
): Promise<{ branchDeleteWarning?: string }> {
  const sourceBranch = params.sourceBranch.trim();
  const wt = params.aiWorktreePath?.trim() ?? '';
  if (wt !== '') {
    const wrErr = pickGitProviderError(await gitInvoke('git-worktree-remove', repo, { worktreePath: wt, force: true }));
    if (wrErr !== null) {
      console.warn('[branchMergeSave] git-worktree-remove failed (non-fatal):', wrErr);
    }
  }
  const wtB = params.aiWorktreePathB?.trim() ?? '';
  if (wtB !== '') {
    const wrBErr = pickGitProviderError(await gitInvoke('git-worktree-remove', repo, { worktreePath: wtB, force: true }));
    if (wrBErr !== null) {
      console.warn('[branchMergeSave] git-worktree-remove (secondary) failed (non-fatal):', wrBErr);
    }
  }
  const delR = await gitInvoke('git-branch-delete', repo, {
    branchName: sourceBranch,
    force: isEphemeralAiProposalBranch(sourceBranch),
  });
  const delErr = pickGitProviderError(delR);
  if (delErr !== null) {
    return {
      branchDeleteWarning:
        `Merge completed, but the branch "${sourceBranch}" could not be deleted: ${delErr}. ` +
        'You can remove it from the Git sidebar.',
    };
  }
  const altBranch = params.alternateSourceBranch?.trim() ?? '';
  if (altBranch !== '' && altBranch !== sourceBranch) {
    const delAlt = await gitInvoke('git-branch-delete', repo, {
      branchName: altBranch,
      force: isEphemeralAiProposalBranch(altBranch),
    });
    const delAltErr = pickGitProviderError(delAlt);
    if (delAltErr !== null) {
      return {
        branchDeleteWarning:
          `Merge completed, but the branch "${altBranch}" could not be deleted: ${delAltErr}. ` +
          'You can remove it from the Git sidebar.',
      };
    }
  }
  return {};
}

/**
 * Finalizes a multi-file merge queue on the target branch without `git merge`.
 * Prior per-file saves leave staged copies of reviewed files; merging the AI branch
 * would refuse with "local changes would be overwritten". This path writes the last
 * file, commits all staged content, then cleans up the proposal branch/worktree.
 */
async function completeMergeQueueOnTarget(
  params: BranchMergeSaveParams,
): Promise<BranchMergeSaveResult> {
  const repo = params.repoPath.trim();
  const rel = params.relativeFilePath.trim();
  const targetBranch = params.targetBranch.trim();
  const sourceBranch = params.sourceBranch.trim();
  const content = params.content;

  const wf = await writeRepoRelativeFile(repo, rel, content);
  if (!wf.ok) {
    return { ok: false, statusMessage: `Error saving file: ${wf.error}`, reason: 'save_failed' };
  }

  const ad = await gitInvoke('git-add-path', repo, { relativeFilePath: rel });
  const adErr = pickGitProviderError(ad);
  if (adErr !== null) {
    return { ok: false, statusMessage: adErr, reason: 'stage_failed' };
  }

  const cm = await gitInvoke('git-commit-staged', repo, {
    message: 'chore(ai): apply reviewed assistant edits',
  });
  const cmErr = pickGitProviderError(cm);
  if (
    cmErr !== null &&
    !(
      cm != null &&
      typeof cm === 'object' &&
      'noChanges' in cm &&
      (cm as { noChanges: unknown }).noChanges === true
    )
  ) {
    return { ok: false, statusMessage: cmErr, reason: 'commit_failed' };
  }

  const cleanup = await cleanupAiProposalArtifacts(repo, params);
  return {
    ok: true,
    statusMessage: 'All reviewed files committed to your branch.',
    branchDeleteWarning: cleanup.branchDeleteWarning,
  };
}

export async function saveIntermediateMergeFileToTarget(
  params: Pick<BranchMergeSaveParams, 'repoPath' | 'relativeFilePath' | 'targetBranch' | 'content'>,
): Promise<BranchMergeSaveResult> {
  const repo = params.repoPath.trim();
  const rel = params.relativeFilePath.trim();
  const targetBranch = params.targetBranch.trim();
  const content = params.content;

  const absPath = rel.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rel);
  if (repo === '' || rel === '' || absPath || targetBranch === '') {
    return {
      ok: false,
      statusMessage: 'Cannot save merge file: missing repo, file, or target branch.',
      reason: 'missing_input',
      retryable: false,
    };
  }

  try {
    const branchListRaw = await gitInvoke('git-branch-list', repo);
    const branchListErr = pickGitProviderError(branchListRaw);
    if (branchListErr !== null) {
      return { ok: false, statusMessage: branchListErr, reason: 'unknown_error' };
    }
    const branches =
      branchListRaw != null &&
      typeof branchListRaw === 'object' &&
      'branches' in branchListRaw &&
      Array.isArray((branchListRaw as { branches: unknown }).branches)
        ? (branchListRaw as { branches: Array<{ name?: string; isCurrent?: boolean }> }).branches
        : [];
    const onTarget = branches.some(
      (entry) => entry?.isCurrent === true && String(entry?.name ?? '').trim() === targetBranch,
    );
    if (!onTarget) {
      const sw = await gitInvoke('git-switch-branch', repo, { branchName: targetBranch });
      const swErr = pickGitProviderError(sw);
      if (swErr !== null) {
        return { ok: false, statusMessage: swErr, reason: 'switch_failed' };
      }
    }

    const wf = await writeRepoRelativeFile(repo, rel, content);
    if (!wf.ok) {
      return { ok: false, statusMessage: `Error saving file: ${wf.error}`, reason: 'save_failed' };
    }

    const ad = await gitInvoke('git-add-path', repo, { relativeFilePath: rel });
    const adErr = pickGitProviderError(ad);
    if (adErr !== null) {
      return { ok: false, statusMessage: adErr, reason: 'stage_failed' };
    }

    return {
      ok: true,
      statusMessage: `Saved ${rel} to ${targetBranch}. Continue reviewing remaining files.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, statusMessage: msg, reason: 'unknown_error', retryable: true };
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Executes the full branch merge save sequence described in the module header.
 *
 * @param params - See {@link BranchMergeSaveParams}.
 * @returns A structured result indicating success or the specific failure reason.
 */
export async function completeBranchMergeSave(
  params: BranchMergeSaveParams,
): Promise<BranchMergeSaveResult> {
  const repo         = params.repoPath.trim();
  const rel          = params.relativeFilePath.trim();
  const targetBranch = params.targetBranch.trim();
  const sourceBranch = params.sourceBranch.trim();
  const content      = params.content;

  
  // ---- Input validation ----
  const absPath = rel.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rel);
  if (repo === '' || rel === '' || absPath || targetBranch === '' || sourceBranch === '') {
    return {
      ok: false,
      statusMessage: 'Cannot complete branch merge: missing repo, file, or branch names.',
      reason: 'missing_input',
      retryable: false,
    };
  }
  if (targetBranch === sourceBranch) {
    return {
      ok: false,
      statusMessage: 'Cannot complete branch merge: source and target branch are the same.',
      reason: 'missing_input',
      retryable: false,
    };
  }

  // Tracks whether we have an in-progress merge that needs aborting on error
  let mergeInProgress = false;
  /** Original branch before we switch to target; used for best-effort restore on failure. */
  let originalBranch = '';
  /** True after we have switched branch during this operation. */
  let switchedToTarget = false;

  const restoreOriginalBranchIfNeeded = async (): Promise<void> => {
    if (!switchedToTarget || originalBranch.trim() === '' || originalBranch === targetBranch) {
      return;
    }
    await gitInvoke('git-switch-branch', repo, { branchName: originalBranch }).catch(() => {});
  };

  try {
    // ---- Step 1: Check for an existing in-progress git operation ----
    const opStateRaw = await gitInvoke('git-current-op-state', repo);
    const opStateErr = pickGitProviderError(opStateRaw);
    if (opStateErr !== null) {
      return {
        ok: false,
        statusMessage: `Cannot inspect git operation state: ${opStateErr}`,
        reason: 'unknown_error',
      };
    }
    const opState = (opStateRaw ?? {}) as {
      merge?: boolean; rebase?: boolean; cherryPick?: boolean;
      revert?: boolean; bisect?: boolean;
    };
    if (opState.merge || opState.rebase || opState.cherryPick || opState.revert || opState.bisect) {
      return {
        ok: false,
        statusMessage:
          'Cannot merge right now: another git operation is already in progress ' +
          '(merge/rebase/cherry-pick/revert/bisect).',
        reason: 'op_in_progress',
        retryable: false,
      };
    }


    // ---- Step 2: Verify the source branch still exists ----
    const refExistsRaw = await gitInvoke('git-ref-exists', repo, { refName: sourceBranch });
    const refExistsErr = pickGitProviderError(refExistsRaw);
    if (refExistsErr !== null) {
      return {
        ok: false,
        statusMessage: `Could not verify source branch: ${refExistsErr}`,
        reason: 'unknown_error',
      };
    }
    const exists =
      refExistsRaw != null &&
      typeof refExistsRaw === 'object' &&
      'exists' in refExistsRaw &&
      (refExistsRaw as { exists: unknown }).exists === true;
    if (!exists) {
      return {
        ok: false,
        statusMessage:
          `Cannot complete merge: source branch "${sourceBranch}" no longer exists. ` +
          'Regenerate AI changes and retry.',
        reason: 'source_ref_missing',
        retryable: false,
      };
    }


    // ---- Step 3: Verify a clean working tree ----
    const statusRaw = await gitInvoke('git-status', repo);
    const statusErr = pickGitProviderError(statusRaw);
    if (statusErr !== null) {
      return {
        ok: false,
        statusMessage: `git status failed: ${statusErr}`,
        reason: 'unknown_error',
      };
    }
    if (!params.allowDirtyFromMergeQueue) {
      if (!Array.isArray(statusRaw) || statusRaw.length > 0) {
        return {
          ok: false,
          statusMessage: 'Working tree must be clean before merging branches.',
          reason: 'dirty_tree',
          retryable: false,
        };
      }
    }

    // ---- Step 3.5: Snapshot current branch for failure restoration ----
    const branchListRaw = await gitInvoke('git-branch-list', repo);
    const branchListErr = pickGitProviderError(branchListRaw);
    if (branchListErr !== null) {
      return {
        ok: false,
        statusMessage: `Could not resolve current branch before merge: ${branchListErr}`,
        reason: 'unknown_error',
      };
    }
    const branches =
      branchListRaw != null &&
      typeof branchListRaw === 'object' &&
      'branches' in branchListRaw &&
      Array.isArray((branchListRaw as { branches: unknown }).branches)
        ? (branchListRaw as { branches: Array<{ name?: string; isCurrent?: boolean }> }).branches
        : [];
    originalBranch =
      branches.find((entry) => entry && entry.isCurrent === true && typeof entry.name === 'string')?.name?.trim() ??
      '';


    // ---- Step 4: Switch to the target branch ----
    const sw    = await gitInvoke('git-switch-branch', repo, { branchName: targetBranch });
    const swErr = pickGitProviderError(sw);
    if (swErr !== null) {
      return { ok: false, statusMessage: swErr, reason: 'switch_failed' };
    }
    switchedToTarget = true;

    const hasQueuedLocalChanges =
      params.allowDirtyFromMergeQueue &&
      Array.isArray(statusRaw) &&
      statusRaw.length > 0;
    if (hasQueuedLocalChanges) {
      return await completeMergeQueueOnTarget(params);
    }

    // ---- Step 5: Merge without committing ----
    // --no-commit stages the merge but leaves the index open so we can overwrite the file.
    const mg    = await gitInvoke('git-merge-no-commit', repo, { branchName: sourceBranch });
    const mgErr = pickGitProviderError(mg);
    if (mgErr !== null) {
      await gitInvoke('git-merge-abort', repo).catch(() => {});
      await restoreOriginalBranchIfNeeded();
      const overwritten =
        mgErr.toLowerCase().includes('would be overwritten') ||
        mgErr.toLowerCase().includes('local changes');
      const reason = mgErr.toLowerCase().includes('not something we can merge')
        ? 'source_ref_missing'
        : 'merge_failed';
      const statusMessage = overwritten
        ? `${mgErr} Save each file in the merge queue first, then save the last file again to commit without merging over your staged edits.`
        : mgErr;
      return { ok: false, statusMessage, reason };
    }
    mergeInProgress = true;


    // ---- Step 6: Check for conflicts in OTHER files ----
    // Our caller only resolves one file; if the merge produced conflicts elsewhere we
    // cannot proceed and must abort.
    const unmergedRaw  = await gitInvoke('git-unmerged-paths', repo);
    const unmergedPaths =
      unmergedRaw != null &&
      typeof unmergedRaw === 'object' &&
      'paths' in unmergedRaw &&
      Array.isArray((unmergedRaw as { paths: unknown }).paths)
        ? (unmergedRaw as { paths: string[] }).paths
        : [];
    const relNorm = normalizeRepoRelPath(rel);
    const conflictingOthers = unmergedPaths.filter((p) => normalizeRepoRelPath(p) !== relNorm);
    if (conflictingOthers.length > 0) {
      await gitInvoke('git-merge-abort', repo).catch(() => {});
      mergeInProgress = false;
      await restoreOriginalBranchIfNeeded();
      return {
        ok: false,
        statusMessage: `Merge has conflicts in other files: ${conflictingOthers.join(', ')}. Merge aborted.`,
        reason: 'unresolved_paths',
        retryable: false,
      };
    }


    // ---- Step 7: Write the user-resolved file content ----
    const wf = await writeRepoRelativeFile(repo, rel, content);
    if (!wf.ok) {
      await gitInvoke('git-merge-abort', repo).catch(() => {});
      mergeInProgress = false;
      await restoreOriginalBranchIfNeeded();
      return { ok: false, statusMessage: `Error saving file: ${wf.error}`, reason: 'save_failed' };
    }


    // ---- Step 8: Stage the resolved file ----
    const ad    = await gitInvoke('git-add-path', repo, { relativeFilePath: rel });
    const adErr = pickGitProviderError(ad);
    if (adErr !== null) {
      await gitInvoke('git-merge-abort', repo).catch(() => {});
      mergeInProgress = false;
      await restoreOriginalBranchIfNeeded();
      return { ok: false, statusMessage: adErr, reason: 'stage_failed' };
    }


    // ---- Step 9: Final check for remaining unresolved paths ----
    const u2raw = await gitInvoke('git-unmerged-paths', repo);
    const u2    =
      u2raw != null &&
      typeof u2raw === 'object' &&
      'paths' in u2raw &&
      Array.isArray((u2raw as { paths: unknown }).paths)
        ? (u2raw as { paths: string[] }).paths
        : [];
    if (u2.length > 0) {
      await gitInvoke('git-merge-abort', repo).catch(() => {});
      mergeInProgress = false;
      await restoreOriginalBranchIfNeeded();
      return {
        ok: false,
        statusMessage: `Unresolved merge paths remain: ${u2.join(', ')}. Merge aborted.`,
        reason: 'unresolved_paths',
        retryable: false,
      };
    }


    // ---- Step 10: Commit the merge ----
    const cm    = await gitInvoke('git-commit-merge', repo);
    const cmErr = pickGitProviderError(cm);
    if (cmErr !== null) {
      await gitInvoke('git-merge-abort', repo).catch(() => {});
      mergeInProgress = false;
      await restoreOriginalBranchIfNeeded();
      return { ok: false, statusMessage: cmErr, reason: 'commit_failed' };
    }
    mergeInProgress = false;


    const cleanup = await cleanupAiProposalArtifacts(repo, params);
    return {
      ok: true,
      statusMessage: 'Branch merge completed.',
      branchDeleteWarning: cleanup.branchDeleteWarning,
    };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[branchMergeSave] completeBranchMergeSave failed:', msg);
    // If we left a merge in progress, abort it before returning the error
    if (mergeInProgress) {
      await gitInvoke('git-merge-abort', repo).catch(() => {});
    }
    await restoreOriginalBranchIfNeeded();
    return { ok: false, statusMessage: `Branch merge failed: ${msg}`, reason: 'unknown_error' };
  }
}
