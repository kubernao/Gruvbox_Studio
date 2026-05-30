/**
 * Builds searchable workspace file rows for quick-open and palette helpers by
 * walking the explorer tree and optionally boosting recently opened paths.
 */

import type { FileTreeNode } from '../explorer/types';
import { getRecentOpenedFiles, recordOpenedFile } from './recentOpenedFiles';

export type WorkspaceFileRow = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  prefix: string;
  searchText: string;
};

/**
 * Collects every file (non-directory) under `fileTree` as quick-open rows with
 * repo-relative paths when `rootPath` is set.
 */
export function collectWorkspaceFileRows(
  fileTree: FileTreeNode | null,
  rootPath: string,
): WorkspaceFileRow[] {
  if (fileTree == null || rootPath.trim() === '') {
    return [];
  }
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const out: WorkspaceFileRow[] = [];

  const walk = (node: FileTreeNode): void => {
    if (!node.isDirectory) {
      const absolute = node.path;
      const normalizedAbs = absolute.replace(/\\/g, '/');
      const relative =
        normalizedAbs.startsWith(`${root}/`) || normalizedAbs === root
          ? normalizedAbs.slice(root.length).replace(/^\//, '')
          : absolute;
      const parts = relative.split('/');
      const fileName = parts[parts.length - 1] || relative;
      const prefix = parts.slice(0, -1).join('/');
      out.push({
        absolutePath: absolute,
        relativePath: relative,
        fileName,
        prefix,
        searchText: `${relative} ${fileName} ${absolute}`,
      });
      return;
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };

  walk(fileTree);
  return out;
}

/**
 * Ranks workspace file rows for quick-open: MRU paths first, then alphabetical.
 */
export function rankWorkspaceFileRows(rows: WorkspaceFileRow[]): WorkspaceFileRow[] {
  const mru = new Set(
    getRecentOpenedFiles().map((entry) => entry.replace(/\\/g, '/').toLowerCase()),
  );
  return [...rows].sort((a, b) => {
    const aMru = mru.has(a.absolutePath.replace(/\\/g, '/').toLowerCase());
    const bMru = mru.has(b.absolutePath.replace(/\\/g, '/').toLowerCase());
    if (aMru !== bMru) {
      return aMru ? -1 : 1;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });
}

export { recordOpenedFile };
