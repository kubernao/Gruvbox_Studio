/**
 * Opens a workspace folder via the native directory picker and records the path
 * in recent-workspace storage. Shared by the menu bridge, toolbar, welcome
 * screen, command palette, and global keyboard shortcuts.
 */

import { IPCService } from '../../shared/utils/ipc';
import type { FileExplorerContextType } from '../explorer/types';
import { recordRecentWorkspace } from './recentWorkspaces';

/**
 * Shows the open-directory dialog and loads the chosen folder into the file
 * explorer. Returns true when a folder was opened successfully.
 */
export async function openWorkspaceFolder(
  fileExplorer: Pick<FileExplorerContextType, 'setRootPath'> | null | undefined,
): Promise<boolean> {
  if (fileExplorer == null) {
    return false;
  }
  const result = await IPCService.showOpenDialog();
  if (result.canceled || result.filePaths.length === 0) {
    return false;
  }
  const folderPath = result.filePaths[0];
  if (typeof folderPath !== 'string' || folderPath.trim() === '') {
    return false;
  }
  await fileExplorer.setRootPath(folderPath);
  recordRecentWorkspace(folderPath);
  return true;
}
