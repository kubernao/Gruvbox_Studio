import React, { createContext, useState, useCallback, useEffect } from 'react';
import { FileExplorerContextType, FileTreeNode } from './types';
import { IPCService, FileInfo } from '../../shared/utils/ipc';
import { fileNameFromPath } from '../../shared/utils/pathParts';
import { hasPathSeparator, isSamePath, isSelfOrDescendantPath } from './pathValidation';
import { useToast } from '../../shared/hooks/useToast';
import { recordRecentWorkspace } from '../editor/recentWorkspaces';
import { dispatchDocumentRepoint, dispatchFileDeleted } from '../editor/workspaceFileOpsEvents';

export const FileExplorerContext = createContext<FileExplorerContextType | undefined>(undefined);

interface FileExplorerProviderProps {
  children: React.ReactNode;
}

/**
 * Determines whether a directory entry should be hidden from the file manager tree.
 * The explorer intentionally keeps operational metadata folders out of view so users
 * do not accidentally edit repository internals while navigating project content.
 * This rule is path-agnostic and applies at every tree depth to ensure `.git` and
 * `.gruvbox` are consistently hidden whenever they are present.
 */
function shouldHideExplorerEntry(fileInfo: FileInfo): boolean {
  if (!fileInfo?.is_directory) {
    return false;
  }
  return fileInfo.name === '.git' || fileInfo.name === '.gruvbox';
}

/**
 * Detect a stuck git operation (merge, rebase, cherry-pick, revert, bisect) in the
 * project root and surface a warning toast. Runs after the project is loaded so the
 * user is nudged to resolve or abort before starting any AI work that would otherwise
 * fail with confusing "another git operation is already in progress" errors deep
 * inside the merge save flow. Best-effort only: any failure is silently ignored so a
 * non-git folder or transient IPC issue cannot block the project from opening.
 */
/**
 * After a rename or move, if the path that changed was the folder currently open as the explorer
 * root, React state must point at the new absolute path. Otherwise the next refresh still calls
 * listDirectory on the old location, which no longer exists on disk and produces IPC failures whose
 * messages may only repeat the stale path.
 *
 * @param rootPath - Active explorer root from state, or null when no folder is open.
 * @param sourcePath - Absolute path of the entry that was renamed or moved.
 * @param nextRootPath - Absolute path of that entry after the operation.
 * @param setRootPath - Same loader used when the user picks a folder to open.
 * @returns Whether the explorer root was repointed (caller should skip an ordinary refresh).
 */
async function syncExplorerRootAfterRootEntryMoved(
  rootPath: string | null,
  sourcePath: string,
  nextRootPath: string,
  setRootPath: (path: string) => Promise<void>,
): Promise<boolean> {
  if (!rootPath || !isSamePath(sourcePath, rootPath)) {
    return false;
  }
  await setRootPath(nextRootPath);
  return true;
}

async function warnIfStuckGitOperation(
  rootPath: string,
  showWarning: (message: string, duration?: number) => string,
): Promise<void> {
  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    const invoke = api?.invoke;
    if (typeof invoke !== 'function') {
      return;
    }
    const result: unknown = await invoke('git-provider', {
      command: 'git-current-op-state',
      repoPath: rootPath,
    });
    if (!result || typeof result !== 'object') {
      return;
    }
    const state = result as {
      merge?: boolean; rebase?: boolean; cherryPick?: boolean;
      revert?: boolean; bisect?: boolean;
      error?: unknown;
    };
    if (typeof state.error === 'string') {
      return;
    }
    const stuck: string[] = [];
    if (state.merge) stuck.push('merge');
    if (state.rebase) stuck.push('rebase');
    if (state.cherryPick) stuck.push('cherry-pick');
    if (state.revert) stuck.push('revert');
    if (state.bisect) stuck.push('bisect');
    if (stuck.length === 0) {
      return;
    }
    const label = stuck.join(', ');
    showWarning(
      `In-progress git ${label} detected in this project. Resolve or abort it from the Git tab before running AI edits.`,
      8000,
    );
  } catch {
    // Best-effort detection; swallow errors so non-git folders or transient
    // IPC failures never block project loading.
  }
}

