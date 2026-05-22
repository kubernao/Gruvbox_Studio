/**
 * FileTree — root of the file-explorer tree UI.
 *
 * Reads the resolved {@link FileTreeNode} hierarchy from {@link useFileExplorer}
 * and renders it as a recursive list of {@link FileTreeNode} components.
 * Displays a loading spinner while the directory scan is in progress and an
 * error message if the scan fails. Stateless beyond what the explorer hook
 * provides.
 */

import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader } from 'lucide-react';
import { useFileExplorer } from '../useFileExplorer';
import { useToast } from '../../../shared/hooks/useToast';
import { getFriendlyErrorMessage } from '../../../shared/utils/errorMessages';
import { getParentPath, isSamePath } from '../pathValidation';
import { getCurrentExplorerDragSource } from '../explorerDragState';
import FileTreeNode from './FileTreeNode';
import './FileTree.css';

const FileTree: React.FC = () => {
  const { fileTree, rootPath, isLoading, error, createFile, createFolder, movePath } = useFileExplorer();
  const { showError, showSuccess } = useToast();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRootDragOver, setIsRootDragOver] = useState(false);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', close);
    };
  }, [contextMenu]);

  if (isLoading) {
    return (
      <div className="file-tree-loading">
        <Loader size={20} className="spinner" />
        <p>Loading folder...</p>
      </div>
    );
  }

  if (error) {
    const friendlyMessage = getFriendlyErrorMessage(error, 'folder');
    return (
      <div className="file-tree-error">
        <AlertCircle size={20} />
        <p>{friendlyMessage}</p>
      </div>
    );
  }

  if (!fileTree) {
    return (
      <div className="file-tree-empty">
        <p>No folder selected</p>
        <p className="file-tree-empty-hint">Click "Open Folder" to get started</p>
      </div>
    );
  }

  const handleTreeContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!rootPath) {
      return;
    }
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const runRootAction = async (action: 'new-file' | 'new-folder') => {
    setContextMenu(null);
    if (!rootPath) {
      return;
    }
    try {
      if (action === 'new-file') {
        const created = await createFile(rootPath, 'untitled.md');
        if (!created) {
          return;
        }
        showSuccess(`Created ${created.split(/[/\\]/).pop() ?? 'file'}`);
        return;
      }
      const created = await createFolder(rootPath, 'new-folder');
      if (!created) {
        return;
      }
      showSuccess(`Created ${created.split(/[/\\]/).pop() ?? 'folder'}`);
    } catch (error) {
      showError(getFriendlyErrorMessage(error, 'explorer'));
    }
  };

  const canDropToRoot = (dragSourcePath: string): boolean => {
    if (!rootPath || !dragSourcePath) {
      return false;
    }
    const sourceParentPath = getParentPath(dragSourcePath);
    return !isSamePath(sourceParentPath, rootPath);
  };

  const handleRootDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const dragSourcePath = getCurrentExplorerDragSource()?.path ?? '';
    if (!canDropToRoot(dragSourcePath)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (!isRootDragOver) {
      setIsRootDragOver(true);
    }
  };

  const handleRootDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsRootDragOver(false);
    if (!rootPath) {
      return;
    }
    const dragSourcePath = getCurrentExplorerDragSource()?.path || event.dataTransfer.getData('text/gruvbox-path');
    if (!dragSourcePath) {
      showError('Unable to move item: drag source path is missing.');
      return;
    }
    if (!canDropToRoot(dragSourcePath)) {
      return;
    }
    try {
      await movePath(dragSourcePath, rootPath);
      showSuccess('Moved into root folder');
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error) {
        const code = String((error as { code?: unknown }).code ?? '');
        if (code === 'NO_OP') {
          showError('Item is already in the root folder.');
          return;
        }
        if (code === 'TARGET_EXISTS') {
          showError('Cannot move item: destination already contains that name.');
          return;
        }
      }
      showError(getFriendlyErrorMessage(error, 'explorer'));
    }
  };

  return (
    <div
      className={`file-tree ${isRootDragOver ? 'root-drag-over' : ''}`}
      onContextMenu={handleTreeContextMenu}
      onDragOver={handleRootDragOver}
      onDragLeave={() => setIsRootDragOver(false)}
      onDrop={(event) => {
        void handleRootDrop(event);
      }}
    >
      <FileTreeNode node={fileTree} level={0} />
      {contextMenu && (
        <div
          className="explorer-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="explorer-context-menu-item" onClick={() => void runRootAction('new-file')}>
            New File
          </button>
          <button
            type="button"
            className="explorer-context-menu-item"
            onClick={() => void runRootAction('new-folder')}
          >
            New Folder
          </button>
        </div>
      )}
    </div>
  );
};

export default FileTree;
