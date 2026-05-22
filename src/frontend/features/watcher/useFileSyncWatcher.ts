import { useState, useCallback, useEffect, useRef } from 'react';
import { FileEvent, IPCError } from '../../shared/utils/ipc';

export interface SyncState {
  syncStatus: 'idle' | 'synced' | 'conflict' | 'deleted' | 'error';
  showPrompt: boolean;
  externalContent: string | null;
  externalEvent: FileEvent | null;
  error: IPCError | null;
}

export interface UseFileSyncWatcherResult extends SyncState {
  handleKeepLocal: () => void;
  handleLoadExternal: () => void;
  closePrompt: () => void;
  clearError: () => void;
  reset: () => void;
}

interface UseFileSyncWatcherProps {
  filePath: string | null;
  isDirty: boolean;
  events: FileEvent[];
}

/**
 * Custom hook that manages file sync state and conflict resolution
 * Handles detecting when external files are changed and coordinating user interaction
 */
export const useFileSyncWatcher = ({
  filePath,
  isDirty,
  events,
}: UseFileSyncWatcherProps): UseFileSyncWatcherResult => {
  const [syncStatus, setSyncStatus] = useState<'idle' | 'synced' | 'conflict' | 'deleted' | 'error'>('idle');
  const [showPrompt, setShowPrompt] = useState(false);
  const [externalContent, setExternalContent] = useState<string | null>(null);
  const [externalEvent, setExternalEvent] = useState<FileEvent | null>(null);
  const [error, setError] = useState<IPCError | null>(null);
  const processedEventsRef = useRef<Set<number>>(new Set());
  const lastEventTimeRef = useRef<number>(0);

  // Debounce rapid events to prevent multiple prompts
  const DEBOUNCE_TIME = 300;

  useEffect(() => {
    if (!filePath || events.length === 0) return;

    const now = Date.now();
    
    // Find the first unprocessed event relevant to the current file
    for (const event of events) {
      const eventTimestamp = event.timestamp;
      
      // Skip if we've already processed this event
      if (processedEventsRef.current.has(eventTimestamp)) continue;

      // Check if event is for current file (handle different path formats)
      const eventPath = event.path.toLowerCase().replace(/\//g, '\\');
      const currentPath = filePath.toLowerCase().replace(/\//g, '\\');

      const isRelevantEvent = 
        eventPath === currentPath ||
        (event.old_path && event.old_path.toLowerCase().replace(/\//g, '\\') === currentPath);

      if (!isRelevantEvent) continue;

      // Mark event as processed
      processedEventsRef.current.add(eventTimestamp);
      lastEventTimeRef.current = now;

      // Debounce: ignore if we've processed an event very recently
      if (events.length > 1) {
        const otherRecentEvents = events.filter(
          e => 
            e.timestamp > eventTimestamp - DEBOUNCE_TIME &&
            !processedEventsRef.current.has(e.timestamp)
        );
        if (otherRecentEvents.length > 0) {
          continue; // Skip this one, let the next one through
        }
      }

      // Handle delete event
      if (event.type === 'deleted') {
        setSyncStatus('deleted');
        setExternalEvent(event);
        setShowPrompt(false);
        return;
      }

      // Handle rename event (update external event but don't trigger conflict for clean files)
      if (event.type === 'renamed' && event.new_path) {
        setExternalEvent(event);
        // Don't show prompt for rename, just track it
        return;
      }

      // Handle modify/create events
      if (event.type === 'modified' || event.type === 'created') {
        setExternalEvent(event);
        
        // If editor is dirty, show conflict prompt
        if (isDirty) {
          setSyncStatus('conflict');
          setShowPrompt(true);
        } else {
          // If clean, mark as synced (component will handle reload)
          setSyncStatus('synced');
          setShowPrompt(false);
        }
        return;
      }
    }
  }, [events, filePath, isDirty]);

  const handleKeepLocal = useCallback(() => {
    setShowPrompt(false);
    setSyncStatus('idle');
    setExternalContent(null);
    setExternalEvent(null);
  }, []);

  const handleLoadExternal = useCallback(() => {
    setShowPrompt(false);
    setSyncStatus('synced');
    setExternalContent(null);
    setExternalEvent(null);
  }, []);

  const closePrompt = useCallback(() => {
    setShowPrompt(false);
    setSyncStatus('idle');
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setSyncStatus('idle');
    setShowPrompt(false);
    setExternalContent(null);
    setExternalEvent(null);
    setError(null);
  }, []);

  return {
    syncStatus,
    showPrompt,
    externalContent,
    externalEvent,
    error,
    handleKeepLocal,
    handleLoadExternal,
    closePrompt,
    clearError,
    reset,
  };
};