export const FileExplorerProvider: React.FC<FileExplorerProviderProps> = ({ children }) => {
  const [rootPath, setRootPathState] = useState<string | null>(null);
  const [selectedFile, setSelectedFileState] = useState<string | null>(null);
  const [selectedFileVersion, setSelectedFileVersion] = useState(0);
  const [fileTree, setFileTree] = useState<FileTreeNode | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showWarning } = useToast();

  const setRootPath = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const tree = await buildFileTree(path);
      setRootPathState(path);
      setFileTree(tree);
      setSelectedFileState(null);
      setSelectedFileVersion((current) => current + 1);
      recordRecentWorkspace(path);
      // Fire-and-forget: warn about any stuck git operation so the user can
      // resolve it before the next AI turn runs. Never blocks project load.
      void warnIfStuckGitOperation(path, showWarning);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load directory';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [showWarning]);

  const selectFile = useCallback((path: string) => {
    setSelectedFileState(path);
    setSelectedFileVersion((current) => current + 1);
  }, []);

  const toggleExpanded = useCallback((path: string) => {
    setFileTree((prevTree) => {
      if (!prevTree) return null;
      return toggleNodeExpanded(prevTree, path);
    });
  }, []);

  const revealFileInTree = useCallback((targetPath: string) => {
    setFileTree((prevTree) => {
      if (!prevTree) {
        return null;
      }
      return expandAncestorsForPath(prevTree, targetPath);
    });
  }, []);

  const refreshFileTree = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    setError(null);
    try {
      const tree = await buildFileTree(rootPath);
      setFileTree(tree);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh directory';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  /**
   * Creates a new empty file at a path chosen in the main-process save dialog so the
   * explorer never depends on `window.prompt`, which often fails silently under
   * Electron. The optional second argument only seeds the dialog default filename.
   */
  const createFile = useCallback(
    async (directoryPath: string, suggestedBaseName: string = 'untitled.md') => {
      const pick = await IPCService.pickExplorerSavePath({
        intent: 'new-file',
        directoryPath,
        suggestedName: suggestedBaseName,
      });
      if (pick.canceled) {
        return null;
      }
      await IPCService.writeFile(pick.filePath, '');
      await refreshFileTree();
      setSelectedFileState(pick.filePath);
      setSelectedFileVersion((current) => current + 1);
      return pick.filePath;
    },
    [refreshFileTree]
  );

  /**
   * Creates a directory at a path chosen in the main-process save dialog so folder
   * creation matches file creation UX and avoids renderer prompt APIs.
   */
  const createFolder = useCallback(
    async (directoryPath: string, suggestedBaseName: string = 'new-folder') => {
      const pick = await IPCService.pickExplorerSavePath({
        intent: 'new-folder',
        directoryPath,
        suggestedName: suggestedBaseName,
      });
      if (pick.canceled) {
        return null;
      }
      await IPCService.createDirectory(pick.filePath);
      await refreshFileTree();
      return pick.filePath;
    },
    [refreshFileTree]
  );

  /**
   * Renames or moves an entry to the absolute path returned from a native save
   * dialog, refreshing the tree and selecting the new path on success.
   */
  const renameViaSaveDialog = useCallback(
    async (sourcePath: string) => {
      const pick = await IPCService.pickExplorerSavePath({
        intent: 'rename',
        currentPath: sourcePath,
      });
      if (pick.canceled) {
        return null;
      }
      await IPCService.renamePath(sourcePath, pick.filePath);
      dispatchDocumentRepoint(sourcePath, pick.filePath);
      const rootMoved = await syncExplorerRootAfterRootEntryMoved(rootPath, sourcePath, pick.filePath, setRootPath);
      if (!rootMoved) {
        await refreshFileTree();
        setSelectedFileState(pick.filePath);
        setSelectedFileVersion((current) => current + 1);
      }
      return pick.filePath;
    },
    [refreshFileTree, rootPath, setRootPath]
  );

  const renamePath = useCallback(
    async (sourcePath: string, nextName: string) => {
      const sanitizedName = nextName.trim();
      if (!sanitizedName) {
        throw new Error('Name cannot be empty.');
      }
      if (hasPathSeparator(sanitizedName)) {
        throw new Error('Name cannot include path separators.');
      }
      const targetPath = buildSiblingPath(sourcePath, sanitizedName);
      await IPCService.renamePath(sourcePath, targetPath);
      dispatchDocumentRepoint(sourcePath, targetPath);
      const rootMoved = await syncExplorerRootAfterRootEntryMoved(rootPath, sourcePath, targetPath, setRootPath);
      if (!rootMoved) {
        await refreshFileTree();
        setSelectedFileState(targetPath);
        setSelectedFileVersion((current) => current + 1);
      }
      return targetPath;
    },
    [refreshFileTree, rootPath, setRootPath]
  );

  const movePath = useCallback(
    async (sourcePath: string, targetDirectoryPath: string) => {
      const sourceName = sourcePath.split(/[/\\]/).pop();
      if (!sourceName) {
        throw new Error('Unable to resolve source file name.');
      }
      const targetPath = buildChildPath(targetDirectoryPath, sourceName);
      if (isSamePath(sourcePath, targetPath)) {
        throw new Error('Source and destination are the same path.');
      }
      if (isSelfOrDescendantPath(sourcePath, targetPath)) {
        throw new Error('Cannot move a folder into itself or one of its descendants.');
      }
      try {
        await IPCService.renamePath(sourcePath, targetPath);
      } catch (error) {
        setSelectedFileState((current) => (current === sourcePath ? null : current));
        setSelectedFileVersion((version) => version + 1);
        throw error;
      }
      dispatchDocumentRepoint(sourcePath, targetPath);
      const rootMoved = await syncExplorerRootAfterRootEntryMoved(rootPath, sourcePath, targetPath, setRootPath);
      if (!rootMoved) {
        await refreshFileTree();
        setSelectedFileState(targetPath);
        setSelectedFileVersion((current) => current + 1);
      }
      return targetPath;
    },
    [refreshFileTree, rootPath, setRootPath]
  );

  const deletePath = useCallback(
    async (targetPath: string, isDirectory: boolean) => {
      if (isDirectory) {
        await IPCService.deleteDirectory(targetPath);
      } else {
        await IPCService.deleteFile(targetPath);
        dispatchFileDeleted(targetPath);
        setSelectedFileState((current) => (current === targetPath ? null : current));
        setSelectedFileVersion((version) => version + 1);
      }
      await refreshFileTree();
    },
    [refreshFileTree]
  );

  // Playwright E2E: open fixture folder when main exposes GRUVBOX_E2E + E2E_FIXTURE_ROOT.
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.e2eGetFixtureRoot) return;
    void api.e2eGetFixtureRoot().then((root) => {
      if (typeof root === 'string' && root.length > 0) {
        void setRootPath(root).catch(() => {});
      }
    });
  }, [setRootPath]);

  const value: FileExplorerContextType = {
    rootPath,
    selectedFile,
    selectedFileVersion,
    fileTree,
    isLoading,
    error,
    setRootPath,
    selectFile,
    toggleExpanded,
    refreshFileTree,
    createFile,
    createFolder,
    renamePath,
    renameViaSaveDialog,
    movePath,
    deletePath,
    revealFileInTree,
    setLoading,
    setError,
  };

  return (
    <FileExplorerContext.Provider value={value}>
      {children}
    </FileExplorerContext.Provider>
  );
};

