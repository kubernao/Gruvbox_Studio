/**
 * DiffViewer — file diff and merge using Monaco Diff Editor (original vs modified).
 * Merge mode makes the modified (right) pane editable; save writes that buffer via persistMergeResult.
 */

import React, { Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { DiffViewerProps, GitDiffMergeIntent } from './types';
import { loadDiffBlobSession } from './utils/loadDiffBlobSession';
import { fetchRepoFileRevision, isMissingGitShowFileRevision } from './utils/fetchRepoFileRevision';
import { persistMergeResult } from './utils/diffMergePersistence';
import { getMergeSideStrategy } from './utils/mergePolarity';
import { buildDiffUiPolicy } from './utils/diffUiPolicy';
import { dispatchWorkspaceFileSaved } from '../../shared/utils/workspaceFileSavedEvents';
import { useDiffViewer } from '../../shared/contexts/DiffViewerContext';
import type { DiffViewerSession } from '../../shared/contexts/DiffViewerContext';
import { normalizeMergePathCandidate } from '../../features/assistant/utils/mergePathPolicy';
import { resolveSafeRepoFileAbs } from './utils/writeRepoRelativeFile';
import { getLanguageFromPath } from '../../features/editor/editorConfig';
import { DiffToolbar } from './DiffToolbar';
import { BranchMergeDialog } from './BranchMergeDialog';
import type { MonacoDiffEditorHandle } from './MonacoDiffEditor';
import type { MonacoMergePaneHandle } from './MonacoMergePane';
import type { MonacoTripleDiffEditorHandle } from './MonacoTripleDiffEditor';
import './DiffViewer.css';

const MonacoDiffEditor = React.lazy(async () => {
  const module = await import('./MonacoDiffEditor');
  return { default: module.MonacoDiffEditor };
});
const MonacoMergePane = React.lazy(async () => {
  const module = await import('./MonacoMergePane');
  return { default: module.MonacoMergePane };
});
const MonacoTripleDiffEditor = React.lazy(async () => {
  const module = await import('./MonacoTripleDiffEditor');
  return { default: module.MonacoTripleDiffEditor };
});

/** Tooltip / aria-label for starting file-only merge from the toolbar (constant — avoids pointless memoization). */
const MERGE_INTO_FILE_TITLE =
  'Merge into file — Resolve in the editor and save the merged text to the working tree file only';

function isRepoRelativeFilePath(fp: string | undefined): boolean {
  if (!fp?.trim()) return false;
  const t = fp.trim().replace(/\\/g, '/');
  if (t.startsWith('/')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(t)) return false;
  if (t === '.git' || t.startsWith('.git/')) return false;
  if (t === '.gruvbox' || t.startsWith('.gruvbox/')) return false;
  return true;
}

interface DiffViewerState {
  statusMessage: string;
  mergeMode: boolean;
  mergeIntent: GitDiffMergeIntent;
  mergeTargetBranch: string;
  mergeSourceBranch: string;
  isSaving: boolean;
  showBranchMergeDialog: boolean;
  leftText: string;
  baseText: string;
  rightText: string;
  mergeResultText: string;
  blobLoading: boolean;
  blobsReady: boolean;
  diffNavTotal: number;
  diffNavActive: number;
}

/** Branches chosen via BranchMergeDialog (overrides props until cleared). */
interface DialogBranchPair {
  source: string;
  target: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  repoPath,
  filePath,
  initialViewMode: _initialViewMode = 'split',
  hash1,
  hash2,
  hashBase,
  aiProposedEdits = false,
  uiPolicyPreset,
  branchMerge,
  aiWorktreePath,
  aiWorktreePathB,
  dualAiMerge = false,
  mergePendingPaths,
  onClose,
  onMergeSaved,
  onSave,
  onFetchDiff: _onFetchDiff,
}) => {
  const { openDiff } = useDiffViewer();
  const uiPolicy = useMemo(
    () =>
      buildDiffUiPolicy({
        aiProposedEdits,
        preset: uiPolicyPreset,
      }),
    [aiProposedEdits, uiPolicyPreset],
  );

  const mergeSideStrategy = useMemo(() => getMergeSideStrategy(aiProposedEdits), [aiProposedEdits]);
  const aiProposalOnlyDiff = aiProposedEdits && !hashBase?.trim();
  const effectivePreferredSide = aiProposalOnlyDiff ? 'right' : mergeSideStrategy.preferredSide;

  const [dialogBranches, setDialogBranches] = useState<DialogBranchPair | null>(null);

  const versionPair = useMemo(() => {
    if (dialogBranches) {
      return { left: dialogBranches.source, right: dialogBranches.target };
    }
    if (dualAiMerge && hashBase?.trim()) {
      return { left: hash1, right: hash2 };
    }
    if (aiProposalOnlyDiff) {
      return { left: hash2, right: hash1 };
    }
    const src = branchMerge?.sourceBranch?.trim() ?? '';
    const tgt = branchMerge?.targetBranch?.trim() ?? '';
    if (src !== '' && tgt !== '' && src !== tgt) {
      return { left: src, right: tgt };
    }
    return { left: hash1, right: hash2 };
  }, [
    hash1,
    hash2,
    hashBase,
    branchMerge?.sourceBranch,
    branchMerge?.targetBranch,
    dialogBranches,
    dualAiMerge,
    aiProposalOnlyDiff,
  ]);

  const propBranchMergeActive = useMemo(() => {
    const src = branchMerge?.sourceBranch?.trim() ?? '';
    const tgt = branchMerge?.targetBranch?.trim() ?? '';
    return src !== '' && tgt !== '' && src !== tgt;
  }, [branchMerge?.sourceBranch, branchMerge?.targetBranch]);

  useEffect(() => {
    setDialogBranches(null);
  }, [hash1, hash2, branchMerge?.sourceBranch, branchMerge?.targetBranch]);

  const saveIntentTokenRef = useRef(0);
  const monacoRef = useRef<MonacoDiffEditorHandle | null>(null);
  const monacoMergeRef = useRef<MonacoMergePaneHandle | null>(null);
  const monacoTripleDiffRef = useRef<MonacoTripleDiffEditorHandle | null>(null);
  const snapshotLeftRef = useRef('');
  const snapshotRightRef = useRef('');
  const mergeSessionRef = useRef({
    mergeIntent: 'file' as GitDiffMergeIntent,
    mergeTargetBranch: '',
    mergeSourceBranch: '',
  });

  const [state, setState] = useState<DiffViewerState>({
    statusMessage: '',
    mergeMode: false,
    mergeIntent: 'file',
    mergeTargetBranch: '',
    mergeSourceBranch: '',
    isSaving: false,
    showBranchMergeDialog: false,
    leftText: '',
    baseText: '',
    rightText: '',
    mergeResultText: '',
    blobLoading: false,
    blobsReady: false,
    diffNavTotal: 0,
    diffNavActive: 0,
  });

  useEffect(() => {
    if (!propBranchMergeActive || !branchMerge?.sourceBranch || !branchMerge?.targetBranch) {
      return;
    }
    const src = branchMerge.sourceBranch.trim();
    const tgt = branchMerge.targetBranch.trim();
    setState((s) => ({
      ...s,
      mergeMode: true,
      mergeIntent: 'branch',
      mergeTargetBranch: tgt,
      mergeSourceBranch: src,
      showBranchMergeDialog: false,
    }));
  }, [propBranchMergeActive, branchMerge?.sourceBranch, branchMerge?.targetBranch]);

  mergeSessionRef.current = {
    mergeIntent: state.mergeIntent,
    mergeTargetBranch: state.mergeTargetBranch,
    mergeSourceBranch: state.mergeSourceBranch,
  };

  const mergeResultTextRef = useRef(state.mergeResultText);
  mergeResultTextRef.current = state.mergeResultText;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (repoPath.trim() === '') {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            statusMessage: 'No repository selected.',
            blobLoading: false,
            blobsReady: false,
            leftText: '',
            rightText: '',
          }));
        }
        return;
      }

      const rel = filePath?.trim() ?? '';
      if (!rel || !isRepoRelativeFilePath(filePath)) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            statusMessage: 'Open a file-specific diff to compare versions in the editor.',
            leftText: '',
            rightText: '',
            blobLoading: false,
            blobsReady: false,
            diffNavTotal: 0,
            diffNavActive: 0,
          }));
        }
        return;
      }

      const leftH = versionPair.left;
      const rightH = versionPair.right;
      const isWorkingTreeDiff = leftH === '' && rightH === '';
      if (!isWorkingTreeDiff && (leftH === '' || rightH === '')) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            statusMessage: 'Missing versions to compare.',
            blobLoading: false,
            blobsReady: false,
          }));
        }
        return;
      }
      if (!isWorkingTreeDiff && leftH === rightH) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            statusMessage: 'Please select two different versions.',
            blobLoading: false,
            blobsReady: false,
          }));
        }
        return;
      }

      if (!cancelled) {
        setState((s) => ({
          ...s,
          blobLoading: true,
          blobsReady: false,
          statusMessage: 'Loading diff...',
        }));
      }

      try {
        const aiRepoPath = aiWorktreePath?.trim() ?? '';
        const aiRepoPathB = dualAiMerge ? aiWorktreePathB?.trim() ?? '' : '';
        // Branch-merge AI sessions should prefer git refs (hash1/hash2 branch tips)
        // over direct worktree file reads so content always matches committed AI/user
        // branch states. Worktree reads remain for explicit worktree-only views.
        const useAiWorktreeBlobs = Boolean(aiProposedEdits && aiRepoPath !== '' && !propBranchMergeActive);

        let leftText = '';
        let rightText = '';
        let baseText = '';

        if (useAiWorktreeBlobs) {
          if (dualAiMerge && aiRepoPathB !== '') {
            const [leftResult, baseResult, rightResult] = await Promise.all([
              fetchRepoFileRevision({
                repoPath: aiRepoPath,
                filePath: rel,
                revision: '',
              }),
              fetchRepoFileRevision({
                repoPath: repoPath.trim(),
                filePath: rel,
                revision: '',
              }),
              fetchRepoFileRevision({
                repoPath: aiRepoPathB,
                filePath: rel,
                revision: '',
              }),
            ]);

            const leftTextResult = leftResult.ok
              ? leftResult.content
              : isMissingGitShowFileRevision(leftResult)
                ? ''
                : null;
            if (leftTextResult === null) {
              const leftFailure = leftResult as { error?: string; reason?: string };
              const msg = leftFailure.error ?? leftFailure.reason ?? 'Failed to load left AI worktree file';
              throw new Error(msg);
            }
            const baseTextResult = baseResult.ok
              ? baseResult.content
              : isMissingGitShowFileRevision(baseResult)
                ? ''
                : null;
            if (baseTextResult === null) {
              const baseFailure = baseResult as { error?: string; reason?: string };
              const msg = baseFailure.error ?? baseFailure.reason ?? 'Failed to load base working tree file';
              throw new Error(msg);
            }
            const rightTextResult = rightResult.ok
              ? rightResult.content
              : isMissingGitShowFileRevision(rightResult)
                ? ''
                : null;
            if (rightTextResult === null) {
              const rightFailure = rightResult as { error?: string; reason?: string };
              const msg = rightFailure.error ?? rightFailure.reason ?? 'Failed to load right AI worktree file';
              throw new Error(msg);
            }

            leftText = leftTextResult;
            baseText = baseTextResult;
            rightText = rightTextResult;
          } else {
            const [currentResult, aiResult] = await Promise.all([
              fetchRepoFileRevision({
                repoPath: repoPath.trim(),
                filePath: rel,
                revision: '',
              }),
              fetchRepoFileRevision({
                repoPath: aiRepoPath,
                filePath: rel,
                revision: '',
              }),
            ]);

            const currentText = currentResult.ok
              ? currentResult.content
              : isMissingGitShowFileRevision(currentResult)
                ? ''
                : null;
            if (currentText === null) {
              const currentFailure = currentResult as { error?: string; reason?: string };
              const msg = currentFailure.error ?? currentFailure.reason ?? 'Failed to load working tree file';
              throw new Error(msg);
            }
            const aiText = aiResult.ok
              ? aiResult.content
              : isMissingGitShowFileRevision(aiResult)
                ? ''
                : null;
            if (aiText === null) {
              const aiFailure = aiResult as { error?: string; reason?: string };
              const msg = aiFailure.error ?? aiFailure.reason ?? 'Failed to load AI worktree file';
              throw new Error(msg);
            }

            leftText = currentText;
            rightText = aiText;
          }
        } else {
          const loaded = await loadDiffBlobSession({
            repoPath: repoPath.trim(),
            filePath: rel,
            leftVersionHash: leftH,
            rightVersionHash: rightH,
          });
          leftText = loaded.leftText;
          rightText = loaded.rightText;
        }

        if (cancelled) return;
        snapshotLeftRef.current = leftText;
        snapshotRightRef.current = rightText;
        if (hashBase?.trim()) {
          if (!useAiWorktreeBlobs) {
            const baseResult = await fetchRepoFileRevision({
              repoPath: repoPath.trim(),
              filePath: rel,
              revision: hashBase.trim(),
            });
            if (!baseResult.ok) {
              if (isMissingGitShowFileRevision(baseResult)) {
                baseText = '';
              } else {
                const msg = baseResult.error ?? baseResult.reason ?? 'Failed to load base file revision';
                throw new Error(msg);
              }
            } else {
              baseText = baseResult.content;
            }
          }
        }
        setState((s) => ({
          ...s,
          leftText,
          baseText,
          rightText,
          // Option A: strict parity with version-history behavior. The initial editable
          // buffer is the right-side blob, even for dual-AI hash-base sessions.
          mergeResultText: rightText,
          blobLoading: false,
          blobsReady: true,
          statusMessage: '',
        }));
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState((s) => ({
          ...s,
          statusMessage: `Failed to load file versions: ${msg}`,
          leftText: '',
          baseText: '',
          rightText: '',
          mergeResultText: '',
          blobLoading: false,
          blobsReady: false,
          diffNavTotal: 0,
          diffNavActive: 0,
        }));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [repoPath, filePath, versionPair.left, versionPair.right, hashBase, dualAiMerge]);

  const onDiffNavigationMeta = useCallback((meta: { total: number; activeIndex: number }) => {
    setState((s) => ({
      ...s,
      diffNavTotal: meta.total,
      diffNavActive: meta.activeIndex,
    }));
  }, []);

  const languageId = useMemo(() => {
    const p = filePath ?? 'plaintext.txt';
    return getLanguageFromPath(p);
  }, [filePath]);

  const onMergeResultTextChange = useCallback((text: string) => {
    setState((s) => ({ ...s, mergeResultText: text }));
  }, []);

  const jumpToChange = useCallback((delta: 1 | -1) => {
    const useTwoPaneAiDiff = Boolean(
      hashBase?.trim() &&
      (dualAiMerge || aiProposedEdits) &&
      uiPolicy.aiDiffPresentation !== 'triple',
    );
    if (hashBase?.trim()) {
      const dir = delta === 1 ? 'next' : 'previous';
      if (useTwoPaneAiDiff) {
        monacoRef.current?.goToDiff(dir);
      } else if (dualAiMerge && uiPolicy.tripleMergePresentation === 'dual-diff') {
        monacoTripleDiffRef.current?.goToDiff(dir);
      } else {
        monacoMergeRef.current?.goToDiff(dir);
      }
      return;
    }
    const dir = delta === 1 ? 'next' : 'previous';
    monacoRef.current?.goToDiff(dir);
  }, [aiProposedEdits, dualAiMerge, hashBase, uiPolicy.aiDiffPresentation, uiPolicy.tripleMergePresentation]);

  const acceptAll = useCallback(() => {
    const text =
      effectivePreferredSide === 'right'
        ? snapshotRightRef.current
        : snapshotLeftRef.current;
    const useTwoPaneAiDiff = Boolean(
      hashBase?.trim() &&
      (dualAiMerge || aiProposedEdits) &&
      uiPolicy.aiDiffPresentation !== 'triple',
    );
    if (hashBase?.trim()) {
      if (useTwoPaneAiDiff) {
        monacoRef.current?.setModifiedValue(text);
      } else {
        setState((s) => ({ ...s, mergeResultText: text }));
      }
      return;
    }
    monacoRef.current?.setModifiedValue(text);
  }, [aiProposedEdits, dualAiMerge, hashBase, effectivePreferredSide, uiPolicy.aiDiffPresentation]);

  const rejectAll = useCallback(() => {
    const text =
      effectivePreferredSide === 'right'
        ? snapshotLeftRef.current
        : snapshotRightRef.current;
    const useTwoPaneAiDiff = Boolean(
      hashBase?.trim() &&
      (dualAiMerge || aiProposedEdits) &&
      uiPolicy.aiDiffPresentation !== 'triple',
    );
    if (hashBase?.trim()) {
      if (useTwoPaneAiDiff) {
        monacoRef.current?.setModifiedValue(text);
      } else {
        setState((s) => ({ ...s, mergeResultText: text }));
      }
      return;
    }
    monacoRef.current?.setModifiedValue(text);
  }, [aiProposedEdits, dualAiMerge, hashBase, effectivePreferredSide, uiPolicy.aiDiffPresentation]);

  const startMergeIntoFile = useCallback(() => {
    setState((s) => ({
      ...s,
      mergeMode: true,
      mergeIntent: 'file',
      mergeTargetBranch: '',
      mergeSourceBranch: '',
    }));
  }, []);

  const onBranchDialogApply = useCallback((targetBranch: string, sourceBranch: string) => {
    setDialogBranches({ source: sourceBranch, target: targetBranch });
    setState((s) => ({
      ...s,
      mergeTargetBranch: targetBranch,
      mergeSourceBranch: sourceBranch,
      mergeMode: true,
      mergeIntent: 'branch',
      showBranchMergeDialog: false,
    }));
  }, []);

  const toggleMergeMode = useCallback(() => {
    const useTwoPaneAiDiff = Boolean(
      hashBase?.trim() &&
      (dualAiMerge || aiProposedEdits) &&
      uiPolicy.aiDiffPresentation !== 'triple',
    );
    if (hashBase?.trim()) {
      if (useTwoPaneAiDiff) {
      monacoRef.current?.setModifiedValue(snapshotRightRef.current);
      monacoRef.current?.setMergeEditing(false);
    } else {
      setState((s) => ({ ...s, mergeResultText: snapshotRightRef.current }));
    }
    } else {
      monacoRef.current?.setModifiedValue(snapshotRightRef.current);
      monacoRef.current?.setMergeEditing(false);
    }
    setState((s) => {
      if (!s.mergeMode) {
        return s;
      }
      return {
        ...s,
        mergeMode: false,
        mergeIntent: 'file',
        mergeTargetBranch: '',
        mergeSourceBranch: '',
      };
    });
  }, [aiProposedEdits, dualAiMerge, hashBase, uiPolicy.aiDiffPresentation]);

  const mergeQueue = useMemo(
    () =>
      (mergePendingPaths ?? [])
        .map((entry) => normalizeMergePathCandidate(entry))
        .filter((entry) => isRepoRelativeFilePath(entry)),
    [mergePendingPaths],
  );

  const mergeQueueIndex = useMemo(() => {
    const current = normalizeMergePathCandidate(filePath ?? '');
    if (current === '') return -1;
    return mergeQueue.indexOf(current);
  }, [filePath, mergeQueue]);

  const mergeSessionBase = useMemo(
    (): Omit<DiffViewerSession, 'filePath'> => ({
      repoPath,
      initialViewMode: _initialViewMode,
      hash1,
      hash2,
      ...(hashBase?.trim() ? { hashBase } : {}),
      aiProposedEdits,
      uiPolicyPreset,
      branchMerge,
      aiWorktreePath,
      aiWorktreePathB,
      dualAiMerge,
      mergePendingPaths: mergeQueue,
    }),
    [
      repoPath,
      _initialViewMode,
      hash1,
      hash2,
      hashBase,
      aiProposedEdits,
      uiPolicyPreset,
      branchMerge,
      aiWorktreePath,
      aiWorktreePathB,
      dualAiMerge,
      mergeQueue,
    ],
  );

  const openMergeQueueFile = useCallback(
    (targetPath: string, pendingPaths?: string[]) => {
      const normalized = normalizeMergePathCandidate(targetPath);
      if (!isRepoRelativeFilePath(normalized)) {
        return;
      }
      const nextPending = (pendingPaths ?? mergeQueue)
        .map((entry) => normalizeMergePathCandidate(entry))
        .filter((entry) => isRepoRelativeFilePath(entry));
      openDiff({
        ...mergeSessionBase,
        filePath: normalized,
        mergePendingPaths: nextPending.length > 0 ? nextPending : undefined,
      });
    },
    [mergeSessionBase, openDiff, mergeQueue],
  );

  const mergeQueueLabel =
    mergeQueue.length > 1 && mergeQueueIndex >= 0
      ? `File ${mergeQueueIndex + 1} of ${mergeQueue.length}`
      : '';

  const saveMerge = useCallback(
    async (intentToken: number) => {
      if (intentToken !== saveIntentTokenRef.current) {
        setState((s) => ({ ...s, statusMessage: 'Save blocked: explicit user action required.' }));
        return;
      }
      saveIntentTokenRef.current = 0;

      const useTwoPaneAiDiff = Boolean(
        hashBase?.trim() &&
        (dualAiMerge || aiProposedEdits) &&
        uiPolicy.aiDiffPresentation !== 'triple',
      );
      const mergedContent = hashBase?.trim()
        ? useTwoPaneAiDiff
          ? monacoRef.current?.getModifiedValue() ?? ''
          : mergeResultTextRef.current
        : monacoRef.current?.getModifiedValue() ?? '';
      const ms = mergeSessionRef.current;
      setState((s) => ({ ...s, isSaving: true, statusMessage: '' }));
      try {
        const dispatchMergeFileSaved = (): void => {
          const rel = filePath?.trim() ?? '';
          const root = repoPath.trim();
          if (root !== '' && rel !== '' && isRepoRelativeFilePath(filePath)) {
            const abs = resolveSafeRepoFileAbs(root, rel);
            dispatchWorkspaceFileSaved(abs ?? undefined);
          } else {
            dispatchWorkspaceFileSaved();
          }
        };

        const rel = filePath?.trim() ?? '';
        if (repoPath.trim() === '' || rel === '' || !isRepoRelativeFilePath(filePath)) {
          setState((s) => ({
            ...s,
            statusMessage: 'Cannot save: need a repo-relative file path.',
          }));
          return;
        }

        const relNorm = normalizeMergePathCandidate(rel);
        const remainingPaths = mergeQueue.filter((entry) => entry !== relNorm);
        const branchFinalize =
          ms.mergeIntent !== 'branch' || remainingPaths.length === 0;

        const outcome = await persistMergeResult({
          mergeIntent: ms.mergeIntent,
          repoPath: repoPath.trim(),
          filePath: rel,
          mergeTargetBranch: ms.mergeTargetBranch.trim(),
          mergeSourceBranch: ms.mergeSourceBranch.trim(),
          mergedContent,
          onSave,
          aiWorktreePath: aiWorktreePath?.trim() || undefined,
          aiWorktreePathB: dualAiMerge ? aiWorktreePathB?.trim() || undefined : undefined,
          alternateSourceBranch:
            dualAiMerge && hash2?.trim() ? hash2.trim() : undefined,
          branchFinalize,
        });

        if (outcome.ok) {
          dispatchMergeFileSaved();
          if (typeof onMergeSaved === 'function') {
            onMergeSaved({
              repoPath: repoPath.trim(),
              filePath: rel,
              remainingPaths: branchFinalize ? [] : remainingPaths,
              mergeSession: {
                ...mergeSessionBase,
                hash1: versionPair.left,
                hash2: versionPair.right,
                mergePendingPaths: remainingPaths,
              },
            });
          }
          if (outcome.branchDeleteWarning) {
            window.alert(outcome.branchDeleteWarning);
          }
          setState((s) => ({ ...s, statusMessage: outcome.statusMessage }));
          if (branchFinalize) {
            setTimeout(() => {
              if (onClose) onClose();
            }, 1000);
          } else if (remainingPaths.length > 0) {
            openMergeQueueFile(remainingPaths[0], remainingPaths);
          }
        } else {
          let actionableMessage = outcome.statusMessage;
          if (outcome.reason === 'source_ref_missing') {
            actionableMessage = `${outcome.statusMessage} Open the AI session again to regenerate the proposal branch.`;
          } else if (outcome.reason === 'dirty_tree') {
            actionableMessage = `${outcome.statusMessage} Local changes were made after the AI edit started; commit, stash, or discard them, then retry save.`;
          } else if (outcome.reason === 'op_in_progress') {
            actionableMessage = `${outcome.statusMessage} Finish/abort the active git operation, then retry save.`;
          } else if (outcome.reason === 'unresolved_paths') {
            actionableMessage = `${outcome.statusMessage} Resolve those paths first, then retry save.`;
          }
          setState((s) => ({ ...s, statusMessage: actionableMessage }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const normalized = msg.trim();
        const runtimeHint =
          normalized.includes('process is not defined')
            ? 'Save failed: renderer runtime bridge error (process unavailable). Restart the app and try again.'
            : normalized.includes('Electron invoke is not available')
              ? 'Save failed: Electron IPC bridge is unavailable. Restart the app and try again.'
              : `Save failed: ${normalized}`;
        setState((s) => ({ ...s, statusMessage: runtimeHint }));
      } finally {
        setState((s) => ({ ...s, isSaving: false }));
      }
    },
    [
      onSave,
      onClose,
      onMergeSaved,
      openMergeQueueFile,
      mergeQueue,
      mergeSessionBase,
      versionPair.left,
      versionPair.right,
      repoPath,
      filePath,
      aiWorktreePath,
      aiWorktreePathB,
      dualAiMerge,
      hashBase,
      hash2,
      aiProposedEdits,
      uiPolicy.aiDiffPresentation,
    ],
  );

  const handleExplicitSave = useCallback(() => {
    const token = Date.now();
    saveIntentTokenRef.current = token;
    void saveMerge(token);
  }, [saveMerge]);

  const canSaveMerge = useMemo(() => {
    return state.mergeMode && repoPath.trim() !== '' && isRepoRelativeFilePath(filePath);
  }, [state.mergeMode, repoPath, filePath]);

  const mergeSaveTitle = useMemo(() => {
    if (state.isSaving) return 'Saving merge result…';
    if (!canSaveMerge) return 'Save is available only in file-specific merge mode';
    if (state.mergeIntent === 'branch') {
      if (mergeQueue.length > 1 && mergeQueueIndex >= 0 && mergeQueueIndex < mergeQueue.length - 1) {
        return 'Save this file to your branch and continue to the next changed file';
      }
      return 'Save resolved file, complete git merge, and delete the source branch';
    }
    return 'Save merge result to file';
  }, [state.isSaving, state.mergeIntent, canSaveMerge, mergeQueue.length, mergeQueueIndex]);

  const branchWideSaveNotice = useMemo(() => {
    if (!state.mergeMode) return '';
    if (filePath?.trim()) return '';
    return 'Branch-wide merge view is read-only for save. Open a file-specific diff to apply and save merge resolution.';
  }, [state.mergeMode, filePath]);

  const fileDisplayTitle = useMemo(() => {
    const p = filePath?.trim();
    if (!p) return null;
    return p.split('/').pop() ?? p;
  }, [filePath]);

  const navWrapEnabled = uiPolicy.tripleDiffNavBoundaryMode === 'wrap';
  const hasPreviousChange =
    state.diffNavTotal > 0 && (navWrapEnabled ? true : state.diffNavActive > 0);
  const hasNextChange =
    state.diffNavTotal > 0 &&
    (navWrapEnabled ? true : state.diffNavActive < state.diffNavTotal - 1);
  const changeCounter =
    state.diffNavTotal === 0
      ? '0/0'
      : `${state.diffNavActive + 1}/${state.diffNavTotal}`;

  const showMonaco =
    state.blobsReady &&
    !state.blobLoading &&
    filePath?.trim() !== '' &&
    isRepoRelativeFilePath(filePath);

  const leftLabel = versionPair.left ? versionPair.left.slice(0, 12) : 'index';
  const rightLabel = versionPair.right ? versionPair.right.slice(0, 12) : 'working tree';
  const centerMeldTitle = fileDisplayTitle ?? 'Compare';
  const useTwoPaneAiDiff = Boolean(
    hashBase?.trim() &&
    (dualAiMerge || aiProposedEdits) &&
    uiPolicy.aiDiffPresentation !== 'triple',
  );

  // AI sessions with a base revision load the proposal on the right (source / worktree)
  // while merge polarity still marks "left" as preferred — wire bulk actions accordingly.
  const onBulkAcceptAll =
    aiProposedEdits && hashBase?.trim() ? rejectAll : acceptAll;
  const onBulkRejectAll =
    aiProposedEdits && hashBase?.trim() ? acceptAll : rejectAll;

  return (
    <div className="diff-viewer" data-testid="diff-viewer-root">
      <div className="diff-card">
        <DiffToolbar
          title={fileDisplayTitle ?? 'Diff Viewer'}
          changeCounter={changeCounter}
          hasPreviousChange={hasPreviousChange}
          hasNextChange={hasNextChange}
          onPreviousChange={() => jumpToChange(-1)}
          onNextChange={() => jumpToChange(1)}
          mergeMode={state.mergeMode}
          unresolvedCount={0}
          canSave={canSaveMerge}
          isSaving={state.isSaving}
          mergeSaveTitle={mergeSaveTitle}
          mergeIntoFileTitle={MERGE_INTO_FILE_TITLE}
          onMergeIntoFile={startMergeIntoFile}
          onToggleMergeMode={toggleMergeMode}
          showAiBulkActions={uiPolicy.showBulkActions}
          bulkActionTitles={{
            acceptAll: uiPolicy.labels.acceptAllTitle,
            rejectAll: uiPolicy.labels.rejectAllTitle,
          }}
          onAcceptAll={onBulkAcceptAll}
          onRejectAll={onBulkRejectAll}
          onSave={handleExplicitSave}
          onClose={onClose}
          mergeUsesMonacoEditor
          mergeQueueLabel={mergeQueueLabel}
          hasPreviousMergeFile={mergeQueueIndex > 0}
          hasNextMergeFile={mergeQueueIndex >= 0 && mergeQueueIndex < mergeQueue.length - 1}
          onPreviousMergeFile={() => {
            if (mergeQueueIndex > 0) {
              openMergeQueueFile(mergeQueue[mergeQueueIndex - 1]);
            }
          }}
          onNextMergeFile={() => {
            if (mergeQueueIndex >= 0 && mergeQueueIndex < mergeQueue.length - 1) {
              openMergeQueueFile(mergeQueue[mergeQueueIndex + 1]);
            }
          }}
        />

        {state.statusMessage && <div className="diff-status-message">{state.statusMessage}</div>}
        {!state.statusMessage && branchWideSaveNotice !== '' && (
          <div className="diff-status-message">{branchWideSaveNotice}</div>
        )}

        <div className="diff-main-layout diff-main-layout--monaco">
          {showMonaco ? (
            hashBase?.trim() && !useTwoPaneAiDiff ? (
              <Suspense fallback={<div className="diff-monaco-placeholder">Loading merge editor...</div>}>
                {dualAiMerge && uiPolicy.tripleMergePresentation === 'dual-diff' ? (
                  <MonacoTripleDiffEditor
                    ref={monacoTripleDiffRef}
                    leftRefContent={state.leftText}
                    rightRefContent={state.rightText}
                    baseContent={state.baseText}
                    mergeResultContent={state.mergeResultText}
                    languageId={languageId}
                    mergeEditing={state.mergeMode}
                    preferredSide={effectivePreferredSide}
                    leftPaneTitle={leftLabel}
                    rightPaneTitle={rightLabel}
                    mergeResultPaneTitle="Result"
                    navBoundaryMode={uiPolicy.tripleDiffNavBoundaryMode ?? 'clamp'}
                    onResultChange={onMergeResultTextChange}
                    onDiffNavigationMeta={onDiffNavigationMeta}
                  />
                ) : (
                  <MonacoMergePane
                    ref={monacoMergeRef}
                    tripleAiLayout={dualAiMerge}
                    oursContent={state.mergeResultText}
                    baseContent={state.baseText}
                    theirsContent={state.rightText}
                    leftRefContent={state.leftText}
                    rightRefContent={state.rightText}
                    mergeResultContent={state.mergeResultText}
                    languageId={languageId}
                    mergeEditing={state.mergeMode}
                    preferredSide={effectivePreferredSide}
                    leftPaneTitle={leftLabel}
                    basePaneTitle={hashBase?.slice(0, 12) ?? 'base'}
                    rightPaneTitle={rightLabel}
                    mergeResultPaneTitle="Result"
                    onResultChange={onMergeResultTextChange}
                    onDiffNavigationMeta={onDiffNavigationMeta}
                    advancedMergeVisualsEnabled={uiPolicy.advancedMergeVisualsEnabled}
                    mergeDiagnosticsEnabled={uiPolicy.mergeDiagnosticsEnabled}
                    maxDecoratedHunks={uiPolicy.maxDecoratedHunks}
                    navBoundaryMode={uiPolicy.tripleDiffNavBoundaryMode}
                  />
                )}
              </Suspense>
            ) : (
              <Suspense fallback={<div className="diff-monaco-placeholder">Loading diff editor...</div>}>
                <MonacoDiffEditor
                  ref={monacoRef}
                  className="monaco-diff-editor-host"
                  originalText={state.leftText}
                  modifiedText={state.rightText}
                  languageId={languageId}
                  mergeEditing={state.mergeMode}
                  preferredSide={effectivePreferredSide}
                  leftPaneTitle={leftLabel}
                  rightPaneTitle={rightLabel}
                  centerPaneTitle={centerMeldTitle}
                  leftPaneTitleAttr={versionPair.left || 'index'}
                  rightPaneTitleAttr={versionPair.right || 'working tree'}
                  activeDiffHunkIndex={state.diffNavActive}
                  onDiffNavigationMeta={onDiffNavigationMeta}
                />
              </Suspense>
            )
          ) : (
            <div className="diff-monaco-placeholder">
              {state.blobLoading ? 'Loading…' : state.statusMessage ? '' : 'No diff content'}
            </div>
          )}
        </div>

        <BranchMergeDialog
          open={state.showBranchMergeDialog}
          repoPath={repoPath}
          onApply={onBranchDialogApply}
          onCancel={() => setState((s) => ({ ...s, showBranchMergeDialog: false }))}
        />
      </div>
    </div>
  );
};

export default DiffViewer;
