/**
 * Document dropdown/combobox for file selection
 */

import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import fuzzysort from 'fuzzysort';
import { gitDocumentRowId, shortPath } from '../utils/gitHelpers';

const DROPDOWN_MAX_HEIGHT_PX = 280;
const DROPDOWN_VIEWPORT_PAD_PX = 8;
const DROPDOWN_GAP_PX = 4;
const MENU_PORTAL_Z = 8000;

interface MenuBox {
  top?: number;
  left: number;
  width: number;
  maxHeight: number;
  bottom?: number;
}

function portaledMenuStyle(box: MenuBox, z: number): CSSProperties {
  const style: CSSProperties = {
    position: 'fixed',
    left: box.left,
    width: box.width,
    maxHeight: box.maxHeight,
    zIndex: z,
  };
  if (box.top != null) {
    style.top = box.top;
  } else if (box.bottom != null) {
    style.bottom = box.bottom;
  }
  return style;
}

interface ComboboxRow {
  path: string;
  prefix: string;
  suffix: string;
  searchText: string;
}

interface DocumentDropdownProps {
  trackedFiles: string[];
  selectedDocument: string;
  documentInputText: string;
  isDropdownOpen: boolean;
  onDocumentSelect: (path: string) => void;
  onInputChange: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onCaretClick: () => void;
}

