/**
 * DiffToolbar
 * ============
 *
 * The top toolbar of the DiffViewer card.  It is purely presentational — all state
 * lives in DiffViewer and is passed down as props.  The toolbar is divided into two
 * main regions:
 *
 * ### Left stack — title and merge status
 *
 * - **Title**: the file name (or "Diff Viewer" when no file is scoped).
 * - **Unresolved badge**: appears in merge mode.  Shows the number of change blocks
 *   that still need a resolution decision.  Turns green (with a ✓) when all blocks
 *   are resolved, signalling that save is available.
 * - **Bulk-action buttons** (Accept all / Reject all): shown when `showAiBulkActions`
 *   is true (AI-review sessions and normal merge sessions).
 *
 * ### Right stack — navigation and actions
 *
 * - **Prev/Next change navigation**: ↑ / ↓ arrow buttons with a "N/M" counter.
 * - **Split / Inline toggle**: hidden while merge mode is active (merge is always inline).
 * - **Merge-into-file button** (fork icon): shown when NOT in merge mode, starts a
 *   file-merge session.
 * - **Save (✓) and Abort (✕) buttons**: shown only while merge mode is active.
 *   Save is disabled until all blocks are resolved.
 * - **Close (✕) button**: always visible; calls `onClose`.
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DiffToolbarProps {
  /** File name or "Diff Viewer" — displayed as the card title. */
  title: string;
  /** Formatted change counter string, e.g. `"3/7"`. */
  changeCounter: string;
  /** Whether the Prev button should be enabled. */
  hasPreviousChange: boolean;
  /** Whether the Next button should be enabled. */
  hasNextChange: boolean;
  onPreviousChange: () => void;
  onNextChange: () => void;
  /** Whether the viewer is currently in merge-edit mode. */
  mergeMode: boolean;
  /** Number of change blocks that have not yet been assigned a side. */
  unresolvedCount: number;
  /** Whether the save button should be enabled (repo path and file path are valid). */
  canSave: boolean;
  /** Whether a save operation is in progress (disables the save button, changes label). */
  isSaving: boolean;
  /** Tooltip / aria-label for the save button (describes the current save action). */
  mergeSaveTitle: string;
  /** Tooltip / aria-label for the merge-into-file button. */
  mergeIntoFileTitle: string;
  /** Starts a file-merge session. */
  onMergeIntoFile: () => void;
  /** Exits merge mode and discards all selections. */
  onToggleMergeMode: () => void;
  /**
   * When true, bulk Accept all / Reject all buttons are shown inside the
   * unresolved badge area.  Used for AI-review and standard merge sessions.
   */
  showAiBulkActions?: boolean;
  /** Tooltip text for the bulk action buttons. */
  bulkActionTitles?: { acceptAll: string; rejectAll: string };
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  /** Called when the user clicks the save button (✓). */
  onSave: () => void;
  /** Called when the user clicks the close button. */
  onClose?: () => void;
  /**
   * When true, merge mode uses an editable result editor (Monaco) instead of
   * per-hunk block resolution — the badge explains save semantics.
   */
  mergeUsesMonacoEditor?: boolean;
  /** Multi-file merge queue label, e.g. "File 2 of 5". */
  mergeQueueLabel?: string;
  hasPreviousMergeFile?: boolean;
  hasNextMergeFile?: boolean;
  onPreviousMergeFile?: () => void;
  onNextMergeFile?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DiffToolbar: React.FC<DiffToolbarProps> = ({
  title,
  changeCounter,
  hasPreviousChange,
  hasNextChange,
  onPreviousChange,
  onNextChange,
  mergeMode,
  unresolvedCount,
  canSave,
  isSaving,
  mergeSaveTitle,
  mergeIntoFileTitle,
  onMergeIntoFile,
  onToggleMergeMode,
  showAiBulkActions  = false,
  bulkActionTitles,
  onAcceptAll,
  onRejectAll,
  onSave,
  onClose,
  mergeUsesMonacoEditor = false,
  mergeQueueLabel = '',
  hasPreviousMergeFile = false,
  hasNextMergeFile = false,
  onPreviousMergeFile,
  onNextMergeFile,
}) => {
  return (
    <div className="diff-toolbar">

      {/* ---- Left stack: title + merge status ---- */}
      <div className="diff-toolbar-left-stack">
        <div className="diff-toolbar-headline">
          <div className="diff-toolbar-title-row">

            {/* File / session title */}
            <h2 title={title}>{title}</h2>

            {mergeQueueLabel !== '' && (
              <span className="diff-merge-queue-label" title="Multi-file AI merge review">
                {mergeQueueLabel}
              </span>
            )}

            {/* Merge status: unresolved badge + optional bulk-action buttons */}
            {mergeMode && (
              <div className="diff-merge-unresolved-wrap">
                <span
                  className={`diff-unresolved-badge${
                    mergeUsesMonacoEditor || unresolvedCount === 0 ? ' diff-unresolved-badge--ok' : ''
                  }`}
                  title={
                    mergeUsesMonacoEditor
                      ? 'Edit the result in the right-hand pane, then click save'
                      : unresolvedCount > 0
                        ? 'Resolve each change block before saving'
                        : 'All blocks resolved'
                  }
                >
                  {mergeUsesMonacoEditor
                    ? '✓ Edit result (right), then save'
                    : unresolvedCount > 0
                      ? `${unresolvedCount} unresolved`
                      : '✓ All resolved'}
                </span>

                {/* Bulk Accept all / Reject all — only shown when the policy enables them */}
                {showAiBulkActions && (
                  <span className="diff-inline-actions-group">
                    <button
                      type="button"
                      className="diff-inline-action-btn"
                      onClick={onAcceptAll}
                      disabled={!mergeUsesMonacoEditor && unresolvedCount === 0}
                      title={bulkActionTitles?.acceptAll ?? 'Accept all AI changes'}
                    >
                      Accept all
                    </button>
                    <button
                      type="button"
                      className="diff-inline-action-btn"
                      onClick={onRejectAll}
                      disabled={!mergeUsesMonacoEditor && unresolvedCount === 0}
                      title={bulkActionTitles?.rejectAll ?? 'Reject all AI changes'}
                    >
                      Reject all
                    </button>
                  </span>
                )}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ---- Right stack: navigation + view toggle + merge / save actions ---- */}
      <div className="diff-toolbar-actions">

        {mergeMode && mergeQueueLabel !== '' && (
          <div className="diff-nav-group diff-merge-file-nav">
            <div className="diff-nav-core">
              <div className="diff-nav-row">
                <button
                  type="button"
                  className="diff-nav-btn diff-nav-square"
                  disabled={!hasPreviousMergeFile}
                  title="Previous file in merge queue"
                  onClick={onPreviousMergeFile}
                >
                  ‹
                </button>
                <span className="diff-change-counter diff-merge-file-counter">{mergeQueueLabel}</span>
                <button
                  type="button"
                  className="diff-nav-btn diff-nav-square"
                  disabled={!hasNextMergeFile}
                  title="Next file in merge queue"
                  onClick={onNextMergeFile}
                >
                  ›
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Prev/Next change navigation with counter */}
        <div className="diff-nav-group">
          <div className="diff-nav-core">
            <div className="diff-nav-row">
              <button
                className="diff-nav-btn diff-nav-square"
                disabled={!hasPreviousChange}
                title="Previous change"
                onClick={onPreviousChange}
              >
                ↑
              </button>
              <span className="diff-change-counter">{changeCounter}</span>
              <button
                className="diff-nav-btn diff-nav-square"
                disabled={!hasNextChange}
                title="Next change"
                onClick={onNextChange}
              >
                ↓
              </button>
            </div>
          </div>
        </div>

        {/* Merge-into-file entry button — visible only when NOT in merge mode */}
        {!mergeMode && (
          <button
            type="button"
            className="diff-merge-toggle-btn"
            title={mergeIntoFileTitle}
            aria-label={mergeIntoFileTitle}
            onClick={onMergeIntoFile}
          >
            {/* "Merge" icon — a branch flowing into a single line */}
            <svg
              className="diff-toolbar-icon-svg"
              xmlns="http://www.w3.org/2000/svg"
              height="24"
              viewBox="0 -960 960 960"
              width="24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M440-120v-567l-64 63-56-56 160-160 160 160-56 56-64-63v87q0 64 26.5 117.5t64 95Q648-346 689-316t71 47l-58 58q-57-35-103-75.5T520-372v252h-80Z" />
            </svg>
          </button>
        )}

        {/* Save (✓) and Abort (✕) — visible only while in merge mode */}
        {mergeMode && (
          <>
            <button
              className="diff-save-result-btn diff-save-result-btn--merge-mode"
              disabled={isSaving || !canSave || (!mergeUsesMonacoEditor && unresolvedCount > 0)}
              title={mergeSaveTitle}
              aria-label={mergeSaveTitle}
              onClick={onSave}
            >
              {isSaving ? 'Saving...' : '✓'}
            </button>
            <button
              className="diff-merge-toggle-btn diff-merge-abort"
              title="Exit merge editor"
              aria-label="Exit merge editor"
              onClick={onToggleMergeMode}
            >
              ✕
            </button>
          </>
        )}

        {/* Close button — always visible */}
        <button
          className="diff-close-button"
          onClick={onClose}
          title="Close diff viewer"
        >
          ✕
        </button>

      </div>
    </div>
  );
};
