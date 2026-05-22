/**
 * Main Version Control Tab Component
 */

import React, { useState, useCallback, useContext, useEffect } from 'react';
import { useGitTab } from './hooks/useGitTab';
import { GitStateNotice } from './components/GitStateNotice';
import { GitStatusSection } from './components/GitStatusSection';
import { DocumentDropdown } from './components/DocumentDropdown';
import { BranchSection } from './components/BranchSection';
import { CommitGraphHost } from './components/CommitGraphHost';
import { FileExplorerContext } from '../explorer/FileExplorerContext';
import { useDiffViewer } from '../../shared/contexts/DiffViewerContext';
import {
  COMMIT_MESSAGE_PALETTE_CONFIRM_EVENT,
  OPEN_COMMIT_MESSAGE_PALETTE_EVENT,
  type CommitMessagePaletteConfirmDetail,
} from '../palette/commitMessagePaletteEvents';
import {
  PALETTE_ACTION_EVENT,
  type PaletteActionEventDetail,
} from '../palette/paletteActionEvents';
import { setPalettePrereqs } from '../palette/palettePrereqStore';
import { WORKSPACE_FILE_SAVED_EVENT } from '../../shared/utils/workspaceFileSavedEvents';
import './VersionControlTab.css';

function normalizeRepoRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function resolveAbsoluteFilePath(repoPath: string, relativeFilePath: string): string {
  const base = repoPath.replace(/[\\/]+$/, '');
  const normalizedRel = relativeFilePath.replace(/^\.?[\\/]+/, '');
  const separator = base.includes('\\') ? '\\' : '/';
  return `${base}${separator}${normalizedRel.replace(/[\\/]/g, separator)}`;
}

function toRepoRelativePath(repoPath: string, absolutePath: string): string {
  const repoNorm = repoPath.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const absNorm = absolutePath.replace(/\\/g, '/');
  if (repoNorm === '' || absNorm === '') return '';
  if (absNorm === repoNorm) return '';
  const repoPrefix = `${repoNorm}/`;
  if (!absNorm.startsWith(repoPrefix)) {
    return '';
  }
  return absNorm.slice(repoPrefix.length);
}

