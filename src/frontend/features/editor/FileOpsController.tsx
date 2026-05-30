/**
 * Mounts inside FileExplorerProvider so file menu items, keyboard shortcuts,
 * and palette commands share one wiring path with access to explorer context.
 */

import { useContext, useEffect } from 'react';
import { FileExplorerContext } from '../explorer/FileExplorerContext';
import type { FileExplorerContextType } from '../explorer/types';
import { isDarwin } from '../palette/platform';
import {
  PALETTE_ACTION_EVENT,
  dispatchPaletteAction,
  type PaletteActionEventDetail,
} from '../palette/paletteActionEvents';
import { invokeEditorFileAction } from './editorActionRegistry';
import { openQuickOpenModal } from './QuickOpenModal';
import { openWorkspaceFolder } from './openWorkspaceFolder';

const CONTROLLER_KINDS = new Set([
  'editor.openFolder',
  'editor.quickOpen',
  'editor.save',
  'editor.saveAs',
  'editor.closeTab',
  'editor.newMarkdown',
]);

function isModKey(event: KeyboardEvent): boolean {
  return isDarwin() ? event.metaKey : event.ctrlKey;
}

function runFileOpKind(kind: string, fileExplorer: FileExplorerContextType | undefined): void {
  switch (kind) {
    case 'editor.openFolder':
      void openWorkspaceFolder(fileExplorer);
      return;
    case 'editor.quickOpen':
      openQuickOpenModal();
      return;
    case 'editor.save':
      invokeEditorFileAction('save');
      return;
    case 'editor.saveAs':
      invokeEditorFileAction('saveAs');
      return;
    case 'editor.closeTab':
      invokeEditorFileAction('closeTab');
      return;
    case 'editor.newMarkdown':
      invokeEditorFileAction('newMarkdown');
      return;
    case 'editor.exportFileCopy':
      dispatchPaletteAction({ kind: 'editor.exportFileCopy' });
      return;
    default:
      break;
  }
}

/**
 * Subscribes to native menu IPC, palette file actions, and global keyboard
 * shortcuts. Must render as a descendant of FileExplorerProvider.
 */
export default function FileOpsController(): null {
  const fileExplorer = useContext(FileExplorerContext);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onMenuPaletteAction?.((payload: unknown) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }
      const kind = (payload as { kind?: unknown }).kind;
      if (typeof kind !== 'string') {
        return;
      }
      runFileOpKind(kind, fileExplorer);
    });
    return () => {
      unsubscribe?.();
    };
  }, [fileExplorer]);

  useEffect(() => {
    const onPalette = (event: Event): void => {
      const detail = (event as CustomEvent<PaletteActionEventDetail>).detail;
      const kind = detail?.action.kind;
      if (typeof kind !== 'string' || !CONTROLLER_KINDS.has(kind)) {
        return;
      }
      runFileOpKind(kind, fileExplorer);
    };
    window.addEventListener(PALETTE_ACTION_EVENT, onPalette as EventListener);
    return () => window.removeEventListener(PALETTE_ACTION_EVENT, onPalette as EventListener);
  }, [fileExplorer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isModKey(event)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          invokeEditorFileAction('saveAs');
        } else {
          invokeEditorFileAction('save');
        }
        return;
      }

      if (key === 'o') {
        event.preventDefault();
        event.stopPropagation();
        void openWorkspaceFolder(fileExplorer);
        return;
      }

      if (key === 'n') {
        event.preventDefault();
        event.stopPropagation();
        invokeEditorFileAction('newMarkdown');
        return;
      }

      if (key === 'w') {
        event.preventDefault();
        event.stopPropagation();
        invokeEditorFileAction('closeTab');
        return;
      }

      if (key === 'p') {
        event.preventDefault();
        event.stopPropagation();
        openQuickOpenModal();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [fileExplorer]);

  return null;
}
