import React from 'react';
import { ThemeProvider } from './features/theme/lib';
import { FileExplorerProvider } from './features/explorer/FileExplorerContext';
import { ToastProvider } from './shared/components/ToastContainer';
import ErrorBoundary from './shared/components/ErrorBoundary';
import { DiffViewerProvider, useDiffViewer } from './shared/contexts/DiffViewerContext';
import { AiInlineReviewProvider } from './shared/contexts/AiInlineReviewContext';
import MainLayout from './shared/components/MainLayout';
import ToastContainer from './shared/components/ToastContainer';
import CommandPalette from './features/palette/CommandPalette';
import AppToolbar from './shared/components/AppToolbar';
import QuickOpenHost from './shared/components/QuickOpenHost';
import FileOpsController from './features/editor/FileOpsController';
import { isDarwin } from './features/palette/platform';
import './App.css';

type LayoutVisibility = {
  showLeftSidebar: boolean;
  showRightSidebar: boolean;
  showTopToolbar: boolean;
};

const DEFAULT_VISIBILITY: LayoutVisibility = {
  showLeftSidebar: false,
  showRightSidebar: false,
  showTopToolbar: false,
};
const LAYOUT_VISIBILITY_STORAGE_KEY = 'app.layout.visibility.v1';

function shouldIgnoreLayoutHotkey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('.cm-editor') !== null) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function shortcutSymbolLabel(key: string): string {
  return `${isDarwin() ? '⌘' : 'Ctrl'} + Shift + ${key}`;
}

type DiffEntryAutoHideControllerProps = {
  onEnterDiff: () => void;
  onExitDiff: () => void;
};

/**
 * This controller listens for transitions into the diff center view and applies
 * one-time layout hiding for that transition only. It does not continuously force
 * the layout state while diff is open, so users keep full manual control to show
 * or hide the left sidebar and top toolbar with existing toggles.
 */
const DiffEntryAutoHideController: React.FC<DiffEntryAutoHideControllerProps> = ({
  onEnterDiff,
  onExitDiff,
}) => {
  const { centerView } = useDiffViewer();
  const wasDiffViewRef = React.useRef(centerView.kind === 'diff');

  React.useEffect(() => {
    const isDiffView = centerView.kind === 'diff';
    if (isDiffView && !wasDiffViewRef.current) {
      onEnterDiff();
    } else if (!isDiffView && wasDiffViewRef.current) {
      onExitDiff();
    }
    wasDiffViewRef.current = isDiffView;
  }, [centerView.kind, onEnterDiff, onExitDiff]);

  return null;
};

