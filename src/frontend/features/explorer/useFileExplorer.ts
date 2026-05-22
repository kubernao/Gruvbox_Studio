import { useContext } from 'react';
import { FileExplorerContext } from './FileExplorerContext';
import type { FileExplorerContextType } from './types';

export const useFileExplorer = (): FileExplorerContextType => {
  const context = useContext(FileExplorerContext);
  if (!context) {
    throw new Error('useFileExplorer must be used within FileExplorerProvider');
  }
  return context;
};

