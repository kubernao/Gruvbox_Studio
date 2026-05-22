/**
 * Renderer process entry point
 * This file is loaded by Electron Forge's webpack plugin
 */

import appIconUrl from '../../resources/app-icon.png';

/**
 * Registers favicon and Apple touch icon link tags in the document head so the
 * Electron window title area, task switchers, and any embedded browser chrome
 * that reads standard link relations all pick up the same branding asset as
 * the packaged desktop application icon.
 *
 * @param {string} iconUrl Webpack-resolved URL for the PNG icon asset.
 * @returns {void}
 */
function installRendererTabIcons(iconUrl) {
  if (typeof document === 'undefined') {
    return;
  }
  const head = document.head;
  if (!head) {
    return;
  }
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/png';
  favicon.href = iconUrl;
  head.appendChild(favicon);
  const appleTouch = document.createElement('link');
  appleTouch.rel = 'apple-touch-icon';
  appleTouch.href = iconUrl;
  head.appendChild(appleTouch);
}

installRendererTabIcons(appIconUrl);

import './main.tsx';

