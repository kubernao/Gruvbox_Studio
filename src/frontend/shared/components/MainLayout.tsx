import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import Sidebar from './Sidebar';
import RightSidebar from './RightSidebar';
import EditorPane from '../../features/editor/EditorPane';
import { useDiffViewer } from '../contexts/DiffViewerContext';
import { FileExplorerContext } from '../../features/explorer/FileExplorerContext';
import './MainLayout.css';

const DiffViewer = React.lazy(async () => {
  const module = await import('../../components/DiffViewer');
  return { default: module.DiffViewer };
});
function normalizeRepoRelativePath(filePath?: string): string | undefined {
  if (!filePath) return filePath;
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

type MainLayoutProps = {
  showLeftSidebar: boolean;
  showRightSidebar: boolean;
  showTopToolbar: boolean;
  leftSidebarShortcut: string;
  rightSidebarShortcut: string;
};

const MainLayout: React.FC<MainLayoutProps> = ({
  showLeftSidebar,
  showRightSidebar,
  showTopToolbar,
  leftSidebarShortcut,
  rightSidebarShortcut,
}) => {
  const { centerView, closeDiff, closeHistoryPreview } = useDiffViewer();
  const fileExplorer = React.useContext(FileExplorerContext);
  const leftSeparatorRef = useRef<HTMLDivElement | null>(null);
  const rightSeparatorRef = useRef<HTMLDivElement | null>(null);
  const [leftSeparatorNear, setLeftSeparatorNear] = useState(false);
  const [rightSeparatorNear, setRightSeparatorNear] = useState(false);

  const resolveAbsoluteFilePath = useCallback((repoPath: string, relativeFilePath: string): string => {
    const base = repoPath.replace(/[\\/]+$/, '');
    const normalizedRel = relativeFilePath.replace(/^\.?[\\/]+/, '');
    const separator = base.includes('\\') ? '\\' : '/';
    return `${base}${separator}${normalizedRel.replace(/[\\/]/g, separator)}`;
  }, []);

  const handleMergeSaved = useCallback(
    ({ repoPath, filePath }: { repoPath: string; filePath: string }) => {
      if (!fileExplorer?.selectFile) {
        return;
      }
      const absolutePath = resolveAbsoluteFilePath(repoPath, filePath);
      fileExplorer.selectFile(absolutePath);
    },
    [fileExplorer, resolveAbsoluteFilePath],
  );

  const fetchDiff = useCallback(
    async (args: {
      repoPath: string;
      hash1: string;
      hash2: string;
      filePath?: string;
      fullContext?: boolean;
    }): Promise<string> => {
      const invoke = window.electronAPI?.invoke;
      if (!invoke) {
        throw new Error('Electron invoke is not available.');
      }
      const result = await invoke('git-provider', {
        command: 'git-diff',
        repoPath: args.repoPath,
        hash1: args.hash1,
        hash2: args.hash2,
        filePath: normalizeRepoRelativePath(args.filePath),
        fullContext: args.fullContext === true,
      });
      if (typeof result === 'string') return result;
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as any).error));
      }
      return '';
    },
    [],
  );

  useEffect(() => {
    const proximityPx = 36;

    const isNearSeparator = (separatorElement: HTMLDivElement | null, cursorX: number): boolean => {
      if (!separatorElement) return false;
      const rect = separatorElement.getBoundingClientRect();
      const separatorCenterX = rect.left + rect.width / 2;
      return Math.abs(cursorX - separatorCenterX) <= proximityPx;
    };

    const handleMouseMove = (event: MouseEvent): void => {
      const nextLeftNear = isNearSeparator(leftSeparatorRef.current, event.clientX);
      const nextRightNear = isNearSeparator(rightSeparatorRef.current, event.clientX);
      setLeftSeparatorNear((prev) => (prev === nextLeftNear ? prev : nextLeftNear));
      setRightSeparatorNear((prev) => (prev === nextRightNear ? prev : nextRightNear));
    };

    const handleMouseLeaveWindow = (event: MouseEvent): void => {
      if (event.relatedTarget) return;
      setLeftSeparatorNear(false);
      setRightSeparatorNear(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseout', handleMouseLeaveWindow);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseout', handleMouseLeaveWindow);
    };
  }, []);

  return (
    <Group
      className={`main-layout${showTopToolbar ? '' : ' toolbar-hidden'}`}
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
    >
      {showLeftSidebar ? (
        <>
          <Panel defaultSize="14%" minSize="14%" maxSize="28vw" className="sidebar-panel">
            <Sidebar />
          </Panel>

          <Separator
            className={`sidebar-resize-separator sidebar-resize-separator-left${leftSeparatorNear ? ' is-near' : ''}`}
            elementRef={leftSeparatorRef}
          />
        </>
      ) : (
        <div className="layout-hidden-hint layout-hidden-hint-left" role="note" aria-live="polite">
          {leftSidebarShortcut}
        </div>
      )}

      <Panel defaultSize="61%" minSize="35%" className="editor-panel">
        <div className="editor-panel-content" data-testid={`main-center-${centerView.kind}`}>
          {centerView.kind === 'diff' && (
            <Suspense fallback={<div className="editor-panel-content">Loading diff tools...</div>}>
              <DiffViewer
                repoPath={centerView.session.repoPath}
                filePath={centerView.session.filePath}
                initialViewMode={centerView.session.initialViewMode}
                hash1={centerView.session.hash1}
                hash2={centerView.session.hash2}
                hashBase={centerView.session.hashBase}
                aiProposedEdits={centerView.session.aiProposedEdits}
                uiPolicyPreset={centerView.session.uiPolicyPreset}
                branchMerge={centerView.session.branchMerge}
                aiWorktreePath={centerView.session.aiWorktreePath}
                aiWorktreePathB={centerView.session.aiWorktreePathB}
                dualAiMerge={centerView.session.dualAiMerge}
                mergePendingPaths={centerView.session.mergePendingPaths}
                onFetchDiff={fetchDiff}
                onMergeSaved={handleMergeSaved}
                onClose={closeDiff}
              />
            </Suspense>
          )}
          {(centerView.kind === 'editor' || centerView.kind === 'history-preview') && (
            <EditorPane
              historyPreview={centerView.kind === 'history-preview' ? centerView.preview : null}
              onCloseHistoryPreview={centerView.kind === 'history-preview' ? closeHistoryPreview : undefined}
            />
          )}
        </div>
      </Panel>

      {showRightSidebar ? (
        <>
          <Separator
            className={`sidebar-resize-separator sidebar-resize-separator-right${rightSeparatorNear ? ' is-near' : ''}`}
            elementRef={rightSeparatorRef}
          />

          <Panel
            defaultSize="28vw"
            minSize="14%"
            maxSize="28vw"
            className="right-sidebar-panel"
            // Override library inner `overflow: auto` (merged after defaults) to avoid edge compositing artifacts; tabs handle their own scroll.
            style={{ overflow: 'hidden' }}
          >
            <RightSidebar />
          </Panel>
        </>
      ) : (
        <div className="layout-hidden-hint layout-hidden-hint-right" role="note" aria-live="polite">
          {rightSidebarShortcut}
        </div>
      )}
    </Group>
  );
};

export default MainLayout;
