/**
 * Custom React hook for file watching
 * Provides watch capabilities for a directory with event handling
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { IPCService, FileEvent, IPCError } from '../../shared/utils/ipc';

export interface UseFileWatcherResult {
  watchingPath: string | null;
  isWatching: boolean;
  events: FileEvent[];
  error: IPCError | null;
  startWatching: (path: string) => Promise<boolean>;
  stopWatching: () => Promise<boolean>;
  clearEvents: () => void;
  clearError: () => void;
}

export const useFileWatcher = (): UseFileWatcherResult => {
  const [watchingPath, setWatchingPath] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [events, setEvents] = useState<FileEvent[]>([]);
  const [error, setError] = useState<IPCError | null>(null);
  const eventHandlerRef = useRef<((event: FileEvent) => void) | null>(null);
  const errorHandlerRef = useRef<((error: IPCError) => void) | null>(null);

  // Initialize watcher status on mount
  useEffect(() => {
    const initializeWatcherStatus = async () => {
      try {
        const status = await IPCService.getWatcherStatus();
        setIsWatching(status.watching);
        setWatchingPath(status.path || null);
      } catch (err) {
        // Silently fail on init - watcher may not be available yet
      }
    };

    initializeWatcherStatus();
  }, []);

  // Set up event listeners
  useEffect(() => {
    // Create event handler
    eventHandlerRef.current = (event: FileEvent) => {
      setEvents((prev) => [...prev, event]);
    };

    // Create error handler
    errorHandlerRef.current = (err: IPCError) => {
      setError(err);
    };

    // Subscribe to events
    IPCService.onFileEvent(eventHandlerRef.current);
    IPCService.onWatcherError(errorHandlerRef.current);

    // Cleanup on unmount
    return () => {
      IPCService.removeFileEventListener();
      IPCService.removeWatcherErrorListener();
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const startWatching = useCallback(async (path: string): Promise<boolean> => {
    try {
      clearError();
      const result = await IPCService.startWatching(path);
      setIsWatching(result.watching);
      setWatchingPath(result.path || null);
      setEvents([]); // Clear events when starting new watch
      return result.watching;
    } catch (err) {
      const ipcError = err instanceof Error
        ? { code: 'ERROR', message: err.message }
        : (err as IPCError);
      setError(ipcError);
      setIsWatching(false);
      setWatchingPath(null);
      return false;
    }
  }, [clearError]);

  const stopWatching = useCallback(async (): Promise<boolean> => {
    try {
      clearError();
      const result = await IPCService.stopWatching();
      setIsWatching(result.watching);
      setWatchingPath(result.path || null);
      return !result.watching; // Return true if successfully stopped (watching is now false)
    } catch (err) {
      const ipcError = err instanceof Error
        ? { code: 'ERROR', message: err.message }
        : (err as IPCError);
      setError(ipcError);
      return false;
    }
  }, [clearError]);

  return {
    watchingPath,
    isWatching,
    events,
    error,
    startWatching,
    stopWatching,
    clearEvents,
    clearError,
  };
};


