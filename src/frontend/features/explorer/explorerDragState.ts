/**
 * Stores the active explorer drag source in renderer memory so drag-over handlers
 * can validate drop targets without depending on `dataTransfer.getData`, which is
 * often unavailable during `dragover` in Chromium/Electron.
 */
export type ExplorerDragSource = {
  path: string;
  isDirectory: boolean;
};

let currentExplorerDragSource: ExplorerDragSource | null = null;

export function setCurrentExplorerDragSource(source: ExplorerDragSource): void {
  currentExplorerDragSource = {
    path: source.path.trim(),
    isDirectory: source.isDirectory,
  };
}

export function getCurrentExplorerDragSource(): ExplorerDragSource | null {
  return currentExplorerDragSource;
}

export function clearCurrentExplorerDragSource(): void {
  currentExplorerDragSource = null;
}