const VersionControlTab: React.FC = () => {
  const gitTab = useGitTab();
  const diffViewer = useDiffViewer();
  const [documentInputText, setDocumentInputText] = useState('');
  const [isDocumentDropdownOpen, setIsDocumentDropdownOpen] = useState(false);

  // Get workspace root from FileExplorer context
  const fileExplorerContext = useContext(FileExplorerContext);
  const workspaceRoot = fileExplorerContext?.rootPath || '';

  // Update repo path when workspace changes
  useEffect(() => {
    if (workspaceRoot && gitTab.repoPath !== workspaceRoot) {
      gitTab.setRepoPath(workspaceRoot);
    }
  }, [workspaceRoot, gitTab.repoPath, gitTab.setRepoPath]);

  // Perform initial check when repo path changes
  useEffect(() => {
    if (gitTab.repoPath) {
      gitTab.checkRepo();
      gitTab.refreshGithubStatus();
    }
  }, [gitTab.repoPath, gitTab.checkRepo, gitTab.refreshGithubStatus]);

  // Save version: commit message is entered in the command palette
  const handleSaveVersion = useCallback((): void => {
    window.dispatchEvent(new CustomEvent(OPEN_COMMIT_MESSAGE_PALETTE_EVENT));
  }, []);

  useEffect(() => {
    const onCommitMessageConfirm = (e: Event): void => {
      const ce = e as CustomEvent<CommitMessagePaletteConfirmDetail>;
      const message = ce.detail?.message ?? '';
      void gitTab.saveVersion(message);
    };
    window.addEventListener(COMMIT_MESSAGE_PALETTE_CONFIRM_EVENT, onCommitMessageConfirm);
    return () =>
      window.removeEventListener(COMMIT_MESSAGE_PALETTE_CONFIRM_EVENT, onCommitMessageConfirm);
  }, [gitTab.saveVersion]);

  useEffect(() => {
    const onWorkspaceFileSaved = (): void => {
      gitTab.setSaveVersionMessage('');
      void gitTab.refreshStatus();
    };
    window.addEventListener(WORKSPACE_FILE_SAVED_EVENT, onWorkspaceFileSaved);
    return () => window.removeEventListener(WORKSPACE_FILE_SAVED_EVENT, onWorkspaceFileSaved);
  }, [gitTab.refreshStatus, gitTab.setSaveVersionMessage]);

  useEffect(() => {
    const selectedAbsolute = fileExplorerContext?.selectedFile ?? '';
    const repoPath = gitTab.providerRepoPath().trim();
    if (selectedAbsolute.trim() === '' || repoPath === '') {
      return;
    }
    const nextDocument = toRepoRelativePath(repoPath, selectedAbsolute);
    if (nextDocument === '' || nextDocument === gitTab.selectedDocument) {
      return;
    }
    gitTab.setSelectedDocument(nextDocument);
    setDocumentInputText('');
    setIsDocumentDropdownOpen(false);
    gitTab.setSelectedCommitHashes([]);
    void gitTab.refreshFileLog(nextDocument);
    void gitTab.refreshBranches(nextDocument);
  }, [
    fileExplorerContext?.selectedFile,
    gitTab,
    gitTab.providerRepoPath,
    gitTab.refreshBranches,
    gitTab.refreshFileLog,
    gitTab.selectedDocument,
    gitTab.setSelectedCommitHashes,
    gitTab.setSelectedDocument,
  ]);

  // Handle GitHub sign in
  const handleGithubSignIn = useCallback(async () => {
    // Will implement full flow in phase 2
  }, []);

  // Handle GitHub sign out
  const handleGithubSignOut = useCallback(async () => {
    // Will implement in phase 2
  }, []);

  // Handle document selection
  const handleDocumentSelect = useCallback(
    async (path: string) => {
      gitTab.setSelectedDocument(path);
      setIsDocumentDropdownOpen(false);
      setDocumentInputText('');
      await gitTab.refreshFileLog(path);
      await gitTab.refreshBranches(path);
    },
    [gitTab.setSelectedDocument, gitTab.refreshFileLog, gitTab.refreshBranches],
  );

  // Handle dropdown open/close
  const handleDocumentInputFocus = useCallback(() => {
    setIsDocumentDropdownOpen(true);
  }, []);

  const handleDocumentInputBlur = useCallback(() => {
    setIsDocumentDropdownOpen(false);
  }, []);

  const handleDocumentCaretClick = useCallback(() => {
    setIsDocumentDropdownOpen(true);
  }, []);

  const handleDocumentKeyDown = useCallback((event: React.KeyboardEvent) => {
    // Additional keyboard handling if needed
    if (event.key === 'Escape') {
      setIsDocumentDropdownOpen(false);
    }
  }, []);

  const handleDocumentInputChange = useCallback((text: string) => {
    setDocumentInputText(text);
    setIsDocumentDropdownOpen(true);
  }, []);

  const handleOpenDiff = useCallback(() => {
    const repoPath = gitTab.providerRepoPath();
    const filePath = gitTab.selectedDocument;
    if (repoPath.trim() === '' || filePath.trim() === '') return;

    const pick = gitTab.selectedCommitHashes;
    let hash1 = '';
    let hash2 = '';
    if (pick.length === 2 && pick[0] !== pick[1]) {
      hash1 = pick[0] ?? '';
      hash2 = pick[1] ?? '';
    } else if (gitTab.fileLogEntries.length >= 2) {
      hash1 = gitTab.fileLogEntries[1]?.hash ?? '';
      hash2 = gitTab.fileLogEntries[0]?.hash ?? '';
    }
    if (hash1.trim() === '' || hash2.trim() === '') return;

    diffViewer.openDiff({ repoPath, filePath, hash1, hash2 });
  }, [
    diffViewer,
    gitTab,
    gitTab.fileLogEntries,
    gitTab.providerRepoPath,
    gitTab.selectedCommitHashes,
    gitTab.selectedDocument,
  ]);

  const openHistoryPreviewForHash = useCallback(
    async (hash: string) => {
      const repoPath = gitTab.providerRepoPath();
      const filePath = gitTab.selectedDocument;
      if (repoPath.trim() === '' || filePath.trim() === '') return;
      const invoke = window.electronAPI?.invoke;
      if (typeof invoke !== 'function') {
        gitTab.setGitHistoryGraphError('Cannot open history preview (Electron bridge unavailable).');
        return;
      }
      const normalizedHash = hash.trim();
      if (normalizedHash === '') return;
      const raw = await invoke('git-provider', {
        command: 'git-show-file',
        repoPath,
        revision: normalizedHash,
        filePath: normalizeRepoRelativePath(filePath),
      });
      const result = raw as { ok?: boolean; content?: string; reason?: string; error?: string };
      if (result?.ok === true && typeof result.content === 'string') {
        const absolutePath = resolveAbsoluteFilePath(repoPath, filePath);
        fileExplorerContext?.selectFile?.(absolutePath);
        gitTab.setGitHistoryGraphError('');
        diffViewer.openHistoryPreview({
          repoPath,
          filePath,
          absolutePath,
          hash: normalizedHash,
          content: result.content,
        });
        return;
      }
      if (result?.reason === 'not_found') {
        gitTab.setGitHistoryGraphError(
          'This file did not exist at the selected commit, so no snapshot is available.',
        );
        return;
      }
      if (result?.reason === 'binary_or_decode_error') {
        gitTab.setGitHistoryGraphError(
          'Cannot preview this revision because the file is binary or not text-decodable.',
        );
        return;
      }
      gitTab.setGitHistoryGraphError(
        typeof result?.error === 'string' ? result.error : 'Failed to open document snapshot.',
      );
    },
    [
      diffViewer,
      fileExplorerContext,
      gitTab,
      gitTab.providerRepoPath,
      gitTab.selectedDocument,
    ],
  );

  const handleCommitActivate = useCallback(
    (hash: string) => {
      const repoPath = gitTab.providerRepoPath();
      const filePath = gitTab.selectedDocument;
      if (repoPath.trim() === '' || filePath.trim() === '') {
        gitTab.onCommitGraphActivate(hash);
        return;
      }

      const normalizedHash = hash.trim();
      if (normalizedHash === '') {
        return;
      }
      const previousSelection = gitTab.selectedCommitHashes.filter(Boolean).slice(-2);
      let next: string[] = [normalizedHash];
      if (previousSelection.length === 1) {
        const only = previousSelection[0] ?? '';
        next = only !== '' && only !== normalizedHash ? [only, normalizedHash] : [normalizedHash];
      } else if (previousSelection.length === 2) {
        const first = previousSelection[0] ?? '';
        const second = previousSelection[1] ?? '';
        if (normalizedHash === first || normalizedHash === second) {
          // Re-selecting either selected cell should collapse to single-cell snapshot mode.
          next = [normalizedHash];
        } else {
          // Keep a rolling distinct pair using the most recent previous selection.
          next = [second, normalizedHash];
        }
      }
      gitTab.setSelectedCommitHashes(next);
      if (next.length === 2) {
        diffViewer.openDiff({
          repoPath,
          filePath,
          hash1: next[0] as string,
          hash2: next[1] as string,
        });
        return;
      }
      void openHistoryPreviewForHash(next[0] as string);
    },
    [
      diffViewer,
      gitTab,
      openHistoryPreviewForHash,
      gitTab.providerRepoPath,
      gitTab.selectedCommitHashes,
      gitTab.selectedDocument,
    ],
  );

  const refreshBranchesHistoryAndStatus = useCallback(async () => {
    await Promise.all([
      gitTab.refreshBranches(),
      gitTab.refreshFileLog(),
      gitTab.refreshStatus(),
    ]);
  }, [gitTab.refreshBranches, gitTab.refreshFileLog, gitTab.refreshStatus]);

  useEffect(() => {
    setPalettePrereqs({
      gitIsRepo: gitTab.isRepo,
      gitRepoPathEmpty: gitTab.repoPath === '',
      gitIsBusy: gitTab.isBusy,
      gitSelectedDocument: gitTab.selectedDocument,
    });
  }, [gitTab.isRepo, gitTab.repoPath, gitTab.isBusy, gitTab.selectedDocument]);

  useEffect(() => {
    const onPalette = (ev: Event): void => {
      const ce = ev as CustomEvent<PaletteActionEventDetail>;
      const kind = ce.detail?.action.kind;
      if (kind === 'git.refreshStatus') {
        void gitTab.refreshStatus();
        return;
      }
      if (kind === 'git.refreshLog') {
        void gitTab.refreshLog();
        return;
      }
      if (kind === 'git.refreshBranchesAndHistory') {
        void refreshBranchesHistoryAndStatus();
        return;
      }
      if (kind === 'git.initRepo') {
        void gitTab.initRepo();
        return;
      }
      if (kind === 'git.recheckRepo') {
        void gitTab.checkRepo();
      }
    };
    window.addEventListener(PALETTE_ACTION_EVENT, onPalette as EventListener);
    return () => window.removeEventListener(PALETTE_ACTION_EVENT, onPalette as EventListener);
  }, [gitTab, refreshBranchesHistoryAndStatus]);

  // Determine current state
  const state = gitTab.repoPath === '' ? 'no-workspace' : !gitTab.isRepo ? 'non-repo' : 'ready';

  return (
    <div id="sidebar-git">
      <div className="git-tab-viewer">
      {state === 'no-workspace' && (
        <GitStateNotice state="no-workspace" />
      )}

      {state === 'non-repo' && (
        <GitStateNotice
          state="non-repo"
          onInitRepo={gitTab.initRepo}
          disabled={gitTab.isBusy}
        />
      )}

      {state === 'ready' && (
        <>
          {/* Status Section */}
          <GitStatusSection
            statusEntries={gitTab.statusEntries}
            githubAuthStatus={gitTab.githubAuthStatus}
            isBusy={gitTab.isBusy}
            githubFlowBusy={gitTab.githubFlowBusy}
            remoteSyncError={gitTab.remoteSyncError}
            remoteSyncHint={gitTab.remoteSyncHint}
            saveVersionMessage={gitTab.saveVersionMessage}
            githubAuthFlowMessage={gitTab.githubAuthFlowMessage}
            githubDeviceUserCode={gitTab.githubDeviceUserCode}
            showGithubSignInUi={gitTab.showGithubSignInUi}
            onSaveVersion={handleSaveVersion}
            onGithubSignIn={handleGithubSignIn}
            onGithubSignOut={handleGithubSignOut}
          />

          {/* Document Dropdown */}
          <DocumentDropdown
            trackedFiles={gitTab.trackedFiles}
            selectedDocument={gitTab.selectedDocument}
            documentInputText={documentInputText}
            isDropdownOpen={isDocumentDropdownOpen}
            onDocumentSelect={handleDocumentSelect}
            onInputChange={handleDocumentInputChange}
            onFocus={handleDocumentInputFocus}
            onBlur={handleDocumentInputBlur}
            onKeyDown={handleDocumentKeyDown}
            onCaretClick={handleDocumentCaretClick}
          />

          {/* Branches and History Scroll (when document selected) */}
          {gitTab.selectedDocument !== '' ? (
            <div
              className="git-repo-history-scroll"
              role="region"
              aria-label="Branches and commit history"
              data-testid="git-repo-history-scroll"
            >
              <BranchSection
                branchError={gitTab.branchError}
                isBusy={gitTab.isBusy}
                isGitRefreshBusy={gitTab.isGitRefreshBusy}
                isRemoteSyncBusy={gitTab.isRemoteSyncBusy}
                fileLogCount={gitTab.fileLogEntries.length}
                onOpenDiff={handleOpenDiff}
              />

              <section
                className="git-section git-commit-graph-section"
                data-testid="git-commit-graph-section"
              >
                <h2>History</h2>
                {gitTab.fileScopedLogError && (
                  <p className="git-graph-error" role="alert">
                    {gitTab.fileScopedLogError}
                  </p>
                )}
                {gitTab.gitHistoryGraphError && (
                  <p className="git-graph-error" role="status">
                    {gitTab.gitHistoryGraphError}
                  </p>
                )}
                <div role="region" aria-label="Commit history graph" data-testid="git-commit-graph-host">
                  <CommitGraphHost
                    commits={gitTab.fileLogEntries}
                    graphContext={gitTab.fileLogGraphContext}
                    selectedHashes={gitTab.selectedCommitHashes}
                    onCommitActivate={handleCommitActivate}
                    setGitHistoryGraphError={gitTab.setGitHistoryGraphError}
                  />
                </div>
              </section>
            </div>
          ) : (
            <p className="dim" data-testid="git-document-required">
              Select a document to view branches and history.
            </p>
          )}
        </>
      )}
      </div>
    </div>
  );
};

export default VersionControlTab;
