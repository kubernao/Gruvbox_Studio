import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import AIAssistantTab from '../../features/assistant/AIAssistantTab';
import VersionControlTab from '../../features/git/VersionControlTab';
import MemoryTab from '../../features/memory/MemoryTab';
import { PALETTE_ACTION_EVENT, type PaletteActionEventDetail } from '../../features/palette/paletteActionEvents';
import './RightSidebar.css';

function classNames(...names: Array<string | false>): string {
  return names.filter(Boolean).join(' ');
}

/**
 * RightSidebar hosts Gruvie, version control, and memory tabs. API keys are configured in Gruvie settings.
 */
const RightSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const sidebarRootRef = useRef<HTMLDivElement | null>(null);
  const tabsHeaderRef = useRef<HTMLDivElement | null>(null);

  const tabs = ['Gruvie', 'History', 'Memory'];

  const openAiSettings = (): void => {
    setActiveTab(0);
    window.dispatchEvent(
      new CustomEvent<PaletteActionEventDetail>(PALETTE_ACTION_EVENT, {
        detail: { action: { kind: 'ai.openSettings' } },
      }),
    );
  };

  useEffect(() => {
    const handler = (event: Event): void => {
      const customEvent = event as CustomEvent<{ tab?: string; index?: number }>;
      const tab = customEvent.detail?.tab;
      if (typeof customEvent.detail?.index === 'number') {
        setActiveTab(customEvent.detail.index);
        return;
      }
      if (tab === 'ai') {
        setActiveTab(0);
      } else if (tab === 'version-control') {
        setActiveTab(1);
      } else if (tab === 'memory') {
        setActiveTab(2);
      }
    };
    window.addEventListener('app:right-sidebar-tab', handler as EventListener);
    return () => window.removeEventListener('app:right-sidebar-tab', handler as EventListener);
  }, []);

  useLayoutEffect(() => {
    const emitLayoutSnapshot = (runId: string): void => {
      const sidebarEl = sidebarRootRef.current;
      const headerEl = tabsHeaderRef.current;
      const panelEl = sidebarEl?.closest('.right-sidebar-panel') as HTMLElement | null;
      if (!sidebarEl || !headerEl || !panelEl) {
        return;
      }
      const panelRect = panelEl.getBoundingClientRect();
      const reservedTopWidth = Math.max(0, window.innerWidth - panelRect.left);
      document.documentElement.style.setProperty('--right-sidebar-top-width', `${reservedTopWidth}px`);
      void runId;
    };

    let rafId: number | null = null;
    const scheduleSnapshot = (runId: string): void => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        emitLayoutSnapshot(runId);
      });
    };

    emitLayoutSnapshot('pre-fix');
    const onResize = (): void => scheduleSnapshot('pre-fix-resize');
    window.addEventListener('resize', onResize);

    const sidebarEl = sidebarRootRef.current;
    const panelEl = sidebarEl?.closest('.right-sidebar-panel') as HTMLElement | null;
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => scheduleSnapshot('pre-fix-panel-resize'))
        : null;
    if (resizeObserver && panelEl) {
      resizeObserver.observe(panelEl);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      document.documentElement.style.removeProperty('--right-sidebar-top-width');
    };
  }, []);

  return (
    <div className="right-sidebar" ref={sidebarRootRef}>
      <div className="tabs-header" ref={tabsHeaderRef}>
        <div className="tabs-header-left">
          {tabs.map((tab, index) => (
            <button
              key={index}
              className={classNames('tab-button', activeTab === index && 'active')}
              onClick={() => setActiveTab(index)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="tabs-header-account">
          <button
            type="button"
            className="app-toolbar-button app-toolbar-signin right-sidebar-account-button"
            onClick={openAiSettings}
            title="API keys and model settings"
            aria-label="API keys and model settings"
          >
            <Settings size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="tabs-content">
        <div className={`tab-pane ${activeTab === 0 ? 'active' : ''}`}>
          <AIAssistantTab />
        </div>
        <div className={`tab-pane ${activeTab === 1 ? 'active' : ''}`}>
          <VersionControlTab />
        </div>
        <div className={`tab-pane ${activeTab === 2 ? 'active' : ''}`}>
          {activeTab === 2 ? <MemoryTab /> : null}
        </div>
      </div>
    </div>
  );
};

export default RightSidebar;
