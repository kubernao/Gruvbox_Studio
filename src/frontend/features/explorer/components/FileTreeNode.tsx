/**
 * FileTreeNode — single row in the file-explorer tree.
 *
 * Renders a file or directory entry at a given `level` of indentation.
 * Directories toggle expand/collapse via {@link useFileExplorer}; files
 * delegate selection to the same hook. Visual state (selected, expanded) is
 * read from the explorer context rather than local state.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ChevronRight, Code } from 'lucide-react';
import { byPrefixAndName } from '../explorerFontAwesomeIcons';
import { useToast } from '../../../shared/hooks/useToast';
import { getFriendlyErrorMessage } from '../../../shared/utils/errorMessages';
import { FileTreeNode as FileTreeNodeType } from '../types';
import { getParentPath, isSamePath, isSelfOrDescendantPath } from '../pathValidation';
import {
  clearCurrentExplorerDragSource,
  getCurrentExplorerDragSource,
  setCurrentExplorerDragSource,
} from '../explorerDragState';
import { useFileExplorer } from '../useFileExplorer';
import { IPCService } from '../../../shared/utils/ipc';
import './FileTreeNode.css';

interface FileTreeNodeProps {
  node: FileTreeNodeType;
  level: number;
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({ node, level }) => {
  const { selectedFile, selectFile, toggleExpanded, createFile, createFolder, renameViaSaveDialog, movePath, deletePath } =
    useFileExplorer();
  const { showError, showSuccess, showWarning } = useToast();
  const isSelected = selectedFile === node.path;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClick = () => {
    if (node.isDirectory) {
      handleDoubleClick();
    } else {
      selectFile(node.path);
    }
  };

  const handleDoubleClick = () => {
    if (node.isDirectory) {
      toggleExpanded(node.path);
    }
  };

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

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!node.isDirectory) {
      selectFile(node.path);
    }
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const actionItems = useMemo(() => {
    if (node.isDirectory) {
      return [
        { key: 'new-file', label: 'New File' },
        { key: 'new-folder', label: 'New Folder' },
        { key: 'rename', label: 'Rename' },
        { key: 'delete', label: 'Delete' },
      ];
    }
    return [
      { key: 'rename', label: 'Rename' },
      { key: 'delete', label: 'Delete' },
    ];
  }, [node.isDirectory]);

  const runAction = async (action: string) => {
    setContextMenu(null);
    try {
      if (action === 'new-file') {
        const created = await createFile(node.path, 'untitled.md');
        if (!created) {
          return;
        }
        showSuccess(`Created ${created.split(/[/\\]/).pop() ?? 'file'}`);
        return;
      }
      if (action === 'new-folder') {
        const created = await createFolder(node.path, 'new-folder');
        if (!created) {
          return;
        }
        showSuccess(`Created ${created.split(/[/\\]/).pop() ?? 'folder'}`);
        return;
      }
      if (action === 'rename') {
        const renamed = await renameViaSaveDialog(node.path);
        if (!renamed) {
          return;
        }
        showSuccess(`Renamed to ${renamed.split(/[/\\]/).pop() ?? renamed}`);
        return;
      }
      if (action === 'delete') {
        const entityLabel = node.isDirectory ? 'folder' : 'file';
        const { ok } = await IPCService.confirmExplorerDelete({
          message: `Delete ${entityLabel} "${node.name}"?`,
          detail: node.path,
        });
        if (!ok) {
          return;
        }
        await deletePath(node.path, node.isDirectory);
        showWarning(`Deleted ${node.name}`);
      }
    } catch (error) {
      if (action === 'rename') {
        console.error('[Explorer][Rename] Failed', {
          sourcePath: node.path,
          error,
        });
      }
      showError(getFriendlyErrorMessage(error, 'explorer'));
    }
  };

  const canAcceptDrop = (dragSourcePath: string, dragSourceIsDirectory: boolean): boolean => {
    if (!dragSourcePath) {
      return false;
    }
    if (!node.isDirectory) {
      return false;
    }
    if (isSamePath(dragSourcePath, node.path)) {
      return false;
    }
    if (dragSourceIsDirectory && isSelfOrDescendantPath(dragSourcePath, node.path)) {
      return false;
    }
    const sourceParentPath = getParentPath(dragSourcePath);
    if (isSamePath(sourceParentPath, node.path)) {
      return false;
    }
    return true;
  };

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/gruvbox-path', node.path);
    event.dataTransfer.setData('text/gruvbox-is-directory', String(node.isDirectory));
    setCurrentExplorerDragSource({ path: node.path, isDirectory: node.isDirectory });
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const dragSource = getCurrentExplorerDragSource();
    const dragSourcePath = dragSource?.path ?? '';
    const dragSourceIsDirectory = dragSource?.isDirectory ?? false;
    if (!canAcceptDrop(dragSourcePath, dragSourceIsDirectory)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    if (isDragOver) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const dragSourceFromState = getCurrentExplorerDragSource();
    const dragSourcePath = dragSourceFromState?.path || event.dataTransfer.getData('text/gruvbox-path');
    if (!dragSourcePath) {
      showError('Unable to move item: drag source path is missing.');
      return;
    }
    const dragSourceIsDirectory =
      dragSourceFromState?.isDirectory ?? (event.dataTransfer.getData('text/gruvbox-is-directory') === 'true');
    if (!canAcceptDrop(dragSourcePath, dragSourceIsDirectory)) {
      return;
    }
    try {
      const movedPath = await movePath(dragSourcePath, node.path);
      showSuccess(`Moved to ${node.name}`);
      selectFile(movedPath);
      if (!node.isExpanded) {
        toggleExpanded(node.path);
      }
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error) {
        const code = String((error as { code?: unknown }).code ?? '');
        if (code === 'NO_OP') {
          showWarning('Item is already in this folder.');
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

  const handleDragEnd = () => {
    setIsDragOver(false);
    clearCurrentExplorerDragSource();
  };

  /**
   * Supplies the explorer row glyph for directories and common file extensions,
   * using Font Awesome only for folders and Lucide markup for code files plus
   * inline SVG placeholders for Markdown and generic files so visuals stay aligned
   * with the Gruv palette until those types are migrated as well.
   */
  const getFileIcon = () => {
    if (node.isDirectory) {
      return <FontAwesomeIcon icon={byPrefixAndName.fans['folder']} className="file-icon folder-icon" />;
    }

    const ext = node.name.split('.').pop()?.toLowerCase();
    if (['ts', 'tsx', 'js', 'jsx', 'css', 'json'].includes(ext || '')) {
      return <Code size={16} className="file-icon code-icon" />;
    }

    if (['md', 'mdx'].includes(ext || '')) {
      return (
        <svg width={16} height={16} fill="none" viewBox="0 0 40 40" className="file-icon markdown-icon">
          <path fill="#458588" d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
          <path fill="#fbf1c7" d="m24 0 12 12h-8a4 4 0 0 1-4-4z" opacity={0.25} />
          <path
            stroke="#ebdbb2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12.8 20h14.4m-14.4 3.2h14.4m-14.4 3.2h14.4m-14.4 3.2H24"
          />
        </svg>
      );
    }

    return (
      <svg width={16} height={16} fill="none" viewBox="0 0 40 40" className="file-icon fallback-file-icon">
        <path fill="#b16286" d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
        <path fill="#fbf1c7" d="m24 0 12 12h-8a4 4 0 0 1-4-4z" opacity={0.3} />
      </svg>
    );
  };

  return (
    <div className="file-tree-node-container">
      <div
        className={`file-tree-node ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
        style={{ paddingLeft: `${level * 16}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => {
          void handleDrop(event);
        }}
        onDragEnd={handleDragEnd}
      >
        {node.isDirectory && (
          <div className={`chevron ${node.isExpanded ? 'expanded' : ''}`}>
            <ChevronRight size={16} />
          </div>
        )}
        {!node.isDirectory && <div className="chevron-placeholder" />}
        {getFileIcon()}
        <span className="file-name" data-e2e-file-name={node.name}>
          {node.name}
        </span>
      </div>
      {contextMenu && (
        <div
          className="explorer-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {actionItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className="explorer-context-menu-item"
              onClick={() => {
                void runAction(item.key);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {node.isDirectory && node.isExpanded && node.children && (
        <div className="file-tree-children">
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default FileTreeNode;
