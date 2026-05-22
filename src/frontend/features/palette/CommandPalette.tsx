import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { FileExplorerContext } from '../explorer/FileExplorerContext';
import { useDiffViewer } from '../../shared/contexts/DiffViewerContext';
import { IPCService } from '../../shared/utils/ipc';
import {
  buildCommandPaletteAllItems,
  buildDiffPaletteLineItemForQuery,
  executeCommandPaletteQuery,
  filterCommandPaletteItemsForQuery,
  getWorkspaceKnownFileRelatives,
  loadFlatApplicationMenuForPalette,
  previewCommandPaletteQuery,
} from './execute';
import { useCommandPaletteHotkey } from './useCommandPaletteHotkey';
import type { FlatMenuRow } from './types';
import { Search } from 'lucide-react';
import {
  COMMIT_MESSAGE_PALETTE_CONFIRM_EVENT,
  OPEN_COMMIT_MESSAGE_PALETTE_EVENT,
} from './commitMessagePaletteEvents';
import './commandPalette.css';
import { getPalettePrereqsSnapshot, subscribePalettePrereqs } from './palettePrereqStore';

type PaletteView = 'commands' | 'commit-message';

type PaletteRequest = {
  requestId: string;
  mode?: 'run' | 'preview';
  query: string;
};

export const OPEN_COMMAND_PALETTE_EVENT = 'app:open-command-palette';

