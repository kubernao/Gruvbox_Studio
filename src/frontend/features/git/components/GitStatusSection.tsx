/**
 * Git status section - shows uncommitted changes and Save Version button
 */

import React from 'react';
import type { GitStatusEntry, GithubTabAuthState } from '../types/git';
import { statusClass, shortPath } from '../utils/gitHelpers';

interface GitStatusSectionProps {
  statusEntries: GitStatusEntry[];
  githubAuthStatus: GithubTabAuthState;
  isBusy: boolean;
  githubFlowBusy: boolean;
  remoteSyncError: string;
  remoteSyncHint: string;
  saveVersionMessage: string;
  githubAuthFlowMessage: string;
  githubDeviceUserCode: string;
  showGithubSignInUi: boolean;
  onSaveVersion: () => void;
  onGithubSignIn: () => void;
  onGithubSignOut: () => void;
}

export const GitStatusSection: React.FC<GitStatusSectionProps> = ({
  statusEntries,
  githubAuthStatus,
  isBusy,
  githubFlowBusy,
  remoteSyncError,
  remoteSyncHint,
  saveVersionMessage,
  githubAuthFlowMessage,
  githubDeviceUserCode,
  showGithubSignInUi,
  onSaveVersion,
  onGithubSignIn,
  onGithubSignOut,
}) => {
  return (
    <section className="git-section" data-testid="git-status-section">
      {statusEntries.length === 0 ? (
        <p className="dim" data-testid="git-status-clean">
          No unsaved changes.
        </p>
      ) : (
        <ul className="status-list" data-testid="git-status-list">
          {statusEntries.map((entry) => (
            <li key={entry.file} title={entry.file}>
              <span className={`status-badge ${statusClass(entry.status)}`}>
                {entry.status}
              </span>
              <span className="status-file">{shortPath(entry.file)}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="primary-button git-save-version-button"
        disabled={statusEntries.length === 0 || isBusy}
        onClick={onSaveVersion}
        data-testid="git-save-version-button"
      >
        Save version
      </button>
      {saveVersionMessage !== '' && (
        <p className="dim git-save-version-message" role="status" data-testid="git-save-version-message">
          {saveVersionMessage}
        </p>
      )}

      <div className="git-github-row" data-testid="git-github-auth-row">
        {githubAuthStatus.connected ? (
          <>
            <span className="git-github-signed-label" data-testid="git-github-signed-label">
              GitHub: {githubAuthStatus.login}
            </span>
            <button
              type="button"
              className="git-github-link"
              disabled={githubFlowBusy}
              onClick={onGithubSignOut}
              data-testid="git-github-signout"
            >
              Sign out
            </button>
          </>
        ) : showGithubSignInUi ? (
          <button
            type="button"
            className="primary-button git-github-signin"
            disabled={githubFlowBusy}
            onClick={onGithubSignIn}
            data-testid="git-github-signin"
          >
            Sign in to GitHub
          </button>
        ) : null}

        {githubAuthStatus.reason === 'no_encryption' && (
          <p className="dim git-github-hint" data-testid="git-github-hint-no-encryption">
            GitHub sign-in needs OS-level encryption (safeStorage).
          </p>
        )}

        {githubDeviceUserCode !== '' && (
          <p className="git-github-device-code-hint" role="status" data-testid="git-github-device-code">
            <span className="git-github-device-code-prompt">Enter code</span>
            <span className="git-github-device-code-value">{githubDeviceUserCode}</span>
          </p>
        )}
        {githubAuthFlowMessage !== '' && !githubDeviceUserCode && (
          <p className="dim git-github-hint" role="status" data-testid="git-github-hint-auth-flow">
            {githubAuthFlowMessage}
          </p>
        )}

        {remoteSyncError !== '' && (
          <p className="git-graph-error git-remote-sync-message-near-github" role="alert" data-testid="git-remote-sync-error">
            {remoteSyncError}
          </p>
        )}
        {remoteSyncHint !== '' && (
          <p className="dim git-remote-sync-hint-near-github" role="status" data-testid="git-remote-sync-hint">
            {remoteSyncHint}
          </p>
        )}
      </div>
    </section>
  );
};
