import { useMemo, useState } from 'react';
import './DocumentTabsReact.css';

export interface DocumentTabItem {
  path: string;
  pinned: boolean;
  dirty: boolean;
}

interface DocumentTabsReactProps {
  tabs: DocumentTabItem[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onReorder: (paths: string[]) => void;
  onTogglePin: (path: string) => void;
  showHistoryPreviewClose?: boolean;
  onCloseHistoryPreview?: () => void;
}

function getFileName(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

export default function DocumentTabsReact({
  tabs,
  activePath,
  onSelect,
  onClose,
  onReorder,
  onTogglePin,
  showHistoryPreviewClose = false,
  onCloseHistoryPreview,
}: DocumentTabsReactProps) {
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const orderedTabs = useMemo(() => tabs, [tabs]);

  const commitReorder = (fromPath: string, toPath: string) => {
    if (fromPath === toPath) {
      return;
    }
    const current = orderedTabs.map((tab) => tab.path);
    const fromIndex = current.indexOf(fromPath);
    const toIndex = current.indexOf(toPath);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onReorder(next);
  };

  return (
    <div className="document-tablist-wrapper-react">
      {showHistoryPreviewClose && typeof onCloseHistoryPreview === 'function' && (
        <button
          type="button"
          className="history-preview-tab-close-button"
          onClick={onCloseHistoryPreview}
          aria-label="Close history preview"
          title="Close history preview"
        >
          ×
        </button>
      )}
      <div className="document-tab-container-react" role="tablist" aria-label="Open files">
        {orderedTabs.map((tab, tabIndex) => {
          const active = tab.path === activePath;
          const dragging = tab.path === draggingPath;
          const dragOver = tab.path === dragOverPath && draggingPath !== null && draggingPath !== tab.path;
          const tabCount = orderedTabs.length;
          /** Position along the row (0 = left, 1 = right) drives border brightness gradient in CSS. */
          const tabPositionRatio = tabCount <= 1 ? 0 : tabIndex / (tabCount - 1);
          /** Inactive tabs stack left-to-right; active tab always paints above neighbors. */
          const stackZ = active ? 1000 : 100 + tabIndex;

          return (
            <div
              key={tab.path}
              role="tab"
              aria-selected={active}
              draggable
              title={tab.path}
              style={
                {
                  '--document-tab-position': String(tabPositionRatio),
                  zIndex: stackZ,
                } as React.CSSProperties
              }
              className={[
                'document-tab-react',
                active ? 'active' : '',
                tab.dirty ? 'modified' : '',
                tab.pinned ? 'pinned' : '',
                dragging ? 'dragging' : '',
                dragOver ? 'dragover' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(tab.path)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', tab.path);
                setDraggingPath(tab.path);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverPath(tab.path);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourcePath = event.dataTransfer.getData('text/plain');
                commitReorder(sourcePath, tab.path);
                setDraggingPath(null);
                setDragOverPath(null);
              }}
              onDragEnd={() => {
                setDraggingPath(null);
                setDragOverPath(null);
              }}
            >
              <span className="filename-react">
                {tab.pinned ? '[P] ' : ''}
                {getFileName(tab.path)}
                {tab.dirty ? <span className="unsaved-indicator-react"> •</span> : null}
              </span>
              <button
                type="button"
                className="tab-pin-react"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePin(tab.path);
                }}
                aria-label={tab.pinned ? 'Unpin tab' : 'Pin tab'}
                title={tab.pinned ? 'Unpin tab' : 'Pin tab'}
              >
              </button>
              {!tab.pinned ? (
                <button
                  type="button"
                  className="tab-close-react"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.path);
                  }}
                  aria-label="Close tab"
                  title="Close tab"
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
        <div className="tab-filler-react" aria-hidden="true" />
      </div>
    </div>
  );
}