const App: React.FC = () => {
  const diffRestoreRef = React.useRef<Pick<LayoutVisibility, 'showLeftSidebar' | 'showTopToolbar'> | null>(
    null,
  );

  const [layoutState, setLayoutState] = React.useState<LayoutVisibility>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_VISIBILITY;
    }
    try {
      const raw = window.localStorage.getItem(LAYOUT_VISIBILITY_STORAGE_KEY);
      if (!raw) {
        return DEFAULT_VISIBILITY;
      }
      const parsed = JSON.parse(raw) as Partial<LayoutVisibility>;
      return {
        showLeftSidebar: parsed.showLeftSidebar === true,
        showRightSidebar: parsed.showRightSidebar === true,
        showTopToolbar: parsed.showTopToolbar === true,
      };
    } catch {
      return DEFAULT_VISIBILITY;
    }
  });

  const toggleZenMode = React.useCallback(() => {
    setLayoutState((prev) => {
      if (!prev.showLeftSidebar && !prev.showRightSidebar && !prev.showTopToolbar) {
        return prev;
      }
      return {
        showLeftSidebar: false,
        showRightSidebar: false,
        showTopToolbar: false,
      };
    });
  }, []);

  const toggleAllRegions = React.useCallback(() => {
    setLayoutState((prev) => {
      const allVisible = prev.showLeftSidebar && prev.showRightSidebar && prev.showTopToolbar;
      if (allVisible) {
        return {
          showLeftSidebar: false,
          showRightSidebar: false,
          showTopToolbar: false,
        };
      }
      return {
        showLeftSidebar: true,
        showRightSidebar: true,
        showTopToolbar: true,
      };
    });
  }, []);

  const toggleRegion = React.useCallback((region: keyof LayoutVisibility) => {
    setLayoutState((prev) => {
      const baseVisibility: LayoutVisibility = {
        showLeftSidebar: prev.showLeftSidebar,
        showRightSidebar: prev.showRightSidebar,
        showTopToolbar: prev.showTopToolbar,
      };
      const nextVisibility: LayoutVisibility = {
        ...baseVisibility,
        [region]: !baseVisibility[region],
      };
      return nextVisibility;
    });
  }, []);

  /**
   * This helper hides only the layout regions requested for diff and merge entry.
   * It keeps the right sidebar unchanged and runs only when a new diff session opens,
   * which preserves the user's ability to manually re-open hidden regions afterward.
   */
  const hideLayoutOnDiffEntry = React.useCallback(() => {
    setLayoutState((prev) => {
      diffRestoreRef.current = {
        showLeftSidebar: prev.showLeftSidebar,
        showTopToolbar: prev.showTopToolbar,
      };
      if (!prev.showLeftSidebar && !prev.showTopToolbar) {
        return prev;
      }
      return {
        ...prev,
        showLeftSidebar: false,
        showTopToolbar: false,
      };
    });
  }, []);

  /**
   * This helper restores the exact left sidebar and top toolbar visibility that
   * existed before the current diff/merge session was opened. It is triggered
   * once when leaving diff view, and it intentionally keeps right sidebar state
   * untouched so only the auto-hidden regions are restored.
   */
  const restoreLayoutAfterDiffClose = React.useCallback(() => {
    const restore = diffRestoreRef.current;
    diffRestoreRef.current = null;
    if (!restore) {
      return;
    }
    setLayoutState((prev) => {
      if (
        prev.showLeftSidebar === restore.showLeftSidebar &&
        prev.showTopToolbar === restore.showTopToolbar
      ) {
        return prev;
      }
      return {
        ...prev,
        showLeftSidebar: restore.showLeftSidebar,
        showTopToolbar: restore.showTopToolbar,
      };
    });
  }, []);

  React.useEffect(() => {
    window.localStorage.setItem(LAYOUT_VISIBILITY_STORAGE_KEY, JSON.stringify(layoutState));
  }, [layoutState]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modKey = isDarwin() ? event.metaKey : event.ctrlKey;
      if (!modKey || !event.shiftKey || shouldIgnoreLayoutHotkey(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        toggleZenMode();
        return;
      }
      if (key === 'a') {
        event.preventDefault();
        toggleAllRegions();
        return;
      }
      if (key === 'l') {
        event.preventDefault();
        toggleRegion('showLeftSidebar');
        return;
      }
      if (key === 'r') {
        event.preventDefault();
        toggleRegion('showRightSidebar');
        return;
      }
      if (key === 't') {
        event.preventDefault();
        toggleRegion('showTopToolbar');
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [toggleAllRegions, toggleRegion, toggleZenMode]);

  React.useEffect(() => {
    const onLayoutToggle = (event: Event): void => {
      const customEvent = event as CustomEvent<{ kind?: 'zen' | 'all' | 'left' | 'right' | 'top' }>;
      const kind = customEvent.detail?.kind;
      if (kind === 'zen') {
        toggleZenMode();
      } else if (kind === 'all') {
        toggleAllRegions();
      } else if (kind === 'left') {
        toggleRegion('showLeftSidebar');
      } else if (kind === 'right') {
        toggleRegion('showRightSidebar');
      } else if (kind === 'top') {
        toggleRegion('showTopToolbar');
      }
    };
    window.addEventListener('app:layout-toggle', onLayoutToggle as EventListener);
    return () => window.removeEventListener('app:layout-toggle', onLayoutToggle as EventListener);
  }, [toggleAllRegions, toggleRegion, toggleZenMode]);

  const topToolbarShortcut = shortcutSymbolLabel('T');
  const leftSidebarShortcut = shortcutSymbolLabel('L');
  const rightSidebarShortcut = shortcutSymbolLabel('R');

  return (
    <ErrorBoundary>
      <ThemeProvider initialTheme="dark">
        <ToastProvider>
          <FileExplorerProvider>
            <FileOpsController />
            <DiffViewerProvider>
              <AiInlineReviewProvider>
              <div className="app-root">
                <DiffEntryAutoHideController
                  onEnterDiff={hideLayoutOnDiffEntry}
                  onExitDiff={restoreLayoutAfterDiffClose}
                />
                <CommandPalette />
                <QuickOpenHost />
                {layoutState.showTopToolbar ? (
                  <AppToolbar />
                ) : (
                  <div className="app-hidden-top-hint" role="note" aria-live="polite">
                    <span>{topToolbarShortcut}</span>
                  </div>
                )}
                <main className="app-main">
                  <MainLayout
                    showLeftSidebar={layoutState.showLeftSidebar}
                    showRightSidebar={layoutState.showRightSidebar}
                    showTopToolbar={layoutState.showTopToolbar}
                    leftSidebarShortcut={leftSidebarShortcut}
                    rightSidebarShortcut={rightSidebarShortcut}
                  />
                </main>
                <ToastContainer />
              </div>
              </AiInlineReviewProvider>
            </DiffViewerProvider>
          </FileExplorerProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;

