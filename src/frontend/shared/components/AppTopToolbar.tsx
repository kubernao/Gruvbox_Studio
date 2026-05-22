import React from 'react';
import './AppTopToolbar.css';

type AppTopToolbarProps = {
  children: React.ReactNode;
};

/**
 * Full-width strip at the very top of the window (below the OS title bar in frameless apps).
 * Hosts the command palette affordance and can be extended with more toolbar controls.
 */
const AppTopToolbar: React.FC<AppTopToolbarProps> = ({ children }) => {
  return (
    <header className="app-top-toolbar" role="banner" data-testid="app-top-toolbar">
      <div className="app-top-toolbar-inner">{children}</div>
    </header>
  );
};

export default AppTopToolbar;
