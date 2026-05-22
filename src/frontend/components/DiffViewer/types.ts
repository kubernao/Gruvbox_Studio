/**
 * DiffViewer types and interfaces
 */

/**
 * A single row in the side-by-side diff table. Both left and right tables
 * share the same row array so they stay visually aligned.
 */
export interface DiffRow {
  /** Visual row type, used for background colouring */
  type: 'context' | 'del' | 'ins' | 'change' | 'separator' | 'collapsed';
  leftLineNo: number | null;
  rightLineNo: number | null;
  leftText: string | null;
  rightText: string | null;
  /** Groups consecutive changed rows for navigation and ribbon drawing */
  changeBlockId: number | null;
  /** When a collapsed placeholder is used, which side it targets */
  collapsedSide?: 'left' | 'right';
  /** When collapsed, how many rows the placeholder spans (rowspan) */
  collapsedSpan?: number;
  /** True for rows that are covered by a collapsed rowspan and should skip rendering that side */
  collapsedSkip?: boolean;
  /** Number of omitted rows (used for display) */
  omittedCount?: number;
  leftFragments?: Array<{ text: string; op: 'equal' | 'ins' | 'del' }>;
  rightFragments?: Array<{ text: string; op: 'equal' | 'ins' | 'del' }>;
  // Internal caching
  _fragLeftSrc?: string;
  _fragRightSrc?: string;
}

/**
 * Represents the span of rows belonging to a single contiguous change block.
 */
export interface ChangeBlock {
  id: number;
  firstRowIdx: number;
  lastRowIdx: number;
}

/**
 * Git diff version option (commit/branch with metadata)
 */
export interface GitDiffVersionOption {
  hash: string;
  label: string;
  branchRefs?: string[];
  tagRefs?: string[];
}

/**
 * AI pane labels for diff viewer
 */
export interface AiPaneLabels {
  left: string;
  right: string;
}

/**
 * Merge intent type
 */
export type GitDiffMergeIntent = 'file' | 'branch';
export type DiffViewMode = 'split';
export type DiffSide = 'left' | 'right';
export type TripleDiffNavBoundaryMode = 'clamp' | 'wrap';
export type TripleMergePresentation = 'legacy' | 'dual-diff';
export type AiDiffPresentation = 'twoPane' | 'triple';

export interface DiffUiPolicy {
  defaultViewMode: DiffViewMode;
  showBulkActions: boolean;
  showSplitInlineActions: boolean;
  showRibbonGutter: boolean;
  /**
   * Enables additional side-pane visuals for 3-pane merge mode. Keep disabled
   * by default to preserve parity-first behavior under heavy workloads.
   */
  advancedMergeVisualsEnabled?: boolean;
  /**
   * Emits merge recompute diagnostics to aid staged rollout validation.
   */
  mergeDiagnosticsEnabled?: boolean;
  /**
   * Upper bound for decorated hunks before falling back to undecorated mode.
   */
  maxDecoratedHunks?: number;
  /**
   * Controls previous/next boundary semantics in 3-pane merge navigation.
   */
  tripleDiffNavBoundaryMode?: TripleDiffNavBoundaryMode;
  /**
   * Controls which 3-pane implementation is rendered when hashBase is present.
   */
  tripleMergePresentation?: TripleMergePresentation;
  /**
   * Controls whether AI hash-base sessions use the standard 2-pane diff editor
   * (default) or the legacy triple merge presentation.
   */
  aiDiffPresentation?: AiDiffPresentation;
  labels: {
    acceptAllTitle: string;
    rejectAllTitle: string;
    acceptRowLeft: string;
    acceptRowRight: string;
  };
}

/**
 * Branch list row from git
 */
export interface GitBranchListRow {
  name: string;
  isCurrent: boolean;
}

/**
 * Fragment in diff text (for word-level highlighting)
 */
export interface DiffFragment {
  text: string;
  op: 'equal' | 'del' | 'ins';
}

/**
 * Props for DiffViewer component
 */
export interface DiffViewerProps {
  /** Repo working tree root (absolute path on disk). */
  repoPath: string;
  /** Optional file path within the repo (git relative path). */
  filePath?: string;
  /** Preferred initial view mode when opening this session. */
  initialViewMode?: DiffViewMode;
  /** Left side version. */
  hash1: string;
  /** Right side version. */
  hash2: string;
  /** Optional base/ancestor version for a 3-pane merge view. */
  hashBase?: string;
  /** When set with branch names as hash1/hash2, start in merge-into-branch mode (left=source, right=target). */
  branchMerge?: { sourceBranch: string; targetBranch: string };
  /** AI-only diff behavior (inline accept/reject controls). */
  aiProposedEdits?: boolean;
  /** Optional policy preset to control UI behavior for this session. */
  uiPolicyPreset?: Partial<DiffUiPolicy>;
  /** AI assistant worktree (absolute path); removed before deleting the AI branch after a branch merge save. */
  aiWorktreePath?: string;
  /** Second AI worktree path (dual-AI merge cleanup). */
  aiWorktreePathB?: string;
  /** Two AI branches vs main in the center (see DiffViewerSession.dualAiMerge). */
  dualAiMerge?: boolean;

  onClose?: () => void;
  /** Repo-relative paths still to review after this save (multi-file AI merge queue). */
  mergePendingPaths?: string[];
  onMergeSaved?: (args: {
    repoPath: string;
    filePath: string;
    remainingPaths?: string[];
    mergeSession?: Omit<DiffViewerProps, 'filePath' | 'onMergeSaved' | 'onClose' | 'onSave' | 'onFetchDiff'>;
  }) => void;
  onSave?: (mergedContent: string, filePath: string) => Promise<void>;
  onFetchDiff?: (args: {
    repoPath: string;
    hash1: string;
    hash2: string;
    filePath?: string;
    fullContext?: boolean;
  }) => Promise<string>;
}
