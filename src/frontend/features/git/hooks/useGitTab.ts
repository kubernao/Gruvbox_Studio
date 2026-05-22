/**
 * Main hook for Git tab state management
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  GitStatusEntry,
  GitLogEntry,
  GitBranchListRow,
  GitRemoteListRow,
  GithubTabAuthState,
  GithubAuthStatusInvokePayload,
} from '../types/git';
import {
  readGitProviderError,
  isGitProviderGitLogEntryRow,
  normalizeGitStatusInvokeResult,
  normalizeGitLogEntry,
} from '../utils/gitProviderUtils';
import {
  buildGitLogFileGraphContext,
  remotesIncludeGithub,
  GRUVBOX_BRANCH_PALETTE,
} from '../utils/gitGraphUtils';
import type { GitLogFileGraphContext } from '../utils/gitTabGraphBranchColors';
import type { GraphEdgeConnectivity } from '../utils/gitTabGraphModel';
import {
  runGitTabRepoCheckRefreshSteps,
  verifyGitRepositoryAndResolveRoot,
} from '../gitTabRepoCheck';

/**
 * Return the Electron IPC `invoke` function, or `undefined` when running
 * outside an Electron renderer (e.g., unit tests or Storybook where
 * `window` is undefined or `electronAPI` is not injected by the preload).
 */
function getElectronInvoke():
  | ((channel: string, ...args: unknown[]) => Promise<unknown>)
  | undefined {
  if (typeof window === 'undefined') return undefined;
  const invoke = window.electronAPI?.invoke;
  return typeof invoke === 'function' ? invoke : undefined;
}