export const DocumentDropdown: React.FC<DocumentDropdownProps> = ({
  trackedFiles,
  selectedDocument,
  documentInputText,
  isDropdownOpen,
  onDocumentSelect,
  onInputChange,
  onFocus,
  onBlur,
  onKeyDown,
  onCaretClick,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const MAX_VISIBLE_ROWS = 100;

  const allRows = useMemo<ComboboxRow[]>(() => {
    return trackedFiles.map((file) => {
      const normalized = file.replace(/\\/g, '/');
      const parts = normalized.split('/');
      const suffix = parts[parts.length - 1] || file;
      const prefix = parts.slice(0, -1).join('/');
      return { path: file, prefix, suffix, searchText: `${normalized} ${suffix}` };
    });
  }, [trackedFiles]);

  // Filter files based on input, with fuzzy ranking for typed queries.
  const displayRows: ComboboxRow[] = useMemo(() => {
    const query = documentInputText.trim();
    if (query === '') {
      return allRows.slice(0, MAX_VISIBLE_ROWS);
    }
    const matches = fuzzysort.go(query, allRows, {
      keys: ['searchText', 'path'],
      threshold: -8000,
      limit: MAX_VISIBLE_ROWS,
    });
    return matches.map((match) => match.obj);
  }, [allRows, documentInputText]);

  useEffect(() => {
    if (!isDropdownOpen) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex((previous) => {
      if (displayRows.length === 0) return -1;
      if (previous < 0) return 0;
      if (previous >= displayRows.length) return displayRows.length - 1;
      return previous;
    });
  }, [isDropdownOpen, displayRows]);

  useEffect(() => {
    if (highlightedIndex < 0) return;
    const activeRow = document.getElementById(gitDocumentRowId(highlightedIndex));
    activeRow?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const activeDescendantId =
    highlightedIndex >= 0 && displayRows[highlightedIndex] != null
      ? gitDocumentRowId(highlightedIndex)
      : undefined;

  const handleCaretButtonClick = () => {
    onCaretClick();
    inputRef.current?.focus();
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isDropdownOpen) {
      onKeyDown(e);
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => {
          if (displayRows.length === 0) return -1;
          if (prev < 0) return 0;
          return prev < displayRows.length - 1 ? prev + 1 : prev;
        });
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => {
          if (displayRows.length === 0) return -1;
          return prev > 0 ? prev - 1 : 0;
        });
        break;
      case 'Enter':
        e.preventDefault();
        {
          const chosenIndex = highlightedIndex >= 0 ? highlightedIndex : 0;
          const chosen = displayRows[chosenIndex];
          if (chosen != null) {
            onDocumentSelect(chosen.path);
            setHighlightedIndex(-1);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        onBlur();
        break;
      default:
        onKeyDown(e);
    }
  };

  const handleItemClick = (path: string) => {
    onDocumentSelect(path);
    setHighlightedIndex(-1);
  };

  const updateMenuPosition = useCallback(() => {
    if (!isDropdownOpen) {
      setMenuBox(null);
      return;
    }
    const el = anchorRef.current;
    if (el == null) {
      setMenuBox(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      setMenuBox(null);
      return;
    }

    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom - DROPDOWN_GAP_PX - DROPDOWN_VIEWPORT_PAD_PX;
    const spaceAbove = rect.top - DROPDOWN_GAP_PX - DROPDOWN_VIEWPORT_PAD_PX;
    const hBelow = Math.min(
      DROPDOWN_MAX_HEIGHT_PX,
      Math.max(0, spaceBelow),
    );
    const hAbove = Math.min(
      DROPDOWN_MAX_HEIGHT_PX,
      Math.max(0, spaceAbove),
    );
    // Open above when the panel would be too cramped under the field but more room is available on top
    const openAbove = hBelow < 96 && hAbove > hBelow;

    if (openAbove) {
      setMenuBox({
        left: rect.left,
        width: rect.width,
        maxHeight: hAbove,
        bottom: vh - rect.top + DROPDOWN_GAP_PX,
      });
    } else {
      setMenuBox({
        top: rect.bottom + DROPDOWN_GAP_PX,
        left: rect.left,
        width: rect.width,
        maxHeight: hBelow,
      });
    }
  }, [isDropdownOpen]);

  useLayoutEffect(() => {
    updateMenuPosition();
  }, [updateMenuPosition, isDropdownOpen, displayRows.length]);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const onReposition = () => updateMenuPosition();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [isDropdownOpen, updateMenuPosition, displayRows.length]);

  useEffect(() => {
    if (isDropdownOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isDropdownOpen]);

  const placeholder = trackedFiles.length === 0 ? 'No documents' : 'Select or type document name...';
  const inputValue =
    documentInputText !== '' || isDropdownOpen
      ? documentInputText
      : selectedDocument !== ''
        ? shortPath(selectedDocument)
        : '';

  return (
    <section className="git-section git-document-section" data-testid="git-document-section">
      <h2>Document</h2>

      {trackedFiles.length === 0 ? (
        <p className="dim" data-testid="git-empty-document-state">
          No tracked documents found.
        </p>
      ) : (
        <div className="document-dropdown">
          <div
            className="document-select document-combobox"
            ref={anchorRef}
          >
            <input
              ref={inputRef}
              type="text"
              className="document-combobox-input"
              placeholder={placeholder}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onFocus={onFocus}
              onBlur={onBlur}
              onKeyDown={handleKeyDown}
              role="combobox"
              aria-expanded={isDropdownOpen}
              aria-controls="git-document-combobox-list"
              aria-activedescendant={activeDescendantId}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              data-testid="git-document-combobox"
            />
            <button
              type="button"
              className="document-combobox-caret"
              tabIndex={-1}
              aria-label="Toggle document list"
              onClick={handleCaretButtonClick}
              onMouseDown={(e) => e.preventDefault()}
            >
              <span className="document-select-caret" aria-hidden="true">▾</span>
            </button>
          </div>

          {typeof document !== 'undefined' &&
            isDropdownOpen &&
            displayRows.length > 0 &&
            menuBox != null &&
            createPortal(
              <ul
                id="git-document-combobox-list"
                className="document-dropdown-menu document-dropdown-menu--portaled"
                role="listbox"
                style={portaledMenuStyle(menuBox, MENU_PORTAL_Z)}
                onMouseDown={(e) => e.preventDefault()}
              >
                {displayRows.map((row, fileIndex) => (
                  <li key={row.path}>
                    <button
                      type="button"
                      className={`document-dropdown-item ${
                        selectedDocument === row.path ? 'selected' : ''
                      } ${highlightedIndex === fileIndex ? 'is-active' : ''}`}
                      id={gitDocumentRowId(fileIndex)}
                      role="option"
                      aria-selected={highlightedIndex === fileIndex}
                      onClick={() => handleItemClick(row.path)}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {row.prefix !== '' && (
                        <span className="document-option-prefix">{row.prefix}/</span>
                      )}
                      <span className="document-option-suffix">{row.suffix}</span>
                    </button>
                  </li>
                ))}
              </ul>,
              document.body,
            )}
        </div>
      )}
    </section>
  );
};
