import React from 'react';
import { fileNameFromPath } from '../../shared/utils/pathParts';
import './SyncPrompt.css';

interface SyncPromptProps {
  isOpen: boolean;
  filePath: string;
  onKeepLocal: () => void;
  onLoadExternal: () => void;
  isLoading?: boolean;
}

/**
 * Modal dialog displayed when external file changes conflict with unsaved editor changes
 */
const SyncPrompt: React.FC<SyncPromptProps> = ({
  isOpen,
  filePath,
  onKeepLocal,
  onLoadExternal,
  isLoading = false,
}) => {
  if (!isOpen) return null;

  const fileName = fileNameFromPath(filePath);

  return (
    <div className="sync-prompt-overlay">
      <div className="sync-prompt-modal">
        <div className="sync-prompt-header">
          <h2>File Changed Externally</h2>
          <p className="sync-prompt-file">{fileName}</p>
        </div>
        
        <div className="sync-prompt-content">
          <p className="sync-prompt-message">
            This file has been modified outside of the editor. You have unsaved changes in the editor.
            What would you like to do?
          </p>
        </div>

        <div className="sync-prompt-actions">
          <button
            className="sync-prompt-btn sync-prompt-btn-keep"
            onClick={onKeepLocal}
            disabled={isLoading}
          >
            <span className="sync-prompt-btn-icon">✓</span>
            Keep My Changes
          </button>
          
          <button
            className="sync-prompt-btn sync-prompt-btn-load"
            onClick={onLoadExternal}
            disabled={isLoading}
          >
            <span className="sync-prompt-btn-icon">↻</span>
            Load External Version
          </button>
        </div>

        <div className="sync-prompt-footer">
          <p className="sync-prompt-hint">
            • Keep My Changes: discard the external file changes
          </p>
          <p className="sync-prompt-hint">
            • Load External: replace your unsaved work with the external version
          </p>
        </div>
      </div>
    </div>
  );
};

export default SyncPrompt;