export function useGitTab() {
  // Repo state
  const [isRepo, setIsRepo] = useState(false);
  const [gitWorkTreeRoot, setGitWorkTreeRoot] = useState('');
  const [repoPath, setRepoPath] = useState('');

  // Status and log state
  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[]>([]);
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [trackedFiles, setTrackedFiles] = useState<string[]>([]);

  // File/document state
  const [selectedDocument, setSelectedDocument] = useState('');
  const [fileLogEntries, setFileLogEntries] = useState<GitLogEntry[]>([]);

  // Branch state
  const [gitBranches, setGitBranches] = useState<GitBranchListRow[]>([]);
  const [gitRemotes, setGitRemotes] = useState<GitRemoteListRow[]>([]);

  // GitHub auth state
  const [githubAuthStatus, setGithubAuthStatus] = useState<GithubTabAuthState>({
    connected: false,
    login: '',
    encryptionAvailable: true,
  });

  // UI state
  const [isBusy, setIsBusy] = useState(false);
  const [isGitRefreshBusy, setIsGitRefreshBusy] = useState(false);
  const [isRemoteSyncBusy, setIsRemoteSyncBusy] = useState(false);
  const [repoWideLogError, setRepoWideLogError] = useState('');
  const [fileScopedLogError, setFileScopedLogError] = useState('');
  const [branchError, setBranchError] = useState('');
  const [gitHistoryGraphError, setGitHistoryGraphError] = useState('');
  /** Rolling window of last activated commit hashes (for graph dot selection). */
  const [selectedCommitHashes, setSelectedCommitHashes] = useState<string[]>([]);

  // GitHub flow state
  const [githubAuthFlowMessage, setGithubAuthFlowMessage] = useState('');
  const [githubDeviceUserCode, setGithubDeviceUserCode] = useState('');
  const [githubFlowBusy, setGithubFlowBusy] = useState(false);
  const [remoteSyncError, setRemoteSyncError] = useState('');
  const [remoteSyncHint, setRemoteSyncHint] = useState('');
  const [saveVersionMessage, setSaveVersionMessage] = useState('');

  // Helpers
  const providerRepoPath = useCallback(() => {
    return gitWorkTreeRoot !== '' ? gitWorkTreeRoot : repoPath;
  }, [gitWorkTreeRoot, repoPath]);

  const [fileLogGraphContext, setFileLogGraphContext] =
    useState<GitLogFileGraphContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    const connectivity: GraphEdgeConnectivity = 'nextRowWhenNoDisplayedParents';

    (async () => {
      if (fileLogEntries.length === 0) {
        setFileLogGraphContext(null);
        return;
      }
      const invoke = getElectronInvoke();
      if (invoke) {
        try {
          const raw = await invoke('rust:buildCommitGraph', {
            entries: fileLogEntries,
            connectivity,
            palette: [...GRUVBOX_BRANCH_PALETTE],
          });
          if (cancelled) return;
          if (raw === null) {
            setFileLogGraphContext(null);
            return;
          }
          const r = raw as {
            templateSignature: string;
            templateBranchColors: string[];
            displayByHash: Array<{ hash: string; branch: string }>;
            branchColorByName: Array<{ name: string; color: string }>;
            badgeRefsByHash: Array<{ hash: string; refs: string[] }>;
            graphEdgeConnectivity: string;
          };
          setFileLogGraphContext({
            templateSignature: r.templateSignature,
            templateBranchColors: r.templateBranchColors,
            displayByHash: new Map(r.displayByHash.map((e) => [e.hash, e.branch])),
            branchColorByNameMap: new Map(
              r.branchColorByName.map((e) => [e.name, e.color]),
            ),
            badgeRefsByHash: new Map(r.badgeRefsByHash.map((e) => [e.hash, e.refs])),
            graphEdgeConnectivity: r.graphEdgeConnectivity as GraphEdgeConnectivity,
          });
        } catch {
          if (!cancelled) {
            setFileLogGraphContext(
              buildGitLogFileGraphContext(fileLogEntries, GRUVBOX_BRANCH_PALETTE, {
                graphEdgeConnectivity: connectivity,
              }),
            );
          }
        }
      } else {
        setFileLogGraphContext(
          buildGitLogFileGraphContext(fileLogEntries, GRUVBOX_BRANCH_PALETTE, {
            graphEdgeConnectivity: connectivity,
          }),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileLogEntries]);

  const gitBranchPickerColorByName = useMemo(() => {
    const m = fileLogGraphContext?.branchColorByNameMap;
    if (m === undefined) return new Map<string, string>();
    return m instanceof Map ? m : new Map(m);
  }, [fileLogGraphContext]);

  const onCommitGraphActivate = useCallback((hash: string) => {
    const h = hash.trim();
    if (h === '') return;
    setSelectedCommitHashes((prev) => [...prev, h].slice(-2));
  }, []);
  const hasGithubRemote = remotesIncludeGithub(gitRemotes);
  const showPublishToGithubButton =
    githubAuthStatus.connected && isRepo && repoPath !== '' && !hasGithubRemote;

  const showGithubSignInUi =
    !githubAuthStatus.connected &&
    githubAuthStatus.encryptionAvailable &&
    githubAuthStatus.reason !== 'no_encryption' &&
    githubAuthStatus.reason !== 'not_configured';

  // IPC invoke helper
  const invokeGitProvider = useCallback(
    async (command: string, payload: Record<string, any> = {}) => {
      const invoke = getElectronInvoke();
      if (!invoke) {
        console.warn('[GitTab] electronAPI.invoke is not available');
        return null;
      }
      try {
        return await invoke('git-provider', {
          command,
          repoPath: providerRepoPath(),
          ...payload,
        });
      } catch (err) {
        console.error(`[GitTab] git-provider ${command}:`, err);
        return null;
      }
    },
    [providerRepoPath],
  );

  // GitHub status refresh
  const refreshGithubStatus = useCallback(async () => {
    const invoke = getElectronInvoke();
    if (!invoke) {
      return;
    }
    try {
      const s = (await invoke('github-git-auth-provider', {
        command: 'get-status',
        payload: {},
      })) as GithubAuthStatusInvokePayload;
      if (s.connected === true && typeof s.login === 'string') {
        setGithubAuthStatus({
          connected: true,
          login: s.login,
          encryptionAvailable: true,
        });
      } else {
        const reason =
          s.reason === 'not_configured' ||
          s.reason === 'no_encryption' ||
          s.reason === 'signed_out'
            ? s.reason
            : undefined;
        setGithubAuthStatus({
          connected: false,
          login: '',
          encryptionAvailable:
            typeof s.encryptionAvailable === 'boolean' ? s.encryptionAvailable : true,
          reason,
        });
      }
    } catch (err) {
      console.error('[GitTab] refreshGithubStatus:', err);
    }
  }, []);

  // Git status refresh
  const refreshStatus = useCallback(async () => {
    if (repoPath === '' || !isRepo) return;
    const result = await invokeGitProvider('git-status');
    setStatusEntries(normalizeGitStatusInvokeResult(result));
    if (!Array.isArray(result) && typeof result === 'object' && result !== null && 'error' in result) {
      console.warn('[GitTab] git-status failed:', (result as { error: string }).error);
    }
  }, [repoPath, isRepo, invokeGitProvider]);

  // Git log refresh
  const refreshLog = useCallback(async () => {
    if (repoPath === '' || !isRepo) return;
    setRepoWideLogError('');
    const result = await invokeGitProvider('git-log');
    if (Array.isArray(result)) {
      setLogEntries(
        result.filter(isGitProviderGitLogEntryRow).map(normalizeGitLogEntry),
      );
      return;
    }
    const err = readGitProviderError(result);
    setRepoWideLogError(err ?? 'Could not load repository history.');
    setLogEntries([]);
  }, [repoPath, isRepo, invokeGitProvider]);

  // Tracked files refresh
  const refreshTrackedFiles = useCallback(async () => {
    if (repoPath === '' || !isRepo) return;
    const result = await invokeGitProvider('git-tracked-files');
    if (Array.isArray(result)) {
      const files = result.filter((x): x is string => typeof x === 'string').sort((a, b) => a.localeCompare(b));
      setTrackedFiles(files);
    } else {
      setTrackedFiles([]);
    }
  }, [repoPath, isRepo, invokeGitProvider]);

  // File log refresh
  const refreshFileLog = useCallback(
    async (filePathOverride?: string) => {
      const filePath = filePathOverride ?? selectedDocument;
      if (repoPath === '' || !isRepo || filePath === '') {
        setFileLogEntries([]);
        setFileScopedLogError('');
        return;
      }
      setFileScopedLogError('');
      const result = await invokeGitProvider('git-log-file', { filePath });
      if (Array.isArray(result)) {
        setFileLogEntries(
          result.filter(isGitProviderGitLogEntryRow).map(normalizeGitLogEntry),
        );
        return;
      }
      const err = readGitProviderError(result);
      setFileScopedLogError(err ?? 'Could not load history for this document.');
      setFileLogEntries([]);
    },
    [repoPath, isRepo, selectedDocument, invokeGitProvider],
  );

  // Branches refresh
  const refreshBranches = useCallback(
    async (filePathOverride?: string) => {
      setBranchError('');
      const filePath = filePathOverride ?? selectedDocument;
      if (repoPath === '' || !isRepo || filePath.trim() === '') {
        setGitBranches([]);
        return;
      }
      const br = await invokeGitProvider('git-branch-list-for-file', { filePath });
      const brErr = readGitProviderError(br);
      if (brErr != null) {
        setBranchError(brErr);
        setGitBranches([]);
        return;
      }
      if (br != null && typeof br === 'object' && Array.isArray((br as { branches: unknown }).branches)) {
        setGitBranches((br as { branches: GitBranchListRow[] }).branches);
      } else {
        setGitBranches([]);
      }
    },
    [repoPath, isRepo, selectedDocument, invokeGitProvider],
  );

  // Git remotes refresh
  const refreshGitRemotes = useCallback(async () => {
    if (repoPath === '' || !isRepo) {
      setGitRemotes([]);
      return;
    }
    const raw = await invokeGitProvider('git-remote-list');
    const err = readGitProviderError(raw);
    if (err != null) {
      setGitRemotes([]);
      console.warn('[GitTab] git-remote-list:', err);
      return;
    }
    if (raw != null && typeof raw === 'object' && Array.isArray((raw as { remotes?: unknown }).remotes)) {
      setGitRemotes((raw as { remotes: GitRemoteListRow[] }).remotes);
    } else {
      setGitRemotes([]);
    }
  }, [repoPath, isRepo, invokeGitProvider]);

  // Check repo
  const checkRepo = useCallback(async () => {
    if (repoPath === '') {
      setIsRepo(false);
      return;
    }
    try {
      const { isGitRepo, resolvedWorkTreeRoot } =
        await verifyGitRepositoryAndResolveRoot(invokeGitProvider, repoPath);
      setIsRepo(isGitRepo);
      if (!isGitRepo) {
        setGitRemotes([]);
        return;
      }
      setGitWorkTreeRoot(resolvedWorkTreeRoot ?? repoPath);
      await runGitTabRepoCheckRefreshSteps(selectedDocument, {
        refreshStatus,
        refreshLog,
        refreshTrackedFiles,
        refreshGitRemotes,
        refreshFileLog,
        refreshBranches,
      });
    } catch (e) {
      setIsRepo(false);
    }
  }, [repoPath, selectedDocument, invokeGitProvider, refreshStatus, refreshLog, refreshTrackedFiles, refreshGitRemotes, refreshFileLog, refreshBranches]);

  // Init repo
  const initRepo = useCallback(async () => {
    if (repoPath === '') {
      return;
    }
    setIsBusy(true);
    try {
      const result = await invokeGitProvider('git-init');
      const err = readGitProviderError(result);
      if (err) {
        return;
      }
      await checkRepo();
    } catch (e) {
      // Init failed
    } finally {
      setIsBusy(false);
    }
  }, [repoPath, invokeGitProvider, checkRepo]);

  const deleteBranch = useCallback(
    async (branchName: string) => {
      if (repoPath === '' || !isRepo) {
        setBranchError('No git repository is open in this workspace.');
        return;
      }
      if (selectedDocument.trim() === '') {
        setBranchError('Select a document in the Version Control tab before deleting a branch.');
        return;
      }
      const name = branchName.trim();
      if (!name) return;
      setBranchError('');
      setIsBusy(true);
      try {
        const result = await invokeGitProvider('git-branch-delete', { branchName: name });
        const err = readGitProviderError(result);
        if (err) {
          setBranchError(err);
          return;
        }
        await Promise.all([refreshBranches(), refreshLog(), refreshFileLog(), refreshStatus()]);
      } finally {
        setIsBusy(false);
      }
    },
    [
      repoPath,
      isRepo,
      selectedDocument,
      invokeGitProvider,
      refreshBranches,
      refreshLog,
      refreshFileLog,
      refreshStatus,
    ],
  );

  const saveVersion = useCallback(
    async (message: string) => {
      if (repoPath === '' || !isRepo) {
        const error = 'No git repository is open in this workspace.';
        setSaveVersionMessage(error);
        return { ok: false, error };
      }
      const commitMessage = message.trim();
      if (commitMessage === '') {
        const error = 'Commit message cannot be empty.';
        setSaveVersionMessage(error);
        return { ok: false, error };
      }

      setIsBusy(true);
      setSaveVersionMessage('');
      try {
        const result = await invokeGitProvider('git-commit-all', { message: commitMessage });
        if (
          result !== null &&
          typeof result === 'object' &&
          'noChanges' in result &&
          (result as { noChanges?: boolean }).noChanges === true
        ) {
          const msg = 'No changes to commit.';
          setSaveVersionMessage(msg);
          return { ok: false, noChanges: true, message: msg };
        }
        const err = readGitProviderError(result);
        if (err) {
          setSaveVersionMessage(err);
          return { ok: false, error: err };
        }

        const shortHash =
          result !== null &&
          typeof result === 'object' &&
          'hash' in result &&
          typeof (result as { hash?: unknown }).hash === 'string'
            ? (result as { hash: string }).hash
            : '';
        const msg = shortHash !== '' ? `Saved version ${shortHash}.` : 'Saved version.';
        setSaveVersionMessage(msg);

        await Promise.all([refreshStatus(), refreshLog(), refreshTrackedFiles()]);
        if (selectedDocument !== '') {
          await refreshFileLog(selectedDocument);
          await refreshBranches(selectedDocument);
        }
        return { ok: true, hash: shortHash, message: msg };
      } finally {
        setIsBusy(false);
      }
    },
    [
      repoPath,
      isRepo,
      invokeGitProvider,
      refreshStatus,
      refreshLog,
      refreshTrackedFiles,
      selectedDocument,
      refreshFileLog,
      refreshBranches,
    ],
  );

  return {
    // State
    isRepo,
    gitWorkTreeRoot,
    repoPath,
    statusEntries,
    logEntries,
    trackedFiles,
    selectedDocument,
    fileLogEntries,
    gitBranches,
    gitRemotes,
    githubAuthStatus,
    isBusy,
    isGitRefreshBusy,
    isRemoteSyncBusy,
    repoWideLogError,
    fileScopedLogError,
    branchError,
    gitHistoryGraphError,
    githubAuthFlowMessage,
    githubDeviceUserCode,
    githubFlowBusy,
    remoteSyncError,
    remoteSyncHint,
    saveVersionMessage,
    fileLogGraphContext,
    gitBranchPickerColorByName,
    selectedCommitHashes,
    hasGithubRemote,
    showPublishToGithubButton,
    showGithubSignInUi,

    // Setters
    setIsRepo,
    setGitWorkTreeRoot,
    setRepoPath,
    setStatusEntries,
    setLogEntries,
    setTrackedFiles,
    setSelectedDocument,
    setFileLogEntries,
    setGitBranches,
    setGitRemotes,
    setGithubAuthStatus,
    setIsBusy,
    setIsGitRefreshBusy,
    setIsRemoteSyncBusy,
    setRepoWideLogError,
    setFileScopedLogError,
    setBranchError,
    setGitHistoryGraphError,
    setSelectedCommitHashes,
    setGithubAuthFlowMessage,
    setGithubDeviceUserCode,
    setGithubFlowBusy,
    setRemoteSyncError,
    setRemoteSyncHint,
    setSaveVersionMessage,

    // Methods
    providerRepoPath,
    invokeGitProvider,
    refreshGithubStatus,
    refreshStatus,
    refreshLog,
    refreshTrackedFiles,
    refreshFileLog,
    refreshBranches,
    refreshGitRemotes,
    initRepo,
    checkRepo,
    deleteBranch,
    saveVersion,
    onCommitGraphActivate,
  };
}
