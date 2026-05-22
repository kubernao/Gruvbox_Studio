import React, { useEffect, useRef } from 'react';
import { FolderOpen, Loader } from 'lucide-react';
import { useFileExplorer } from '../useFileExplorer';
import { useToast } from '../../../shared/hooks/useToast';
import { IPCService } from '../../../shared/utils/ipc';
import { getFriendlyErrorMessage } from '../../../shared/utils/errorMessages';
import FileTree from './FileTree';
import './FileExplorer.css';

const FileExplorer: React.FC = () => {
  const { setRootPath, rootPath, isLoading } = useFileExplorer();
  const { showError, showSuccess } = useToast();
  const ipcRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      ipcRef.current = (window as any).electronAPI;
    }
  }, []);

  const handleOpenFolder = async () => {
    try {
      const result = await IPCService.showOpenDialog();
      
      if (result.canceled === false && result.filePaths.length > 0) {
        const folderPath = result.filePaths[0];
        try {
          await setRootPath(folderPath);
          showSuccess('Folder opened successfully');
        } catch (error) {
          const friendlyMessage = getFriendlyErrorMessage(error, 'folder');
          showError(friendlyMessage);
          console.error('Failed to open folder:', error);
        }
      }
    } catch (error) {
      const friendlyMessage = getFriendlyErrorMessage(error, 'folder');
      showError(friendlyMessage);
      console.error('Failed to open folder dialog:', error);
    }
  };

  return (
    <div className="file-explorer">
      {!rootPath ? (
        <div className="file-explorer-header">
          <button
            className="open-folder-btn"
            onClick={handleOpenFolder}
            title="Open Folder"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader size={18} className="spinner" />
            ) : (
              <FolderOpen size={18} />
            )}
            <span>{isLoading ? 'Loading...' : 'Open Folder'}</span>
          </button>
        </div>
      ) : null}
      <div className="file-explorer-tree">
        <FileTree />
      </div>
    </div>
  );
};

export default FileExplorer;
