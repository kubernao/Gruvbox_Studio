import React, { useCallback, useMemo } from 'react';
import { FolderOpen, FilePlus, Folder } from 'lucide-react';
import { isDarwin } from '../palette/platform';
import { getRecentWorkspaces } from './recentWorkspaces';
import './StudioWelcomeHero.css';

/**
 * Splits a workspace path into a display folder name and a parent path hint for the
 * recent-folders list without exposing the full string as the primary label.
 */
function formatRecentWorkspacePath(path: string): { name: string; parent: string } {
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  const name = segments[segments.length - 1] ?? path;
  const parent = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
  return { name, parent };
}

/**
 * Verbatim ASCII banner copied from `Gruvbox_landing/index.html` (`hero-brand-ascii`) so the empty
 * editor column shows the same “Gruvbox Studio” wordmark as the marketing site.
 */
const GRUVBOX_STUDIO_ASCII_ART = `   ▄██████▄     ▄████████ ███    █▄   ▄█    █   ▀█████████▄   ▄██████▄  ▀████    ▐████▀         ▄████████     ███     ███    █▄  ████████▄   ▄█   ▄██████▄
  ███    ███   ███    ███ ███    ███  ██    ██    ███    ███ ███    ███   ███▌   ████▀         ███    ███ ▀█████████▄ ███    ███ ███   ▀███ ███  ███    ███
  ███    █▀    ███    ███ ███    ███ ███    ███   ███    ███ ███    ███    ███  ▐███           ███    █▀     ▀███▀▀██ ███    ███ ███    ███ ███▌ ███    ███
 ▄███         ▄███▄▄▄▄██▀ ███    ███ ███    ███  ▄███▄▄▄██▀  ███    ███    ▀███▄███▀           ███            ███   ▀ ███    ███ ███    ███ ███▌ ███    ███
▀▀███ ████▄  ▀▀███▀▀▀▀▀   ███    ███ ███    ███ ▀▀███▀▀▀██▄  ███    ███    ████▀██▄          ▀███████████     ███     ███    ███ ███    ███ ███▌ ███    ███
  ███    ███ ▀███████████ ███    ███ ███    ███   ███    ██▄ ███    ███   ▐███  ▀███                  ███     ███     ███    ███ ███    ███ ███  ███    ███
  ███    ███   ███    ███ ███    ███  ███  ███    ███    ███ ███    ███  ▄███     ███▄          ▄█    ███     ███     ███    ███ ███   ▄███ ███  ███    ███
  ████████▀    ███    ███  ████████▀   ▀█████▀   ▄█████████▀   ▀██████▀  ████       ███▄       ▄████████▀     ▄████▀   ████████▀  ████████▀  █▀    ▀██████▀`;

const WELCOME_RECENT_WORKSPACE_LIMIT = 4;

type StudioWelcomeHeroProps = {
  onOpenFolder: () => void;
  onNewMarkdown: () => void;
  onOpenRecentWorkspace: (path: string) => void;
  workspaceOpen: boolean;
};

/**
 * StudioWelcomeHero fills the editor column when no document is open. The ASCII brand mark sits on
 * the vertical center line; the all-panels shortcut sits above it and file actions below.
 */
export const StudioWelcomeHero: React.FC<StudioWelcomeHeroProps> = ({
  onOpenFolder,
  onNewMarkdown,
  onOpenRecentWorkspace,
  workspaceOpen,
}) => {
  const mod = isDarwin() ? '⌘' : 'Ctrl';
  const recentWorkspaces = useMemo(
    () => getRecentWorkspaces().slice(0, WELCOME_RECENT_WORKSPACE_LIMIT),
    [],
  );

  const handleRecentClick = useCallback(
    (path: string) => {
      onOpenRecentWorkspace(path);
    },
    [onOpenRecentWorkspace],
  );

  return (
    <div className="editor-welcome">
      <div className="editor-welcome-top">
        <div
          className="layout-hidden-hint layout-hidden-hint-horizontal"
          role="note"
          aria-live="polite"
        >
          <span>{mod} + Shift + A</span>
          <span>all panels</span>
        </div>
      </div>

      <div className="editor-welcome-brand-stack">
        <div className="editor-welcome-ascii-layers" role="img" aria-label="Gruvbox Studio">
          <pre className="editor-welcome-ascii editor-welcome-ascii-base" aria-hidden="true">{GRUVBOX_STUDIO_ASCII_ART}</pre>
          <pre className="editor-welcome-ascii editor-welcome-ascii-gradient" aria-hidden="true">{GRUVBOX_STUDIO_ASCII_ART}</pre>
        </div>
      </div>

      <div className="editor-welcome-bottom">
        <div className="editor-welcome-main-row">
          {recentWorkspaces.length > 0 && (
            <section className="editor-welcome-recent" aria-labelledby="editor-welcome-recent-heading">
              <h3 id="editor-welcome-recent-heading" className="editor-welcome-recent-heading">
                Recent folders
              </h3>
              <ul className="editor-welcome-recent-list">
                {recentWorkspaces.map((path) => {
                  const { name, parent } = formatRecentWorkspacePath(path);
                  return (
                    <li key={path}>
                      <button
                        type="button"
                        className="editor-welcome-recent-item"
                        onClick={() => handleRecentClick(path)}
                        title={path}
                      >
                        <span className="editor-welcome-recent-item-icon" aria-hidden="true">
                          <Folder size={16} />
                        </span>
                        <span className="editor-welcome-recent-item-text">
                          <span className="editor-welcome-recent-item-name">{name}</span>
                          {parent !== '' && (
                            <span className="editor-welcome-recent-item-path">{parent}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="editor-welcome-actions">
            <button type="button" className="editor-welcome-action" onClick={onOpenFolder}>
              <FolderOpen size={16} aria-hidden="true" />
              <span>Open Folder</span>
              <kbd>{mod}+O</kbd>
            </button>
            <button
              type="button"
              className="editor-welcome-action"
              onClick={onNewMarkdown}
              disabled={!workspaceOpen}
            >
              <FilePlus size={16} aria-hidden="true" />
              <span>New Markdown</span>
              <kbd>{mod}+N</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
