import React from 'react';
import { isDarwin } from '../palette/platform';

/**
 * Verbatim ASCII banner copied from `Gruvbox_landing/index.html` (`hero-brand-ascii`) so the empty
 * editor column shows the same “Gruvbox Studio” wordmark as the marketing site, then the global
 * all-panels shortcut hint.
 */
const GRUVBOX_STUDIO_ASCII_ART = `   ▄██████▄     ▄████████ ███    █▄   ▄█    █   ▀█████████▄   ▄██████▄  ▀████    ▐████▀         ▄████████     ███     ███    █▄  ████████▄   ▄█   ▄██████▄
  ███    ███   ███    ███ ███    ███  ██    ██    ███    ███ ███    ███   ███▌   ████▀         ███    ███ ▀█████████▄ ███    ███ ███   ▀███ ███  ███    ███
  ███    █▀    ███    ███ ███    ███ ███    ███   ███    ███ ███    ███    ███  ▐███           ███    █▀     ▀███▀▀██ ███    ███ ███    ███ ███▌ ███    ███
 ▄███         ▄███▄▄▄▄██▀ ███    ███ ███    ███  ▄███▄▄▄██▀  ███    ███    ▀███▄███▀           ███            ███   ▀ ███    ███ ███    ███ ███▌ ███    ███
▀▀███ ████▄  ▀▀███▀▀▀▀▀   ███    ███ ███    ███ ▀▀███▀▀▀██▄  ███    ███    ████▀██▄          ▀███████████     ███     ███    ███ ███    ███ ███▌ ███    ███
  ███    ███ ▀███████████ ███    ███ ███    ███   ███    ██▄ ███    ███   ▐███  ▀███                  ███     ███     ███    ███ ███    ███ ███  ███    ███
  ███    ███   ███    ███ ███    ███  ███  ███    ███    ███ ███    ███  ▄███     ███▄          ▄█    ███     ███     ███    ███ ███   ▄███ ███  ███    ███
  ████████▀    ███    ███  ████████▀   ▀█████▀   ▄█████████▀   ▀██████▀  ████       ███▄       ▄████████▀     ▄████▀   ████████▀  ████████▀  █▀    ▀██████▀`;

/**
 * StudioWelcomeHero fills the editor column when no document is open. It shows the same ASCII
 * brand mark as `Gruvbox_landing/index.html` (stacked solid + gradient clipped layers so Chromium
 * does not show hairline seams between block glyphs), then reuses the shared `.layout-hidden-hint`
 * pill (horizontal variant: chord on one line, “all panels” below) so the reminder matches the
 * sidebar shortcut glyphs for the global toggle-all chord.
 */
export const StudioWelcomeHero: React.FC = () => {
  const mod = isDarwin() ? '⌘' : 'Ctrl';
  return (
    <div className="editor-welcome">
      <div className="editor-welcome-brand-stack">
        <div className="editor-welcome-ascii-layers" role="img" aria-label="Gruvbox Studio">
          <pre className="editor-welcome-ascii editor-welcome-ascii-base" aria-hidden="true">{GRUVBOX_STUDIO_ASCII_ART}</pre>
          <pre className="editor-welcome-ascii editor-welcome-ascii-gradient" aria-hidden="true">{GRUVBOX_STUDIO_ASCII_ART}</pre>
        </div>
      </div>
      <div
        className="layout-hidden-hint layout-hidden-hint-horizontal"
        role="note"
        aria-live="polite"
      >
        <span>{mod} + Shift + A</span>
        <span>all panels</span>
      </div>
    </div>
  );
};
