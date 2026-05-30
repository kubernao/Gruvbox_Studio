import { useCallback, useMemo, useState } from 'react';

export interface MiddleEditorDocument {
  path: string;
  language: string;
  fileType: 'text' | 'pdf';
  content: string;
  originalContent: string;
  isReadOnly: boolean;
  pinned: boolean;
}

export interface OpenMiddleDocumentInput {
  path: string;
  language: string;
  fileType?: 'text' | 'pdf';
  content: string;
  isReadOnly: boolean;
}

interface MiddleEditorState {
  openDocuments: string[];
  activePath: string | null;
  contentByPath: Record<string, string>;
  originalByPath: Record<string, string>;
  readonlyByPath: Record<string, boolean>;
  languageByPath: Record<string, string>;
  pinnedByPath: Record<string, boolean>;
}

function removeKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function useMiddleEditorState() {
  const [state, setState] = useState<MiddleEditorState>({
    openDocuments: [],
    activePath: null,
    contentByPath: {},
    originalByPath: {},
    readonlyByPath: {},
    languageByPath: {},
    pinnedByPath: {},
  });

  const openOrActivateDocument = useCallback((doc: OpenMiddleDocumentInput) => {
    setState((prev) => {
      const alreadyOpen = prev.openDocuments.includes(doc.path);
      return {
        ...prev,
        openDocuments: alreadyOpen ? prev.openDocuments : [...prev.openDocuments, doc.path],
        activePath: doc.path,
        contentByPath: { ...prev.contentByPath, [doc.path]: doc.content },
        originalByPath: { ...prev.originalByPath, [doc.path]: doc.content },
        readonlyByPath: { ...prev.readonlyByPath, [doc.path]: doc.isReadOnly },
        languageByPath: {
          ...prev.languageByPath,
          [doc.path]: doc.fileType === 'pdf' ? 'pdf' : doc.language,
        },
        pinnedByPath: {
          ...prev.pinnedByPath,
          [doc.path]: prev.pinnedByPath[doc.path] ?? false,
        },
      };
    });
  }, []);

  const selectDocument = useCallback((path: string) => {
    setState((prev) => {
      if (!prev.openDocuments.includes(path)) {
        return prev;
      }
      return { ...prev, activePath: path };
    });
  }, []);

  const closeDocument = useCallback((path: string) => {
    setState((prev) => {
      if (!prev.openDocuments.includes(path)) {
        return prev;
      }

      const remaining = prev.openDocuments.filter((candidate) => candidate !== path);
      let nextActive = prev.activePath;
      if (prev.activePath === path) {
        nextActive = remaining.length > 0 ? remaining[Math.max(remaining.length - 1, 0)] : null;
      }

      return {
        openDocuments: remaining,
        activePath: nextActive,
        contentByPath: removeKey(prev.contentByPath, path),
        originalByPath: removeKey(prev.originalByPath, path),
        readonlyByPath: removeKey(prev.readonlyByPath, path),
        languageByPath: removeKey(prev.languageByPath, path),
        pinnedByPath: removeKey(prev.pinnedByPath, path),
      };
    });
  }, []);

  const reorderDocuments = useCallback((orderedPaths: string[]) => {
    setState((prev) => {
      const known = new Set(prev.openDocuments);
      const sanitized = orderedPaths.filter((path) => known.has(path));
      const missing = prev.openDocuments.filter((path) => !sanitized.includes(path));
      return { ...prev, openDocuments: [...sanitized, ...missing] };
    });
  }, []);

  const setPinned = useCallback((path: string, pinned: boolean) => {
    setState((prev) => {
      if (!prev.openDocuments.includes(path)) {
        return prev;
      }
      return {
        ...prev,
        pinnedByPath: { ...prev.pinnedByPath, [path]: pinned },
      };
    });
  }, []);

  const updateContent = useCallback((path: string, content: string) => {
    setState((prev) => {
      if (!prev.openDocuments.includes(path)) {
        return prev;
      }
      return {
        ...prev,
        contentByPath: { ...prev.contentByPath, [path]: content },
      };
    });
  }, []);

  const replaceDocumentContent = useCallback(
    (path: string, content: string, options?: { markClean?: boolean }) => {
      setState((prev) => {
        if (!prev.openDocuments.includes(path)) {
          return prev;
        }
        return {
          ...prev,
          contentByPath: { ...prev.contentByPath, [path]: content },
          originalByPath:
            options?.markClean === true
              ? { ...prev.originalByPath, [path]: content }
              : prev.originalByPath,
        };
      });
    },
    []
  );

  const markSaved = useCallback((path: string, savedContent: string) => {
    setState((prev) => {
      if (!prev.openDocuments.includes(path)) {
        return prev;
      }
      return {
        ...prev,
        originalByPath: { ...prev.originalByPath, [path]: savedContent },
      };
    });
  }, []);

  /** Sets `originalContent` only (e.g. on-disk baseline) without changing the buffer. */
  const setBaselineOriginal = useCallback((path: string, baseline: string) => {
    setState((prev) => {
      if (!prev.openDocuments.includes(path)) {
        return prev;
      }
      return {
        ...prev,
        originalByPath: { ...prev.originalByPath, [path]: baseline },
      };
    });
  }, []);

  const clearAll = useCallback(() => {
    setState({
      openDocuments: [],
      activePath: null,
      contentByPath: {},
      originalByPath: {},
      readonlyByPath: {},
      languageByPath: {},
      pinnedByPath: {},
    });
  }, []);

  /**
   * Moves an open document buffer from one absolute path to another without
   * reloading from disk. Used by Save As and explorer rename/move so tab keys
   * stay aligned with on-disk locations.
   */
  const repointDocument = useCallback((fromPath: string, toPath: string) => {
    if (fromPath === toPath) {
      return;
    }
    setState((prev) => {
      if (!prev.openDocuments.includes(fromPath)) {
        return prev;
      }
      if (prev.openDocuments.includes(toPath)) {
        return prev;
      }
      const moveRecord = <T,>(record: Record<string, T>): Record<string, T> => {
        if (!(fromPath in record)) {
          return record;
        }
        const next = { ...record, [toPath]: record[fromPath] };
        delete next[fromPath];
        return next;
      };
      return {
        openDocuments: prev.openDocuments.map((path) => (path === fromPath ? toPath : path)),
        activePath: prev.activePath === fromPath ? toPath : prev.activePath,
        contentByPath: moveRecord(prev.contentByPath),
        originalByPath: moveRecord(prev.originalByPath),
        readonlyByPath: moveRecord(prev.readonlyByPath),
        languageByPath: moveRecord(prev.languageByPath),
        pinnedByPath: moveRecord(prev.pinnedByPath),
      };
    });
  }, []);

  const activeDocument = useMemo<MiddleEditorDocument | null>(() => {
    if (state.activePath === null) {
      return null;
    }

    const path = state.activePath;
    if (!state.openDocuments.includes(path)) {
      return null;
    }

    return {
      path,
      language: state.languageByPath[path] ?? 'plaintext',
      fileType: state.languageByPath[path] === 'pdf' ? 'pdf' : 'text',
      content: state.contentByPath[path] ?? '',
      originalContent: state.originalByPath[path] ?? '',
      isReadOnly: state.readonlyByPath[path] ?? false,
      pinned: state.pinnedByPath[path] ?? false,
    };
  }, [state]);

  const documents = useMemo<MiddleEditorDocument[]>(
    () =>
      state.openDocuments.map((path) => ({
        path,
        language: state.languageByPath[path] ?? 'plaintext',
        fileType: state.languageByPath[path] === 'pdf' ? 'pdf' : 'text',
        content: state.contentByPath[path] ?? '',
        originalContent: state.originalByPath[path] ?? '',
        isReadOnly: state.readonlyByPath[path] ?? false,
        pinned: state.pinnedByPath[path] ?? false,
      })),
    [state]
  );

  const isDirty = useCallback(
    (path: string) => (state.contentByPath[path] ?? '') !== (state.originalByPath[path] ?? ''),
    [state.contentByPath, state.originalByPath]
  );

  return {
    openDocuments: state.openDocuments,
    activePath: state.activePath,
    documents,
    activeDocument,
    openOrActivateDocument,
    selectDocument,
    closeDocument,
    reorderDocuments,
    setPinned,
    updateContent,
    replaceDocumentContent,
    markSaved,
    setBaselineOriginal,
    clearAll,
    repointDocument,
    isDirty,
  };
}
