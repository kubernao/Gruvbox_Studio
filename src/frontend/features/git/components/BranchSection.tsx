/**
 * Branch Section — branch controls (open diff)
 */

import React from 'react';

interface BranchSectionProps {
  branchError: string;
  isBusy: boolean;
  isGitRefreshBusy: boolean;
  isRemoteSyncBusy: boolean;
  fileLogCount: number;
  onOpenDiff: () => void;
}

export const BranchSection: React.FC<BranchSectionProps> = ({
  branchError,
  isBusy,
  isGitRefreshBusy,
  isRemoteSyncBusy,
  fileLogCount,
  onOpenDiff,
}) => {
  const isDisabled = isBusy || isGitRefreshBusy || isRemoteSyncBusy;

  return (
    <section
      className="git-section git-branches-section"
      data-testid="git-branches-section"
    >
      <h2>Branches</h2>

      {branchError && (
        <p className="git-graph-error" role="alert">
          {branchError}
        </p>
      )}

      <div className="git-branches-wrap">
        <div className="git-branch-top-row">
          <button
            type="button"
            className="primary-button git-branch-open-diff-button"
            disabled={isDisabled || fileLogCount === 0}
            onClick={onOpenDiff}
            data-testid="git-open-diff-button"
          >
            Open Difference
          </button>
        </div>
      </div>
    </section>
  );
};
