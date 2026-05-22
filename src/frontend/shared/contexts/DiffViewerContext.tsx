import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { DiffUiPolicy, DiffViewMode } from '../../components/DiffViewer/types';

export type DiffViewerSession = {
  repoPath: string;
  /** Relative path within repo (git path) */
  filePath?: string;
  initialViewMode?: DiffViewMode;
  hash1: string;
  hash2: string;
  /** Optional base/ancestor version for 3-pane merge rendering (user main for dual-AI). */
  hashBase?: string;
  /** True when opened from an AI-proposed edit flow. */
  aiProposedEdits?: boolean;
  /** Optional adapter-level policy overrides for UI behavior. */
  uiPolicyPreset?: Partial<DiffUiPolicy>;
  /** When set, open in branch merge mode: merge sourceBranch into targetBranch (user working branch). */
  branchMerge?: { sourceBranch: string; targetBranch: string };
  /** AI worktree path (main repo); used to remove the worktree before deleting the AI branch after merge. */
  aiWorktreePath?: string;
  /** Second AI worktree (dual-variant merge cleanup). */
  aiWorktreePathB?: string;
  /** True when comparing two AI branches with main in the center (3 refs + merge buffer). */
  dualAiMerge?: boolean;
  /** Merge-ready event id used to suppress duplicate dispatch of the same payload. */
  aiEventId?: string;
  /** Repo-relative paths still awaiting per-file merge review (AI multi-file queue). */
  mergePendingPaths?: string[];
  /** Paths already saved in the current multi-file merge session. */
  mergeCompletedPaths?: string[];
};

export type HistoryPreviewSession = {
  repoPath: string;
  filePath: string;
  absolutePath: string;
  hash: string;
  content: string;
};

export type CenterViewState =
  | { kind: 'editor' }
  | { kind: 'diff'; session: DiffViewerSession }
  | { kind: 'history-preview'; preview: HistoryPreviewSession }

type DiffViewerContextValue = {
  centerView: CenterViewState;
  session: DiffViewerSession | null;
  historyPreview: HistoryPreviewSession | null;
  openDiff: (session: DiffViewerSession) => void;
  openHistoryPreview: (preview: HistoryPreviewSession) => void;
  closeDiff: () => void;
  closeHistoryPreview: () => void;
  showEditor: () => void;
};

const DiffViewerContext = createContext<DiffViewerContextValue | undefined>(undefined);

export function DiffViewerProvider({ children }: { children: React.ReactNode }) {
  const [centerView, setCenterView] = useState<CenterViewState>({ kind: 'editor' });

  const openDiff = useCallback((next: DiffViewerSession) => {
    setCenterView({ kind: 'diff', session: next });
  }, []);

  const openHistoryPreview = useCallback((preview: HistoryPreviewSession) => {
    setCenterView({ kind: 'history-preview', preview });
  }, []);

  const closeDiff = useCallback(() => {
    setCenterView({ kind: 'editor' });
  }, []);

  const closeHistoryPreview = useCallback(() => {
    setCenterView({ kind: 'editor' });
  }, []);

  const showEditor = useCallback(() => {
    setCenterView({ kind: 'editor' });
  }, []);

  const session = centerView.kind === 'diff' ? centerView.session : null;
  const historyPreview = centerView.kind === 'history-preview' ? centerView.preview : null;
  const value = useMemo<DiffViewerContextValue>(
    () => ({
      centerView,
      session,
      historyPreview,
      openDiff,
      openHistoryPreview,
      closeDiff,
      closeHistoryPreview,
      showEditor,
    }),
    [centerView, session, historyPreview, openDiff, openHistoryPreview, closeDiff, closeHistoryPreview, showEditor],
  );

  return <DiffViewerContext.Provider value={value}>{children}</DiffViewerContext.Provider>;
}

export function useDiffViewer(): DiffViewerContextValue {
  const ctx = useContext(DiffViewerContext);
  if (!ctx) {
    throw new Error('useDiffViewer must be used within DiffViewerProvider');
  }
  return ctx;
}

