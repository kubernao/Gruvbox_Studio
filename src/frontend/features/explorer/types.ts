export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  isExpanded?: boolean;
}

export interface FileExplorerState {
  rootPath: string | null;
  selectedFile: string | null;
  selectedFileVersion: number;
  fileTree: FileTreeNode | null;
  isLoading: boolean;
  error: string | null;
}

export interface FileExplorerContextType extends FileExplorerState {
  setRootPath: (path: string) => Promise<void>;
  selectFile: (path: string) => void;
  toggleExpanded: (path: string) => void;
  refreshFileTree: () => Promise<void>;
  /**
   * Creates an empty file after the user confirms the full path in a native save
   * dialog. Returns null when the dialog is canceled so callers can exit without
   * treating cancel as an error.
   */
  createFile: (directoryPath: string, suggestedBaseName?: string) => Promise<string | null>;
  /**
   * Creates a folder at the path chosen in a native save dialog (default name is
   * only a starting suggestion). Returns null when canceled.
   */
  createFolder: (directoryPath: string, suggestedBaseName?: string) => Promise<string | null>;
  /**
   * Renames a sibling entry by building a new basename while keeping the parent
   * directory; kept for programmatic callers that already validated a name string.
   */
  renamePath: (sourcePath: string, nextName: string) => Promise<string>;
  /**
   * Renames or moves an entry to the absolute path returned from a native save
   * dialog, which matches how macOS and Windows expect renames to be confirmed.
   * Returns null when the dialog is canceled.
   */
  renameViaSaveDialog: (sourcePath: string) => Promise<string | null>;
  movePath: (sourcePath: string, targetDirectoryPath: string) => Promise<string>;
  deletePath: (targetPath: string, isDirectory: boolean) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}
