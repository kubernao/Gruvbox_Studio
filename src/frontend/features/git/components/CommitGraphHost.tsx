/**
 * CommitGraphHost — thin wrapper that owns the error boundary and loading
 * state around {@link CommitGraphRenderer}.
 *
 * Receives pre-computed graph layout data via `graphContext` (built by the
 * Rust addon or the JS fallback in `gitTabGraphBranchColors.ts`) and forwards
 * it to the renderer. Errors thrown by the renderer are surfaced through
 * `setGitHistoryGraphError` rather than crashing the git tab.
 *
 * Renderer-process only; no IPC calls.
 */

import React from 'react';
import type { GitLogEntry } from '../types/git';
import type { GitLogFileGraphContext } from '../utils/gitTabGraphBranchColors';
import { CommitGraphRenderer } from './CommitGraphRenderer';

export interface CommitGraphHostProps {
  commits: GitLogEntry[];
  graphContext: GitLogFileGraphContext | null;
  selectedHashes: string[];
  onCommitActivate: (hash: string) => void;
  setGitHistoryGraphError: (msg: string) => void;
}

export const CommitGraphHost: React.FC<CommitGraphHostProps> = ({
  commits,
  graphContext,
  selectedHashes,
  onCommitActivate,
  setGitHistoryGraphError,
}) => {
  const rendererProps: CommitGraphHostProps = {
    commits,
    graphContext,
    selectedHashes,
    onCommitActivate,
    setGitHistoryGraphError,
  };
  return <CommitGraphRenderer {...rendererProps} />;
};
