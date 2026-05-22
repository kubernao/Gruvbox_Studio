/**
 * Merge Persistence Router
 * =========================
 *
 * A thin routing layer that dispatches a resolved merge result to the appropriate
 * save implementation based on `mergeIntent`:
 *
 * | `mergeIntent` | Save path                                                          |
 * |---------------|--------------------------------------------------------------------|
 * | `'branch'`    | {@link completeBranchMergeSave} — full git merge sequence          |
 * | `'file'`      | `onSave` callback (if provided), otherwise {@link writeRepoRelativeFile} |
 *
 * This module exists to keep DiffViewer's `saveMerge` handler free of branching
 * logic about *how* to save.  DiffViewer just calls `persistMergeResult` and reacts
 * to the structured outcome it receives back.
 *
 * ### Return shape
 *
 * On success: `{ ok: true, statusMessage, branchDeleteWarning? }`
 * On failure: `{ ok: false, statusMessage, reason?, retryable? }`
 *
 * The `reason` field allows DiffViewer to append actionable hints to the generic
 * `statusMessage` (e.g. "Commit or stash local changes first" for `dirty_tree`).
 */

import { completeBranchMergeSave, saveIntermediateMergeFileToTarget } from './branchMergeSave';
import { writeRepoRelativeFile } from './writeRepoRelativeFile';

/**
 * Persists a fully resolved merge result to disk (or via callback).
 *
 * @param args.mergeIntent       - Routing key: `'file'` for a simple write,
 *                                 `'branch'` for the full git merge sequence.
 * @param args.repoPath          - Absolute path to the git working tree root.
 * @param args.filePath          - Repo-relative path of the file being saved.
 * @param args.mergeTargetBranch - Branch to merge into (branch intent only).
 * @param args.mergeSourceBranch - Branch being merged from (branch intent only).
 * @param args.mergedContent     - The fully resolved UTF-8 file content to write.
 * @param args.onSave            - Optional external save callback (file intent only).
 *                                 When provided, it is called instead of writing via IPC.
 *                                 Useful for embedding DiffViewer in a host that manages its
 *                                 own file I/O (e.g. a custom editor integration).
 * @param args.aiWorktreePath    - If set, the AI worktree is cleaned up before deleting
 *                                 the source branch (branch intent only).
 * @param args.aiWorktreePathB   - Second AI worktree removal (dual-AI branch intent).
 * @param args.alternateSourceBranch - Second AI branch to delete after merge (not merged in).
 * @param args.branchFinalize       - When false with branch intent, only stage this file on the
 *                                    target branch (multi-file queue). Default true.
 */
export async function persistMergeResult(args: {
  mergeIntent: 'file' | 'branch';
  repoPath: string;
  filePath: string;
  mergeTargetBranch: string;
  mergeSourceBranch: string;
  mergedContent: string;
  onSave?: (mergedContent: string, filePath: string) => Promise<void>;
  aiWorktreePath?: string;
  aiWorktreePathB?: string;
  alternateSourceBranch?: string;
  branchFinalize?: boolean;
}): Promise<
  | { ok: true; statusMessage: string; branchDeleteWarning?: string }
  | {
      ok: false;
      statusMessage: string;
      reason?:
        | 'missing_input'
        | 'dirty_tree'
        | 'source_ref_missing'
        | 'op_in_progress'
        | 'switch_failed'
        | 'merge_failed'
        | 'save_failed'
        | 'stage_failed'
        | 'unresolved_paths'
        | 'commit_failed'
        | 'unknown_error';
      retryable?: boolean;
    }
> {
  // ---- Branch merge intent: intermediate queue step or full finalize ----
  if (args.mergeIntent === 'branch') {
    const finalize = args.branchFinalize !== false;
    const outcome = finalize
      ? await completeBranchMergeSave({
          repoPath: args.repoPath,
          relativeFilePath: args.filePath,
          targetBranch: args.mergeTargetBranch,
          sourceBranch: args.mergeSourceBranch,
          content: args.mergedContent,
          aiWorktreePath: args.aiWorktreePath,
          aiWorktreePathB: args.aiWorktreePathB,
          alternateSourceBranch: args.alternateSourceBranch,
          allowDirtyFromMergeQueue: true,
        })
      : await saveIntermediateMergeFileToTarget({
          repoPath: args.repoPath,
          relativeFilePath: args.filePath,
          targetBranch: args.mergeTargetBranch,
          content: args.mergedContent,
        });
    if (!outcome.ok) {
      return {
        ok:            false,
        statusMessage: outcome.statusMessage ?? 'Branch merge failed.',
        reason:        outcome.reason,
        retryable:     outcome.retryable,
      };
    }
    return {
      ok:                   true,
      statusMessage:        outcome.statusMessage ?? 'Branch merge completed.',
      branchDeleteWarning:  outcome.branchDeleteWarning,
    };
  }

  // ---- File merge intent: write content directly ----

  // Prefer the caller-supplied save callback (allows host apps to intercept the write)
  if (args.onSave) {
    await args.onSave(args.mergedContent, args.filePath || 'merged-file.txt');
    return { ok: true, statusMessage: 'Merge saved successfully!' };
  }

  // Default: write through the IPC file-write layer
  const out = await writeRepoRelativeFile(args.repoPath, args.filePath, args.mergedContent);
  if (!out.ok) {
    return { ok: false, statusMessage: `Error saving file: ${out.error}` };
  }
  return { ok: true, statusMessage: 'Merge result saved successfully.' };
}