const CommandPalette: React.FC = () => {
  const fileExplorer = useContext(FileExplorerContext);
  const diffViewer = useDiffViewer();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteView, setPaletteView] = useState<PaletteView>('commands');
  const [commitMessageDraft, setCommitMessageDraft] = useState('');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuRows, setMenuRows] = useState<FlatMenuRow[]>([]);
  const [isMenuLoading, setIsMenuLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commitTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const rootPath = fileExplorer?.rootPath ?? '';
  const selectedFile = fileExplorer?.selectedFile ?? null;
  const fileTree = fileExplorer?.fileTree ?? null;
  const hasDiffOpen = diffViewer.session != null;

  const prereqs = useSyncExternalStore(
    subscribePalettePrereqs,
    getPalettePrereqsSnapshot,
    getPalettePrereqsSnapshot,
  );

  const knownFileRelatives = useMemo(
    () => getWorkspaceKnownFileRelatives(fileTree, rootPath),
    [fileTree, rootPath],
  );

  const loadMenuRows = useCallback(async (): Promise<void> => {
    if (isMenuLoading) {
      return;
    }
    setIsMenuLoading(true);
    try {
      setMenuRows(await loadFlatApplicationMenuForPalette());
    } finally {
      setIsMenuLoading(false);
    }
  }, [isMenuLoading]);

  const runOpenFolder = useCallback(async (): Promise<void> => {
    if (fileExplorer == null) {
      return;
    }
    const result = await IPCService.showOpenDialog();
    if (result.canceled || result.filePaths.length === 0) {
      return;
    }
    const folderPath = result.filePaths[0];
    if (typeof folderPath !== 'string' || folderPath.trim() === '') {
      return;
    }
    await fileExplorer.setRootPath(folderPath);
  }, [fileExplorer]);

  const runRefreshTree = useCallback(async (): Promise<void> => {
    if (fileExplorer == null) {
      return;
    }
    await fileExplorer.refreshFileTree();
  }, [fileExplorer]);

  const runOpenAiTab = useCallback((): void => {
    window.dispatchEvent(
      new CustomEvent('app:right-sidebar-tab', { detail: { tab: 'ai' } }),
    );
  }, []);

  const runOpenVersionControlTab = useCallback((): void => {
    window.dispatchEvent(
      new CustomEvent('app:right-sidebar-tab', { detail: { tab: 'version-control' } }),
    );
  }, []);

  const runCloseDiff = useCallback((): void => {
    diffViewer.closeDiff();
  }, [diffViewer]);

  const runOpenGitDiff = useCallback(
    (args: { filePath: string; hash1: string; hash2: string }): void => {
      if (rootPath.trim() === '') {
        return;
      }
      diffViewer.openDiff({
        repoPath: rootPath,
        filePath: args.filePath,
        hash1: args.hash1,
        hash2: args.hash2,
      });
    },
    [diffViewer, rootPath],
  );

  const runOpenCommitMessagePalette = useCallback(async (): Promise<void> => {
    setPaletteView('commit-message');
    setCommitMessageDraft('');
    setQuery('');
    setActiveIndex(0);
    setPaletteOpen(true);
    if (menuRows.length === 0) {
      await loadMenuRows();
    }
  }, [loadMenuRows, menuRows.length]);

  const allItems = useMemo(
    () =>
      buildCommandPaletteAllItems(menuRows, {
        rootPath,
        selectedFile,
        fileTree,
        hasDiffOpen,
        prereqs,
        runOpenFolder,
        runRefreshTree,
        runOpenAiTab,
        runOpenVersionControlTab,
        runCloseDiff,
        runOpenGitDiff,
        runOpenCommitMessagePalette,
      }),
    [
      menuRows,
      rootPath,
      selectedFile,
      fileTree,
      hasDiffOpen,
      prereqs,
      runOpenFolder,
      runRefreshTree,
      runOpenAiTab,
      runOpenVersionControlTab,
      runCloseDiff,
      runOpenGitDiff,
      runOpenCommitMessagePalette,
    ],
  );

  const diffLineItem = useMemo(
    () =>
      buildDiffPaletteLineItemForQuery(query, rootPath, knownFileRelatives, runOpenGitDiff),
    [query, rootPath, knownFileRelatives, runOpenGitDiff],
  );

  const visibleRows = useMemo(
    () => filterCommandPaletteItemsForQuery(query, allItems, diffLineItem),
    [query, allItems, diffLineItem],
  );

  const closePalette = useCallback((): void => {
    setPaletteOpen(false);
    setPaletteView('commands');
    setCommitMessageDraft('');
    setQuery('');
    setActiveIndex(0);
  }, []);

  const openPalette = useCallback(async (): Promise<void> => {
    setPaletteView('commands');
    setCommitMessageDraft('');
    setPaletteOpen(true);
    setQuery('');
    setActiveIndex(0);
    if (menuRows.length === 0) {
      await loadMenuRows();
    }
  }, [loadMenuRows, menuRows.length]);

  const togglePalette = useCallback((): void => {
    if (paletteOpen) {
      closePalette();
    } else {
      void openPalette();
    }
  }, [closePalette, openPalette, paletteOpen]);

  const submitCommitMessage = useCallback((): void => {
    const message = commitMessageDraft.trim();
    if (message === '') {
      return;
    }
    window.dispatchEvent(
      new CustomEvent(COMMIT_MESSAGE_PALETTE_CONFIRM_EVENT, {
        detail: { message },
      }),
    );
    closePalette();
  }, [commitMessageDraft, closePalette]);

  useCommandPaletteHotkey(togglePalette);

  useEffect(() => {
    const handler = (): void => {
      void runOpenCommitMessagePalette();
    };
    window.addEventListener(OPEN_COMMIT_MESSAGE_PALETTE_EVENT, handler);
    return () => window.removeEventListener(OPEN_COMMIT_MESSAGE_PALETTE_EVENT, handler);
  }, [runOpenCommitMessagePalette]);

  useEffect(() => {
    const handler = (): void => {
      void openPalette();
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handler);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handler);
  }, [openPalette]);

  useEffect(() => {
    if (!paletteOpen) {
      return;
    }
    if (paletteView !== 'commands') {
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [paletteOpen, paletteView]);

  useEffect(() => {
    if (!paletteOpen || paletteView !== 'commit-message') {
      return;
    }
    const timer = window.setTimeout(() => {
      commitTextareaRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [paletteOpen, paletteView]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const listElement = listRef.current;
    if (listElement == null) {
      return;
    }
    const row = listElement.querySelectorAll('.command-palette-row')[activeIndex] as
      | HTMLElement
      | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, visibleRows]);

  const selectRow = useCallback(
    async (idx: number): Promise<void> => {
      const item = visibleRows[idx];
      if (item == null || item.disabled) {
        return;
      }
      closePalette();
      await item.run();
    },
    [closePalette, visibleRows],
  );

  const onInputKeydown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (visibleRows.length === 0) {
          return;
        }
        setActiveIndex((prev) => (prev + 1) % visibleRows.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (visibleRows.length === 0) {
          return;
        }
        setActiveIndex((prev) => (prev - 1 + visibleRows.length) % visibleRows.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void selectRow(activeIndex);
      }
    },
    [activeIndex, closePalette, selectRow, visibleRows.length],
  );

  useEffect(() => {
    const onRequest = window.electronAPI?.onCommandPaletteRequest;
    const sendResult = window.electronAPI?.sendCommandPaletteResult;
    if (typeof onRequest !== 'function' || typeof sendResult !== 'function') {
      return;
    }
    const unsubscribe = onRequest((request: PaletteRequest) => {
      void (async () => {
        if (menuRows.length === 0) {
          await loadMenuRows();
        }
        const queryValue = typeof request?.query === 'string' ? request.query : '';
        const mode = request?.mode === 'preview' ? 'preview' : 'run';
        const lineItem = buildDiffPaletteLineItemForQuery(
          queryValue,
          rootPath,
          knownFileRelatives,
          runOpenGitDiff,
        );
        if (mode === 'preview') {
          const preview = await previewCommandPaletteQuery(queryValue, allItems, lineItem);
          await sendResult({
            requestId: request.requestId,
            ok: true,
            preview,
          });
          return;
        }
        const result = await executeCommandPaletteQuery(queryValue, allItems, lineItem);
        await sendResult({
          requestId: request.requestId,
          ok: result.ok,
          ...(result.ok
            ? { executedLabel: result.executedLabel, detail: result.detail ?? '' }
            : { error: result.error }),
        });
      })().catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        await sendResult({
          requestId: request.requestId,
          ok: false,
          error: message,
        });
      });
    });
    return unsubscribe;
  }, [
    allItems,
    knownFileRelatives,
    loadMenuRows,
    menuRows.length,
    rootPath,
    runOpenGitDiff,
  ]);

  const panel = paletteOpen ? (
    <div className="command-palette-layer" role="presentation">
      <div className="command-palette-backdrop" onPointerDown={closePalette} />
      {paletteView === 'commands' ? (
        <div className="command-palette-panel" role="listbox" aria-label="Commands">
          <div className="command-palette-input-wrap">
            <Search size={18} className="command-palette-input-icon" />
            <input
              ref={inputRef}
              type="search"
              className="command-palette-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a command or search menus..."
              autoComplete="off"
              spellCheck={false}
              onKeyDown={onInputKeydown}
            />
          </div>
          <ul ref={listRef} className="command-palette-results" role="presentation">
            {visibleRows.map((item, index) => (
              <li
                key={item.id}
                className={`command-palette-row ${activeIndex === index ? 'active' : ''}`}
                aria-selected={activeIndex === index}
                role="option"
                onPointerDown={(event) => {
                  event.preventDefault();
                  void selectRow(index);
                }}
                onPointerEnter={() => setActiveIndex(index)}
              >
                <span className="command-palette-row-label">{item.label}</span>
                {item.detail != null && <span className="command-palette-row-detail">{item.detail}</span>}
                {item.shortcut != null && <kbd className="command-palette-row-kbd">{item.shortcut}</kbd>}
              </li>
            ))}
            {visibleRows.length === 0 && (
              <li className="command-palette-empty">No matching commands</li>
            )}
          </ul>
        </div>
      ) : (
        <div
          className="command-palette-panel command-palette-panel--commit-message"
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-palette-commit-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closePalette();
            }
          }}
        >
          <div className="command-palette-commit-head">
            <h2 id="command-palette-commit-title" className="command-palette-commit-title">
              Save version
            </h2>
            <p className="command-palette-commit-subtitle">Commit message</p>
          </div>
          <div className="command-palette-commit-body">
            <textarea
              ref={commitTextareaRef}
              className="command-palette-commit-textarea"
              value={commitMessageDraft}
              onChange={(event) => setCommitMessageDraft(event.target.value)}
              placeholder="Describe what changed…"
              rows={5}
              spellCheck={true}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closePalette();
                  return;
                }
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submitCommitMessage();
                }
              }}
            />
          </div>
          <div className="command-palette-commit-footer">
            <span className="command-palette-commit-hint">Ctrl+Enter to save</span>
            <div className="command-palette-commit-actions">
              <button
                type="button"
                className="command-palette-commit-secondary"
                onClick={closePalette}
              >
                Cancel
              </button>
              <button
                type="button"
                className="command-palette-commit-primary"
                onClick={submitCommitMessage}
                disabled={commitMessageDraft.trim() === ''}
              >
                Save version
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      {panel != null && typeof document !== 'undefined' ? createPortal(panel, document.body) : null}
    </>
  );
};

export default CommandPalette;
