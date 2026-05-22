/**
 * BranchMergeDialog
 * ==================
 *
 * Modal dialog that lets the user choose a source branch and a target branch before
 * entering branch-merge mode in the diff viewer.
 *
 * ### When it appears
 *
 * DiffViewer shows this dialog when the user clicks the "Merge into branch" toolbar
 * button but neither `mergeSourceBranch` nor `mergeTargetBranch` are already set
 * on the session (e.g. the session was opened without `branchMerge` props).
 *
 * ### Branch list loading
 *
 * When `open` becomes true the component immediately calls the `git-branch-list`
 * IPC command via `window.electronAPI.invoke`.  It:
 *   1. Clears any previous branch list and error.
 *   2. Fetches the list and populates two `<select>` elements.
 *   3. Pre-selects the current branch as the target and the first non-current branch
 *      as the source, mirroring the most common "I'm on main, merging in a feature
 *      branch" flow.
 *
 * A stale-fetch guard (`cancelled` flag) prevents a slow response from a previous
 * `open` cycle from overwriting state after the dialog has been closed and reopened.
 *
 * ### Apply / Cancel
 *
 * - **Apply** calls `onApply(targetBranch, sourceBranch)` and the parent is responsible
 *   for closing the dialog and entering merge mode.
 * - **Cancel** / clicking the backdrop calls `onCancel`.
 *
 * The Apply button is disabled until both branches are selected, they are different,
 * and the branch list has at least two entries.
 */

import React, { useEffect, useState } from 'react';
import type { GitBranchListRow } from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extracts the `error` string from a git-provider IPC response object, or null if none. */
function pickGitProviderError(result: unknown): string | null {
  if (result != null && typeof result === 'object' && 'error' in result) {
    return String((result as { error: unknown }).error);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BranchMergeDialogProps {
  /** When true the dialog is rendered and branch loading begins. */
  open: boolean;
  /** Absolute path to the git working tree root (used for the branch list IPC call). */
  repoPath: string;
  /**
   * Called when the user clicks Apply.
   * @param targetBranch - The branch the resolved file will be merged into.
   * @param sourceBranch - The branch supplying the proposed changes.
   */
  onApply: (targetBranch: string, sourceBranch: string) => void;
  /** Called when the user dismisses the dialog without applying. */
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const BranchMergeDialog: React.FC<BranchMergeDialogProps> = ({
  open,
  repoPath,
  onApply,
  onCancel,
}) => {
  const [branches, setBranches] = useState<GitBranchListRow[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [target,   setTarget]   = useState(''); // branch being merged INTO
  const [source,   setSource]   = useState(''); // branch supplying proposed changes

  // ---- Fetch branch list whenever the dialog opens ----
  useEffect(() => {
    if (!open || repoPath.trim() === '') return;

    // Reset all state for this open cycle
    let cancelled = false;
    setError('');
    setLoading(true);
    setBranches([]);
    setTarget('');
    setSource('');

    const load = async () => {
      const invoke = window.electronAPI?.invoke;
      if (!invoke) {
        setError('Electron invoke is not available.');
        setLoading(false);
        return;
      }

      try {
        const res: unknown = await invoke('git-provider', {
          command:  'git-branch-list',
          repoPath: repoPath.trim(),
        });

        // Surface any IPC-level error
        const err = pickGitProviderError(res);
        if (err !== null) {
          if (!cancelled) setError(err);
          return;
        }

        // Extract the branch array from the response
        const list: GitBranchListRow[] =
          res != null &&
          typeof res === 'object' &&
          'branches' in res &&
          Array.isArray((res as { branches: unknown }).branches)
            ? (res as { branches: GitBranchListRow[] }).branches
            : [];

        if (cancelled) return; // dialog was closed before the response arrived

        setBranches(list);

        if (list.length < 2) {
          setError('At least two local branches are required.');
          return;
        }

        // Smart defaults: current branch → target, first other branch → source
        const currentBranch = list.find((b) => b.isCurrent)?.name ?? '';
        const defaultSource = list.find((b) => b.name !== currentBranch)?.name ?? '';

        setTarget(currentBranch);
        setSource(defaultSource !== currentBranch ? defaultSource : (list[1]?.name ?? ''));

      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    // Cleanup: mark this load cycle as stale if the effect re-runs before it finishes
    return () => {
      cancelled = true;
    };
  }, [open, repoPath]);

  // Don't render anything when closed
  if (!open) return null;

  const canApply =
    !loading &&
    target.trim() !== '' &&
    source.trim() !== '' &&
    target !== source &&
    branches.length >= 2;

  return (
    // Semi-transparent overlay — clicking outside the panel calls onCancel
    <div
      className="diff-branch-compare-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Merge into branch"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* Dialog panel — stop pointer events from bubbling to the overlay */}
      <div
        className="diff-branch-compare-panel"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="diff-branch-compare-intro">
          Choose branches for this file: incoming (left) vs merge target (right). Apply opens
          the merge editor; when the working tree is clean, saving completes the branch merge.
        </p>

        {/* Error banner */}
        {error !== '' && (
          <p className="diff-branch-compare-error" role="alert">
            {error}
          </p>
        )}

        {/* Target branch selector (the branch we're merging INTO) */}
        <label className="diff-branch-compare-label" htmlFor="diff-compare-target-branch">
          Merge into
        </label>
        <select
          id="diff-compare-target-branch"
          className="diff-branch-compare-select"
          aria-label="Target branch"
          disabled={loading || branches.length < 2}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {branches.map((b) => (
            <option key={`dv-merge-tgt-${b.name}`} value={b.name}>
              {b.name}{b.isCurrent ? ' (current)' : ''}
            </option>
          ))}
        </select>

        {/* Source branch selector (the branch supplying proposed changes) */}
        <label className="diff-branch-compare-label" htmlFor="diff-compare-source-branch">
          Merge from
        </label>
        <select
          id="diff-compare-source-branch"
          className="diff-branch-compare-select"
          aria-label="Source branch"
          disabled={loading || branches.length < 2}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          {branches.map((b) => (
            <option key={`dv-merge-src-${b.name}`} value={b.name}>
              {b.name}{b.isCurrent ? ' (current)' : ''}
            </option>
          ))}
        </select>

        {/* Action buttons */}
        <div className="diff-branch-compare-actions">
          <button
            type="button"
            className="diff-branch-compare-primary"
            disabled={!canApply}
            onClick={() => onApply(target.trim(), source.trim())}
          >
            {loading ? 'Working…' : 'Apply'}
          </button>
          <button type="button" className="diff-branch-compare-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
