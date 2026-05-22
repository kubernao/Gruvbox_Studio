/**
 * Git state notice - shows when no workspace or not a git repo
 */

import React from 'react';

interface GitStateNoticeProps {
  state: 'no-workspace' | 'non-repo';
  onInitRepo?: () => void;
  disabled?: boolean;
}

export const GitStateNotice: React.FC<GitStateNoticeProps> = ({ state, onInitRepo, disabled }) => {
  if (state === 'no-workspace') {
    return (
      <p className="notice" data-testid="git-state-no-workspace">
        Open a workspace folder to use version control.
      </p>
    );
  }

  return (
    <>
      <p className="notice" data-testid="git-state-non-repo">
        This folder is not yet tracked. Start tracking changes to keep a full history of every version of your work.
      </p>
      <button 
        className="primary-button" 
        onClick={onInitRepo}
        disabled={disabled}
        data-testid="git-init-button"
      >
        Start tracking this folder
      </button>
    </>
  );
};
