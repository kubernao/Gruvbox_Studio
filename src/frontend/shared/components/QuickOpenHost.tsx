import React, { useContext } from 'react';
import { FileExplorerContext } from '../../features/explorer/FileExplorerContext';
import QuickOpenModal from '../../features/editor/QuickOpenModal';

/**
 * Hosts the workspace quick-open modal at app shell level so Cmd/Ctrl+P works
 * even when the editor welcome screen is visible and no document tab is active.
 */
export default function QuickOpenHost(): React.ReactElement | null {
  const fileExplorer = useContext(FileExplorerContext);
  const rootPath = fileExplorer?.rootPath ?? '';
  const fileTree = fileExplorer?.fileTree ?? null;

  if (fileExplorer == null) {
    return null;
  }

  return (
    <QuickOpenModal
      rootPath={rootPath}
      fileTree={fileTree}
      onPick={(absolutePath: string) => {
        fileExplorer.selectFile(absolutePath);
        fileExplorer.revealFileInTree(absolutePath);
      }}
    />
  );
}
