import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import fuzzysort from 'fuzzysort';
import { Search } from 'lucide-react';
import { collectWorkspaceFileRows, rankWorkspaceFileRows } from './workspaceFileIndex';
import type { FileTreeNode } from '../explorer/types';
import './QuickOpenModal.css';

export const OPEN_QUICK_OPEN_EVENT = 'app:open-quick-open';

type QuickOpenModalProps = {
  rootPath: string;
  fileTree: FileTreeNode | null;
  onPick: (absolutePath: string) => void;
};

/**
 * QuickOpenModal presents a fuzzy file picker over the entire workspace tree,
 * opened via Cmd/Ctrl+P or the File menu, so users can jump to files without
 * hunting through the sidebar tree.
 */
export default function QuickOpenModal({ rootPath, fileTree, onPick }: QuickOpenModalProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const allRows = useMemo(
    () => rankWorkspaceFileRows(collectWorkspaceFileRows(fileTree, rootPath)),
    [fileTree, rootPath],
  );

  const visibleRows = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      return allRows.slice(0, 100);
    }
    const matches = fuzzysort.go(trimmed, allRows, {
      keys: ['searchText', 'relativePath', 'fileName'],
      threshold: -8000,
      limit: 100,
    });
    return matches.map((match) => match.obj);
  }, [allRows, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const pickRow = useCallback(
    (index: number) => {
      const row = visibleRows[index];
      if (row == null) {
        return;
      }
      onPick(row.absolutePath);
      close();
    },
    [close, onPick, visibleRows],
  );

  useEffect(() => {
    const onOpen = () => {
      if (rootPath.trim() === '') {
        return;
      }
      setOpen(true);
      setQuery('');
      setActiveIndex(0);
    };
    window.addEventListener(OPEN_QUICK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_QUICK_OPEN_EVENT, onOpen);
  }, [rootPath]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActiveIndex((prev) => {
      if (visibleRows.length === 0) {
        return 0;
      }
      if (prev >= visibleRows.length) {
        return visibleRows.length - 1;
      }
      return prev;
    });
  }, [visibleRows.length]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="quick-open-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div className="quick-open-panel" role="dialog" aria-label="Go to file">
        <div className="quick-open-input-row">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="quick-open-input"
            placeholder="Type a file name…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((prev) => Math.min(prev + 1, Math.max(visibleRows.length - 1, 0)));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((prev) => Math.max(prev - 1, 0));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                pickRow(activeIndex);
              }
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <ul className="quick-open-list" role="listbox">
          {visibleRows.length === 0 ? (
            <li className="quick-open-empty">No matching files</li>
          ) : (
            visibleRows.map((row, index) => (
              <li key={row.absolutePath}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`quick-open-item${index === activeIndex ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickRow(index)}
                >
                  {row.prefix !== '' && <span className="quick-open-prefix">{row.prefix}/</span>}
                  <span className="quick-open-name">{row.fileName}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Opens the workspace quick-open modal when a workspace folder is already loaded.
 */
export function openQuickOpenModal(): void {
  window.dispatchEvent(new Event(OPEN_QUICK_OPEN_EVENT));
}