function expandAncestorsForPath(node: FileTreeNode, targetPath: string): FileTreeNode {
  const normalize = (value: string) => value.replace(/\\/g, '/');
  const target = normalize(targetPath);
  const nodePath = normalize(node.path);
  if (target !== nodePath && !target.startsWith(`${nodePath}/`)) {
    return node;
  }
  if (!node.isDirectory) {
    return node;
  }
  const children = node.children?.map((child) => expandAncestorsForPath(child, targetPath));
  return {
    ...node,
    isExpanded: target !== nodePath ? true : node.isExpanded,
    children,
  };
}

function toggleNodeExpanded(node: FileTreeNode, targetPath: string): FileTreeNode {
  if (node.path === targetPath) {
    return {
      ...node,
      isExpanded: !node.isExpanded,
    };
  }

  if (node.children) {
    return {
      ...node,
      children: node.children.map((child) => toggleNodeExpanded(child, targetPath)),
    };
  }

  return node;
}

async function buildFileTree(rootPath: string): Promise<FileTreeNode> {
  try {
    const files = await IPCService.listDirectory(rootPath);
    const visibleFiles = files.filter((file: FileInfo) => !shouldHideExplorerEntry(file));
    return {
      name: fileNameFromPath(rootPath) || rootPath,
      path: rootPath,
      isDirectory: true,
      isExpanded: true,
      children: await Promise.all(
        visibleFiles.map(async (file: FileInfo) => buildTreeNode(file))
      ),
    };
  } catch (err) {
    console.error('Failed to build file tree:', err);
    throw err;
  }
}

async function buildTreeNode(fileInfo: FileInfo): Promise<FileTreeNode> {
  const node: FileTreeNode = {
    name: fileInfo.name,
    path: fileInfo.path,
    isDirectory: fileInfo.is_directory,
    isExpanded: false,
  };

  if (fileInfo.is_directory) {
    try {
      const children = await IPCService.listDirectory(fileInfo.path);
      const visibleChildren = children.filter((child: FileInfo) => !shouldHideExplorerEntry(child));
      node.children = await Promise.all(
        visibleChildren.map((child: FileInfo) => buildTreeNode(child))
      );
    } catch (err) {
      console.error(`Failed to load directory ${fileInfo.path}:`, err);
      node.children = [];
    }
  }

  return node;
}

function buildChildPath(parentPath: string, childName: string): string {
  const separator = parentPath.includes('\\') ? '\\' : '/';
  return `${parentPath.replace(/[\\/]$/, '')}${separator}${childName}`;
}

function buildSiblingPath(sourcePath: string, nextName: string): string {
  const separator = sourcePath.includes('\\') ? '\\' : '/';
  const parts = sourcePath.split(/[/\\]/);
  parts[parts.length - 1] = nextName;
  return parts.join(separator);
}

