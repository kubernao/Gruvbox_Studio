import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Check, Loader } from 'lucide-react';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { useFileExplorer } from '../explorer/useFileExplorer';
import { useToast } from '../../shared/hooks/useToast';
import { useFileWatcher } from '../watcher/useFileWatcher';
import { useFileSyncWatcher } from '../watcher/useFileSyncWatcher';
import { IPCService } from '../../shared/utils/ipc';
import { dispatchWorkspaceFileSaved } from '../../shared/utils/workspaceFileSavedEvents';
import { getFriendlyErrorMessage } from '../../shared/utils/errorMessages';
import { getLanguageFromPath } from './editorConfig';
import SyncPrompt from '../watcher/SyncPrompt';
import { performSelectedFileLoad } from './loadSelectedFile';
import { useMiddleEditorState } from './useMiddleEditorState';
import DocumentTabsReact, { DocumentTabItem } from './DocumentTabsReact';
import MiddleContentHost from './MiddleContentHost';
import {
  PALETTE_ACTION_EVENT,
  type PaletteActionEventDetail,
} from '../palette/paletteActionEvents';
import { setPalettePrereqs } from '../palette/palettePrereqStore';
import {
  AI_INLINE_REVIEW_CLEARED_EVENT,
  useAiInlineReview,
} from '../../shared/contexts/AiInlineReviewContext';
import type { AiChangedSection } from '../../shared/ai/extractAiChangedLinesFromUnifiedDiff';
import type { HistoryPreviewSession } from '../../shared/contexts/DiffViewerContext';
import './EditorPane.css';
import { parentDirectoryFromFilePath } from '../../shared/utils/pathParts';
import { StudioWelcomeHero } from './StudioWelcomeHero';
import AudiobookGenerationModal from '../listen/AudiobookGenerationModal';
import AudiobookPlaylistDock from '../listen/AudiobookPlaylistDock';
import DocumentListenSetupModal from '../listen/DocumentListenSetupModal';
import DocumentSpeechPlaybackModal from '../listen/DocumentSpeechPlaybackModal';
import { useDocumentSpeech } from '../listen/useDocumentSpeech';
import { readDocEditorFlags } from './docEditorFlags';
import {
  createCommentFromSelection,
  reopenActiveComment,
  resolveActiveComment,
} from './commentsExtension';
import {
  acceptActiveSuggestion,
  rejectActiveSuggestion,
  toggleSuggestMode,
} from './suggestChangesExtension';
import { tryStripMarkdownDecoratorPair } from './markdownDecoratorAtomics';
import { buildPrintableDocumentHtml, printHtmlDocument } from './printDocument';
import {
  runGrammarCheck,
  runReadabilityCheck,
  runSpellCheck,
} from './languageReviewService';

// Grace period to ignore file-watcher events caused by our own save (ms).
// The watcher debounces at 100 ms; 2 s is comfortably above that.
const SAVE_GRACE_MS = 2000;
const DOC_ZOOM_MIN = 0.7;
const DOC_ZOOM_MAX = 2;
const DOC_ZOOM_STEP = 0.1;
const docEditorFlags = readDocEditorFlags();
const EXPORT_CSS = `
body {
  font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
  line-height: 1.6;
  margin: 24px;
  color: #1f1f1f;
}
img {
  max-width: 100%;
  height: auto;
}
pre, code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th, td {
  border: 1px solid #d9d9d9;
  padding: 0.5rem;
}
/* Prevent Mermaid graphs from clipping in exported HTML/PDF/DOCX */
svg[id^="gruvbox-docs-mermaid-"],
svg[aria-roledescription*="flowchart"],
svg[aria-roledescription*="sequence"],
svg[aria-roledescription*="classDiagram"],
svg[aria-roledescription*="stateDiagram"] {
  display: block;
  max-width: 100%;
  width: 100%;
  height: auto;
  overflow: visible;
}
`;

type EditorHostElement = HTMLElement & { gruvboxEditorView?: EditorView };

function normalizeLinesForJoin(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text === '') {
    return { lines: [], trailingNewline: false };
  }
  const trailingNewline = text.endsWith('\n');
  const core = trailingNewline ? text.slice(0, -1) : text;
  return { lines: core.split('\n'), trailingNewline };
}

function joinNormalizedLines(lines: readonly string[], trailingNewline: boolean): string {
  if (lines.length === 0) {
    return '';
  }
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
}

function buildLinesFromSections(sections: readonly AiChangedSection[]): number[] {
  const lineSet = new Set<number>();
  for (const section of sections) {
    for (let line = section.currentStartLine; line <= section.currentEndLine; line += 1) {
      lineSet.add(line);
    }
  }
  return [...lineSet].sort((a, b) => a - b);
}

interface EditorPaneProps {
  historyPreview?: HistoryPreviewSession | null;
  onCloseHistoryPreview?: () => void;
}

function buildChildPath(parentPath: string, childName: string): string {
  const separator = parentPath.includes('\\') ? '\\' : '/';
  return `${parentPath.replace(/[\\/]$/, '')}${separator}${childName}`;
}

function isPdfPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.pdf');
}

function getActiveEditorView(): EditorView | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const focusedHost = document.querySelector(
    '.middle-content-host .editor-container .cm-editor.cm-focused'
  )?.closest('.editor-container') as EditorHostElement | null;
  if (focusedHost?.gruvboxEditorView) {
    return focusedHost.gruvboxEditorView;
  }
  const host = document.querySelector('.middle-content-host .editor-container') as EditorHostElement | null;
  return host?.gruvboxEditorView ?? null;
}

function replaceMainSelection(
  view: EditorView,
  replacer: (selectedText: string) => { text: string; cursorOffset?: number }
): void {
  const main = view.state.selection.main;
  const selectedText = view.state.sliceDoc(main.from, main.to);
  const result = replacer(selectedText);
  const nextCursor = main.from + (result.cursorOffset ?? result.text.length);
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: result.text },
    selection: EditorSelection.cursor(nextCursor),
    scrollIntoView: true,
  });
  view.focus();
}

function prefixCurrentLine(view: EditorView, prefix: string): void {
  const main = view.state.selection.main;
  const line = view.state.doc.lineAt(main.from);
  const lineText = view.state.sliceDoc(line.from, line.to);
  const sanitized = lineText.replace(/^\s{0,3}#{1,6}\s+/, '');
  const hasSelection = !main.empty;
  const selected = hasSelection ? view.state.sliceDoc(main.from, main.to) : '';
  const insertLineText = `${prefix}${hasSelection ? selected : sanitized || 'Heading'}`;
  const anchorOffset = hasSelection ? main.from - line.from : insertLineText.length;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: insertLineText },
    selection: EditorSelection.cursor(line.from + anchorOffset),
    scrollIntoView: true,
  });
  view.focus();
}

const EditorPane: React.FC<EditorPaneProps> = ({ historyPreview = null, onCloseHistoryPreview }) => {
  const { rootPath, selectedFile, selectedFileVersion, selectFile, refreshFileTree } = useFileExplorer();
  const { showError, showSuccess, showWarning, showInfo } = useToast();
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isRunningLanguageCheck, setIsRunningLanguageCheck] = useState(false);
  const [documentZoom, setDocumentZoom] = useState(1);
  const [audiobookModalOpen, setAudiobookModalOpen] = useState(false);
  const [lastAudiobookManifestPath, setLastAudiobookManifestPath] = useState<string | null>(null);
  const [listenSetupOpen, setListenSetupOpen] = useState(false);
  const [listenSetupMode, setListenSetupMode] = useState<'document' | 'selection'>('document');
  const handleDocumentZoomIn = useCallback(() => {
    setDocumentZoom((prev) => Math.min(DOC_ZOOM_MAX, Number((prev + DOC_ZOOM_STEP).toFixed(2))));
  }, []);

  const handleDocumentZoomOut = useCallback(() => {
    setDocumentZoom((prev) => Math.max(DOC_ZOOM_MIN, Number((prev - DOC_ZOOM_STEP).toFixed(2))));
  }, []);

  const lastSavedAtRef = useRef<number>(0);
  const [fileAccessError, setFileAccessError] = useState<string | null>(null);
  /** Latest explorer selection — stale async loads must not apply setFile or clear the overlay incorrectly. */
  const selectedFileRef = useRef<string | null>(null);
  selectedFileRef.current = selectedFile;
  /** After AI inline bootstrap, skip one disk read so the selected-file effect does not clobber the AI buffer. */
  const skipNextDiskLoadForInlineAiRef = useRef(false);
  /** While opening a history preview, ignore one matching disk-load pass to keep snapshot content. */
  const skipNextDiskLoadForHistoryPreviewRef = useRef(false);
  const lastAppliedHistoryPreviewKeyRef = useRef('');
  const middleEditor = useMiddleEditorState();
  const {
    documents,
    activeDocument,
    activePath,
    openOrActivateDocument,
    clearAll,
    replaceDocumentContent,
    closeDocument,
    selectDocument,
    reorderDocuments,
    setPinned,
    updateContent,
    markSaved,
    setBaselineOriginal,
    isDirty,
  } = middleEditor;
  const { session: inlineReviewSession, markApplied, updateSession, clearSession } = useAiInlineReview();
  const activeIsDirty =
    activePath !== null && activeDocument?.fileType !== 'pdf' ? isDirty(activePath) : false;

  const aiHighlightSections = useMemo((): readonly AiChangedSection[] => {
    if (!inlineReviewSession || inlineReviewSession.pendingApply) {
      return [];
    }
    if (activePath !== inlineReviewSession.absolutePath) {
      return [];
    }
    return inlineReviewSession.highlightedSections;
  }, [inlineReviewSession, activePath]);

  const showAiInlineUndoBar =
    inlineReviewSession != null &&
    !inlineReviewSession.pendingApply &&
    activePath === inlineReviewSession.absolutePath;
  const tabs = useMemo<DocumentTabItem[]>(
    () =>
      documents.map((doc) => ({
        path: doc.path,
        pinned: doc.pinned,
        dirty: isDirty(doc.path),
      })),
    [documents, isDirty]
  );

  const readSelectedEditorText = useCallback((): string | null => {
    const view = getActiveEditorView();
    if (!view) {
      return null;
    }
    const { main } = view.state.selection;
    if (main.empty) {
      return null;
    }
    return view.state.sliceDoc(main.from, main.to);
  }, []);

  const speech = useDocumentSpeech({
    activeDocumentPath: activePath,
    language: activeDocument?.language ?? 'plaintext',
    fileType: activeDocument?.fileType ?? 'text',
    textContent: activeDocument?.content ?? '',
    readSelectedEditorText,
  });

  useEffect(() => {
    setListenSetupOpen(false);
  }, [activePath]);

  // File watcher hooks
  const { watchingPath, startWatching, stopWatching, events, clearEvents } =
    useFileWatcher();

  // Exclude events produced by our own save so the sync watcher does not
  // mistake them for external modifications.
  const filteredEvents = useMemo(
    () => events.filter((e) => e.timestamp > lastSavedAtRef.current + SAVE_GRACE_MS),
    [events]
  );

  const fileSyncWatcher = useFileSyncWatcher({
    filePath: activePath,
    isDirty: activeIsDirty,
    events: filteredEvents,
  });

  const applyPendingInlineAiBootstrap = useCallback(
    async (pathForThisLoad: string): Promise<boolean> => {
      const pending = inlineReviewSession;
      if (!pending?.pendingApply || pathForThisLoad !== pending.absolutePath) {
        return false;
      }
      let diskText = '';
      try {
        diskText = await IPCService.readFile(pathForThisLoad);
      } catch {
        diskText = '';
      }
      openOrActivateDocument({
        path: pathForThisLoad,
        content: pending.aiText,
        language: getLanguageFromPath(pathForThisLoad),
        fileType: 'text',
        isReadOnly: false,
      });
      setBaselineOriginal(pathForThisLoad, diskText);
      skipNextDiskLoadForInlineAiRef.current = true;
      markApplied();
      return true;
    },
    [inlineReviewSession, openOrActivateDocument, setBaselineOriginal, markApplied],
  );

  useEffect(() => {
    if (!historyPreview) {
      return;
    }
    const previewKey = `${historyPreview.absolutePath}::${historyPreview.hash}`;
    if (lastAppliedHistoryPreviewKeyRef.current === previewKey) {
      return;
    }
    lastAppliedHistoryPreviewKeyRef.current = previewKey;
    openOrActivateDocument({
      path: historyPreview.absolutePath,
      content: historyPreview.content,
      language: getLanguageFromPath(historyPreview.absolutePath),
      fileType: 'text',
      isReadOnly: true,
    });
    setBaselineOriginal(historyPreview.absolutePath, historyPreview.content);
    skipNextDiskLoadForHistoryPreviewRef.current = true;
    setFileAccessError(null);
  }, [historyPreview, openOrActivateDocument, setBaselineOriginal]);

  // Handle file selection from file explorer
  useEffect(() => {
    if (!selectedFile) {
      skipNextDiskLoadForInlineAiRef.current = false;
      skipNextDiskLoadForHistoryPreviewRef.current = false;
      setFileAccessError(null);
      setIsReadingFile(false);
      clearAll();
      return;
    }

    if (inlineReviewSession && selectedFile !== inlineReviewSession.absolutePath) {
      skipNextDiskLoadForInlineAiRef.current = false;
    }

    const pathForThisLoad = selectedFile;

    const loadFile = async () => {
      setIsReadingFile(true);
      setFileAccessError(null);

      if (historyPreview && pathForThisLoad === historyPreview.absolutePath) {
        // In history preview mode, keep the injected revision snapshot and do not
        // reload this path from disk (which would show current HEAD content).
        setIsReadingFile(false);
        return;
      }

      if (
        skipNextDiskLoadForInlineAiRef.current &&
        inlineReviewSession &&
        pathForThisLoad === inlineReviewSession.absolutePath &&
        !inlineReviewSession.pendingApply
      ) {
        skipNextDiskLoadForInlineAiRef.current = false;
        setIsReadingFile(false);
        return;
      }

      if (
        skipNextDiskLoadForHistoryPreviewRef.current &&
        historyPreview &&
        pathForThisLoad === historyPreview.absolutePath
      ) {
        skipNextDiskLoadForHistoryPreviewRef.current = false;
        setIsReadingFile(false);
        return;
      }

      if (await applyPendingInlineAiBootstrap(pathForThisLoad)) {
        setIsReadingFile(false);
        return;
      }

      if (isPdfPath(pathForThisLoad)) {
        openOrActivateDocument({
          path: pathForThisLoad,
          content: '',
          language: 'pdf',
          fileType: 'pdf',
          isReadOnly: true,
        });
        setIsReadingFile(false);
        return;
      }

      await performSelectedFileLoad(
        pathForThisLoad,
        {
          readFile: (p) => IPCService.readFile(p),
          getMetadata: (p) => IPCService.getMetadata(p),
        },
        () => selectedFileRef.current,
        getLanguageFromPath,
        ({ path, content, metadata, language }) => {
          if (historyPreview && path === historyPreview.absolutePath) {
            return;
          }
          openOrActivateDocument({
            path,
            content,
            language,
            fileType: 'text',
            isReadOnly: metadata.permissions_readonly,
          });
        },
        (error) => {
          const friendlyMessage = getFriendlyErrorMessage(error, 'read');
          showError(friendlyMessage);
          setFileAccessError(friendlyMessage);
          console.error('Failed to read file:', error);
        },
        () => setIsReadingFile(false)
      );
    };

    void loadFile();
  }, [
    selectedFile,
    selectedFileVersion,
    clearAll,
    openOrActivateDocument,
    showError,
    inlineReviewSession,
    applyPendingInlineAiBootstrap,
    historyPreview,
  ]);

  // Watch the directory containing the current file
  useEffect(() => {
    if (!activePath) {
      // Stop watching if no file is open
      if (watchingPath) {
        stopWatching();
      }
      return;
    }

    const directory = parentDirectoryFromFilePath(activePath);
    if (!directory) {
      if (watchingPath) {
        stopWatching();
      }
      return;
    }

    const setupWatcher = async () => {
      try {
        // Only start watching if not already watching this directory
        if (watchingPath !== directory) {
          await startWatching(directory);
          clearEvents();
        }
      } catch (error) {
        console.error('Failed to start watching:', error);
        showWarning('Could not watch folder for changes');
      }
    };

    setupWatcher();
  }, [activePath, watchingPath, startWatching, stopWatching, clearEvents, showWarning]);

  // Handle external file changes
  useEffect(() => {
    if (fileSyncWatcher.syncStatus === 'synced' && !activeIsDirty) {
      // File was modified externally and editor is clean - reload content
      const reloadFile = async () => {
        if (!activePath) return;
        try {
          const reloadedContent = await IPCService.readFile(activePath);
          replaceDocumentContent(activePath, reloadedContent, { markClean: true });
          fileSyncWatcher.reset();
          showInfo('File updated externally (reloaded)');
          clearEvents();
          // Refresh file tree to show latest state
          refreshFileTree();
        } catch (error) {
          const friendlyMessage = getFriendlyErrorMessage(error, 'read');
          showError(`Failed to reload file: ${friendlyMessage}`);
          setFileAccessError('File is no longer accessible');
        }
      };

      reloadFile();
    } else if (fileSyncWatcher.syncStatus === 'deleted') {
      // File was deleted externally
      clearEvents();
      setFileAccessError('File was deleted externally');
      showWarning('File was deleted externally', 5000);
      if (activePath) {
        closeDocument(activePath);
      }
      // Refresh file tree to reflect deletion
      refreshFileTree();
    }
  }, [
    fileSyncWatcher.syncStatus,
    fileSyncWatcher.reset,
    activeIsDirty,
    activePath,
    replaceDocumentContent,
    closeDocument,
    showInfo,
    showError,
    showWarning,
    clearEvents,
    refreshFileTree,
  ]);

  // Handle sync conflict resolution
  useEffect(() => {
    if (
      fileSyncWatcher.syncStatus === 'synced' &&
      activeIsDirty &&
      fileSyncWatcher.externalEvent?.type === 'modified'
    ) {
      // User chose to load external version
      const loadExternalVersion = async () => {
        if (!activePath || !activeDocument) return;
        try {
          const reloadedContent = await IPCService.readFile(activePath);
          replaceDocumentContent(activePath, reloadedContent, { markClean: true });
          showSuccess('Loaded external file version');
          clearEvents();
        } catch (error) {
          const friendlyMessage = getFriendlyErrorMessage(error, 'read');
          showError(`Failed to load external version: ${friendlyMessage}`);
        }
      };

      if (fileSyncWatcher.externalEvent?.type === 'modified') {
        loadExternalVersion();
      }
    }
  }, [
    fileSyncWatcher.syncStatus,
    fileSyncWatcher.externalEvent,
    activeIsDirty,
    activePath,
    activeDocument,
    replaceDocumentContent,
    showSuccess,
    showError,
    clearEvents,
  ]);

  // Wire up save function to use IPC
  const handleSave = useCallback(async () => {
    if (!activeDocument) return;
    if (activeDocument.fileType === 'pdf') {
      showWarning('PDF documents are read-only in the editor.');
      return;
    }
    if (activeDocument.isReadOnly) {
      showWarning('This document is read-only and cannot be saved.');
      return;
    }

    setIsSavingFile(true);
    const hangTimer = window.setTimeout(() => {
      setIsSavingFile(false);
      console.warn(
        '[EditorPane] Saving overlay cleared after long wait; IPC write may still be pending.'
      );
    }, 90_000);
    try {
      const contentToSave = activeDocument.content;
      lastSavedAtRef.current = Date.now();
      await IPCService.writeFile(activeDocument.path, contentToSave);
      markSaved(activeDocument.path, contentToSave);
      dispatchWorkspaceFileSaved(activeDocument.path);
      setFileAccessError(null);
      showSuccess('File saved successfully');
      // Clear any pending sync events since we just saved
      clearEvents();
    } catch (error) {
      const friendlyMessage = getFriendlyErrorMessage(error, 'write');
      showError(friendlyMessage);
      console.error('Failed to save file:', error);
    } finally {
      window.clearTimeout(hangTimer);
      setIsSavingFile(false);
    }
  }, [activeDocument, markSaved, clearEvents, showError, showSuccess, showWarning]);

  const handleOpenActivePdfExternally = useCallback(async () => {
    if (!activeDocument || activeDocument.fileType !== 'pdf') {
      showWarning('Open a PDF tab to use this action.');
      return;
    }
    try {
      const result = await IPCService.openExternal(activeDocument.path);
      if (!result.ok) {
        showError(result.error || 'Could not open PDF externally.');
        return;
      }
      showSuccess('Opened PDF in your default viewer');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showError(`Failed to open PDF externally: ${message}`);
    }
  }, [activeDocument, showError, showSuccess, showWarning]);

  const handleUndoAiSection = useCallback(
    (sectionId: string) => {
      const s = inlineReviewSession;
      const path = activePath;
      if (!s || !activeDocument || path !== s.absolutePath || activeDocument.path !== path) {
        return;
      }
      const targetSection = s.highlightedSections.find((section) => section.id === sectionId);
      if (!targetSection) {
        return;
      }

      const baseline = normalizeLinesForJoin(s.baselineText);
      const current = normalizeLinesForJoin(activeDocument.content);
      const currentStart = Math.max(0, targetSection.currentStartLine - 1);
      const currentEndExclusive = Math.max(currentStart, targetSection.currentEndLine);
      const baselineStart = Math.max(0, targetSection.baselineStartLine - 1);
      const baselineEndExclusive = Math.max(baselineStart, targetSection.baselineEndLine);
      const replacement = baseline.lines.slice(baselineStart, baselineEndExclusive);
      const nextLines = [
        ...current.lines.slice(0, currentStart),
        ...replacement,
        ...current.lines.slice(currentEndExclusive),
      ];
      const nextContent = joinNormalizedLines(nextLines, current.trailingNewline);
      updateContent(path, nextContent);

      const lineDelta = replacement.length - (currentEndExclusive - currentStart);
      const nextSections: AiChangedSection[] = [];
      for (const section of s.highlightedSections) {
        if (section.id === targetSection.id) {
          continue;
        }
        if (section.currentStartLine > targetSection.currentEndLine) {
          nextSections.push({
            ...section,
            currentStartLine: section.currentStartLine + lineDelta,
            currentEndLine: section.currentEndLine + lineDelta,
          });
          continue;
        }
        nextSections.push(section);
      }
      if (nextSections.length === 0) {
        clearSession();
        void window.electronAPI?.invoke?.('pi-gui', { command: 'ai-worktree-abandon-next', payload: {} });
        window.dispatchEvent(new Event(AI_INLINE_REVIEW_CLEARED_EVENT));
        return;
      }
      updateSession((prev) => {
        return {
          ...prev,
          aiText: nextContent,
          highlightedSections: nextSections,
          highlightedLines: buildLinesFromSections(nextSections),
        };
      });
    },
    [inlineReviewSession, activePath, activeDocument, updateContent, updateSession, clearSession],
  );

  const handleCommitAiInline = useCallback(() => {
    const s = inlineReviewSession;
    const path = activePath;
    if (!s || !activeDocument || path !== s.absolutePath || activeDocument.path !== path) {
      return;
    }
    skipNextDiskLoadForInlineAiRef.current = false;
    setBaselineOriginal(path, activeDocument.content);
    clearSession();
    void window.electronAPI?.invoke?.('pi-gui', { command: 'ai-worktree-keep', payload: {} });
    window.dispatchEvent(new Event(AI_INLINE_REVIEW_CLEARED_EVENT));
  }, [inlineReviewSession, activePath, activeDocument, setBaselineOriginal, clearSession]);

  const handleNewMarkdownFile = useCallback(async () => {
    if (rootPath == null || rootPath.trim() === '') {
      showWarning('Open a folder before creating a Markdown file');
      return;
    }

    try {
      const siblings = await IPCService.listDirectory(rootPath);
      const existingNames = new Set(siblings.map((entry) => entry.name.toLowerCase()));
      let candidateName = 'untitled.md';
      let index = 1;
      while (existingNames.has(candidateName.toLowerCase())) {
        candidateName = `untitled-${index}.md`;
        index += 1;
      }
      const targetPath = buildChildPath(rootPath, candidateName);
      await IPCService.writeFile(targetPath, '');
      await refreshFileTree();
      selectFile(targetPath);
      showSuccess(`Created ${candidateName}`);
    } catch (error) {
      const friendlyMessage = getFriendlyErrorMessage(error, 'write');
      showError(`Failed to create Markdown file: ${friendlyMessage}`);
      console.error('Failed to create Markdown file:', error);
    }
  }, [refreshFileTree, rootPath, selectFile, showError, showSuccess, showWarning]);

  const handleExport = useCallback(
    async (format: 'html' | 'pdf' | 'docx') => {
      if (!activeDocument) {
        showWarning('No active document to export');
        return;
      }
      try {
        const { markdownToSafeHtml } = await import('./markdownPreviewHtml');
        const renderedHtml = await markdownToSafeHtml(activeDocument.content);
        const result = (await IPCService.editorExport({
          format,
          sourcePath: activeDocument.path,
          markdown: activeDocument.content,
          renderedHtml,
          css: EXPORT_CSS,
        })) as { canceled?: boolean; outputPath?: string; warnings?: string[] };
        if (result?.canceled) {
          return;
        }
        if (!result?.outputPath) {
          showWarning('Export did not produce an output file');
          return;
        }
        if (Array.isArray(result.warnings) && result.warnings.length > 0) {
          showWarning(`Export completed with ${result.warnings.length} diagram warning(s)`);
        }
        showSuccess(`Exported ${format.toUpperCase()} to ${result.outputPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showError(`Failed to export ${format.toUpperCase()}: ${message}`);
      }
    },
    [activeDocument, showError, showSuccess, showWarning]
  );

  /**
   * Writes the active tab’s contents to a path chosen in a save dialog: text uses
   * the in-memory buffer (including unsaved edits); PDFs copy bytes from disk.
   */
  const handleExportFileCopy = useCallback(async () => {
    if (!activeDocument) {
      showWarning('No active document to export');
      return;
    }
    try {
      const result =
        activeDocument.fileType === 'pdf'
          ? await IPCService.editorExportFileCopy({
              sourcePath: activeDocument.path,
              contentBase64: await IPCService.readFileBase64(activeDocument.path),
            })
          : await IPCService.editorExportFileCopy({
              sourcePath: activeDocument.path,
              contentUtf8: activeDocument.content,
            });
      if (result.canceled) {
        return;
      }
      if (!result.outputPath) {
        showWarning('Export did not produce an output file');
        return;
      }
      showSuccess(`Exported copy to ${result.outputPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showError(`Failed to export file copy: ${message}`);
    }
  }, [activeDocument, showError, showSuccess, showWarning]);

  const handlePrintActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      showWarning('No active document to print');
      return;
    }
    if (activeDocument.fileType === 'pdf') {
      showInfo('Use "Open PDF externally" for PDF print workflows');
      return;
    }
    try {
      const printableHtml = await buildPrintableDocumentHtml(activeDocument.content, activeDocument.language);
      printHtmlDocument(printableHtml, {
        title: activeDocument.path.split(/[\\/]/).pop() ?? 'Document',
      });
      showSuccess('Opened print preview for the active document');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showError(`Could not open print preview: ${message}`);
    }
  }, [activeDocument, showError, showInfo, showSuccess, showWarning]);

  const handleLanguageReviewAction = useCallback(
    async (actionKind: 'editor.spellCheck' | 'editor.grammarCheck' | 'editor.readabilityCheck') => {
      const view = getActiveEditorView();
      if (!view) {
        showWarning('No active editor is focused');
        return;
      }
      if (isRunningLanguageCheck) {
        showInfo('A language check is already running');
        return;
      }
      const text = view.state.doc.toString();
      if (!text.trim()) {
        showInfo('Language check skipped: document is empty');
        view.focus();
        return;
      }
      setIsRunningLanguageCheck(true);
      try {
        if (actionKind === 'editor.spellCheck') {
          const result = await runSpellCheck(text);
          if (result.misspellings.length === 0) {
            showSuccess('Spell check passed: no misspellings found');
          } else {
            const first = result.misspellings[0];
            showWarning(
              `Spell check found ${result.misspellings.length} issue(s); first: "${first.term}"` +
                (first.suggestions?.length ? ` -> ${first.suggestions.join(', ')}` : ''),
            );
          }
        } else if (actionKind === 'editor.grammarCheck') {
          const result = await runGrammarCheck(text);
          if (result.issues.length === 0) {
            showSuccess('Grammar check passed: no major issues found');
          } else {
            showWarning(`Grammar check found ${result.issues.length} potential issue(s)`);
          }
        } else {
          const result = await runReadabilityCheck(text);
          showInfo(
            `Readability score ${result.score.toFixed(1)} | grade ${result.grade.toFixed(1)} | words ${result.words}`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showError(`Language check failed: ${message}`);
      } finally {
        setIsRunningLanguageCheck(false);
        view.focus();
      }
    },
    [isRunningLanguageCheck, showError, showInfo, showSuccess, showWarning]
  );

  const applyEditorFormatAction = useCallback(
    (action:
      | { kind: 'editor.insertHeader'; level: 1 | 2 | 3 | 4 | 5 | 6 }
      | { kind: 'editor.insertFontFamily' }
      | { kind: 'editor.insertTextSize' }
      | { kind: 'editor.toggleBold' }
      | { kind: 'editor.toggleItalic' }
      | { kind: 'editor.toggleUnderline' }
      | { kind: 'editor.toggleStrikethrough' }
      | { kind: 'editor.toggleHighlight' }
      | { kind: 'editor.insertFontColor' }
      | { kind: 'editor.insertLink' }
      | { kind: 'editor.insertInlineComment' }
      | { kind: 'editor.insertImage' }
      | { kind: 'editor.insertTextAlign' }
      | { kind: 'editor.insertBulletList' }
      | { kind: 'editor.insertChecklist' }
      | { kind: 'editor.insertNumberedList' }
      | { kind: 'editor.insertMath' }
      | { kind: 'editor.insertTable' }
      | { kind: 'editor.insertMermaid' }
    ): void => {
      const view = getActiveEditorView();
      if (!view) {
        showWarning('No active editor is focused');
        return;
      }
      switch (action.kind) {
        case 'editor.insertHeader':
          prefixCurrentLine(view, `${'#'.repeat(action.level)} `);
          break;
        case 'editor.insertFontFamily':
          replaceMainSelection(view, (selected) => ({
            text: `<span style="font-family: 'Inter', sans-serif;">${selected || 'text'}</span>`,
            cursorOffset: selected ? undefined : '<span style="font-family: \'Inter\', sans-serif;">'.length,
          }));
          break;
        case 'editor.insertTextSize':
          replaceMainSelection(view, (selected) => ({
            text: `<span style="font-size: 18px;">${selected || 'text'}</span>`,
            cursorOffset: selected ? undefined : '<span style="font-size: 18px;">'.length,
          }));
          break;
        case 'editor.toggleBold':
          if (!tryStripMarkdownDecoratorPair(view, 'strong')) {
            replaceMainSelection(view, (selected) => ({
              text: `**${selected || 'bold text'}**`,
              cursorOffset: selected ? undefined : 2,
            }));
          }
          break;
        case 'editor.toggleItalic':
          if (!tryStripMarkdownDecoratorPair(view, 'emphasis')) {
            replaceMainSelection(view, (selected) => ({
              text: `*${selected || 'italic text'}*`,
              cursorOffset: selected ? undefined : 1,
            }));
          }
          break;
        case 'editor.toggleUnderline':
          replaceMainSelection(view, (selected) => ({
            text: `<u>${selected || 'underlined text'}</u>`,
            cursorOffset: selected ? undefined : 3,
          }));
          break;
        case 'editor.toggleStrikethrough':
          if (!tryStripMarkdownDecoratorPair(view, 'strikethrough')) {
            replaceMainSelection(view, (selected) => ({
              text: `~~${selected || 'strikethrough text'}~~`,
              cursorOffset: selected ? undefined : 2,
            }));
          }
          break;
        case 'editor.toggleHighlight':
          replaceMainSelection(view, (selected) => ({
            text: `<mark>${selected || 'highlighted text'}</mark>`,
            cursorOffset: selected ? undefined : 6,
          }));
          break;
        case 'editor.insertFontColor':
          replaceMainSelection(view, (selected) => ({
            text: `<span style="color: #fabd2f;">${selected || 'colored text'}</span>`,
            cursorOffset: selected ? undefined : '<span style="color: #fabd2f;">'.length,
          }));
          break;
        case 'editor.insertLink':
          replaceMainSelection(view, (selected) => ({
            text: `[${selected || 'link text'}](https://example.com)`,
            cursorOffset: selected ? undefined : `[${selected || 'link text'}](`.length,
          }));
          break;
        case 'editor.insertInlineComment':
          if (docEditorFlags.comments && createCommentFromSelection(view)) {
            showSuccess('Comment anchor created');
            break;
          }
          replaceMainSelection(view, (selected) => ({
            text: `<!-- ${selected || 'inline comment'} -->`,
            cursorOffset: selected ? undefined : '<!-- '.length,
          }));
          break;
        case 'editor.insertImage':
          replaceMainSelection(view, () => ({
            text: '![Image description](https://example.com/image.png)',
            cursorOffset: '![Image description]('.length,
          }));
          break;
        case 'editor.insertTextAlign': {
          // Block `<p>` is invalid inside the inline `.cm-inline-html-widget` span; use a block-level span.
          const alignOpen = '<span style="display:block;text-align:left;width:100%">';
          replaceMainSelection(view, (selected) => ({
            text: `${alignOpen}${selected || 'aligned text'}</span>`,
            cursorOffset: selected ? undefined : alignOpen.length,
          }));
          break;
        }
        case 'editor.insertBulletList':
          prefixCurrentLine(view, '- ');
          break;
        case 'editor.insertChecklist':
          prefixCurrentLine(view, '- [ ] ');
          break;
        case 'editor.insertNumberedList':
          prefixCurrentLine(view, '1. ');
          break;
        case 'editor.insertMath':
          replaceMainSelection(view, (selected) => ({
            text: selected ? `$${selected}$` : '$x^2 + y^2 = z^2$',
            cursorOffset: selected ? undefined : 1,
          }));
          break;
        case 'editor.insertTable':
          replaceMainSelection(view, () => ({
            text: '\n| Column 1 | Column 2 |\n| --- | --- |\n| Value 1 | Value 2 |\n',
            cursorOffset: '\n| Column 1 | Column 2 |\n| '.length,
          }));
          break;
        case 'editor.insertMermaid':
          replaceMainSelection(view, () => ({
            text: '\n```mermaid\nflowchart LR\n  A[Start] --> B[Next]\n```\n',
            cursorOffset: '\n```mermaid\n'.length,
          }));
          break;
        default:
          break;
      }
    },
    [showSuccess, showWarning]
  );

  // Setup save + document zoom shortcuts.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        return;
      }
      const key = e.key;
      if (key === 's' || key === 'S') {
        e.preventDefault();
        handleSave();
        return;
      }
      const isZoomIn =
        key === '+' ||
        key === '=' ||
        key === 'Add' ||
        key === 'NumpadAdd' ||
        (key === '_' && e.shiftKey);
      if (isZoomIn) {
        e.preventDefault();
        handleDocumentZoomIn();
        return;
      }
      const isZoomOut = key === '-' || key === '_' || key === 'Subtract' || key === 'NumpadSubtract';
      if (isZoomOut) {
        e.preventDefault();
        handleDocumentZoomOut();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleDocumentZoomIn, handleDocumentZoomOut]);

  useEffect(() => {
    setPalettePrereqs({
      editorCanSave:
        activeDocument != null &&
        activeDocument.fileType === 'text' &&
        !activeDocument.isReadOnly,
      editorCanExportFile: activeDocument != null,
      editorCanListenDocument:
        activeDocument != null &&
        (activeDocument.fileType === 'pdf' || activeDocument.content.trim() !== ''),
      editorCanListenSelection:
        activeDocument != null && activeDocument.fileType === 'text',
      editorActiveIsPdf: activeDocument?.fileType === 'pdf',
    });
  }, [activeDocument]);

  useEffect(() => {
    const onReviewCommand = (event: Event): void => {
      const custom = event as CustomEvent<{ command: string }>;
      const view = getActiveEditorView();
      if (!view) {
        return;
      }
      const command = custom.detail?.command;
      if (command === 'editor.review.toggleSuggestMode') {
        toggleSuggestMode(view);
      } else if (command === 'editor.review.acceptSuggestion') {
        acceptActiveSuggestion(view);
      } else if (command === 'editor.review.rejectSuggestion') {
        rejectActiveSuggestion(view);
      } else if (command === 'editor.review.resolveComment') {
        resolveActiveComment(view);
      } else if (command === 'editor.review.reopenComment') {
        reopenActiveComment(view);
      } else if (command === 'editor.review.createComment') {
        createCommentFromSelection(view);
      }
    };
    window.addEventListener('gruvbox:editor-review-command', onReviewCommand as EventListener);
    return () => {
      window.removeEventListener('gruvbox:editor-review-command', onReviewCommand as EventListener);
    };
  }, []);

  useEffect(() => {
    const onPalette = async (ev: Event): Promise<void> => {
      const ce = ev as CustomEvent<PaletteActionEventDetail>;
      if (ce.detail?.action.kind === 'editor.save') {
        void handleSave();
        return;
      }
      if (ce.detail?.action.kind === 'editor.newMarkdown') {
        void handleNewMarkdownFile();
        return;
      }
      if (ce.detail?.action.kind === 'editor.print') {
        void handlePrintActiveDocument();
        return;
      }
      if (ce.detail?.action.kind === 'editor.exportHtml') {
        void handleExport('html');
        return;
      }
      if (ce.detail?.action.kind === 'editor.exportPdf') {
        void handleExport('pdf');
        return;
      }
      if (ce.detail?.action.kind === 'editor.exportDocx') {
        void handleExport('docx');
        return;
      }
      if (ce.detail?.action.kind === 'editor.exportFileCopy') {
        void handleExportFileCopy();
        return;
      }
      if (ce.detail?.action.kind === 'editor.openPdfExternal') {
        void handleOpenActivePdfExternally();
        return;
      }
      if (ce.detail?.action.kind === 'editor.listenDocument') {
        setListenSetupMode('document');
        setListenSetupOpen(true);
        return;
      }
      if (ce.detail?.action.kind === 'editor.listenSelection') {
        setListenSetupMode('selection');
        setListenSetupOpen(true);
        return;
      }
      if (ce.detail?.action.kind === 'editor.stopSpeech') {
        speech.stopPlayback();
        return;
      }
      if (ce.detail?.action.kind === 'editor.exportSpeechAudio') {
        void (async () => {
          const result = await speech.exportCloudMp3();
          if (result.canceled) {
            return;
          }
          if (result.ok && result.outputPath) {
            showSuccess(`Saved audio to ${result.outputPath}`);
          } else if (result.error) {
            showError(result.error);
          }
        })();
        return;
      }
      if (ce.detail?.action.kind === 'editor.generateAudiobook') {
        setAudiobookModalOpen(true);
        return;
      }
      if (ce.detail?.action.kind === 'editor.undo' || ce.detail?.action.kind === 'editor.redo') {
        const view = getActiveEditorView();
        if (!view) {
          showWarning('No active editor is focused');
          return;
        }
        if (ce.detail.action.kind === 'editor.undo') {
          undo(view);
          view.focus();
          return;
        }
        redo(view);
        view.focus();
        return;
      }
      if (
        ce.detail?.action.kind === 'editor.insertHeader' ||
        ce.detail?.action.kind === 'editor.insertFontFamily' ||
        ce.detail?.action.kind === 'editor.insertTextSize' ||
        ce.detail?.action.kind === 'editor.toggleBold' ||
        ce.detail?.action.kind === 'editor.toggleItalic' ||
        ce.detail?.action.kind === 'editor.toggleUnderline' ||
        ce.detail?.action.kind === 'editor.toggleStrikethrough' ||
        ce.detail?.action.kind === 'editor.toggleHighlight' ||
        ce.detail?.action.kind === 'editor.insertFontColor' ||
        ce.detail?.action.kind === 'editor.insertLink' ||
        ce.detail?.action.kind === 'editor.insertInlineComment' ||
        ce.detail?.action.kind === 'editor.insertImage' ||
        ce.detail?.action.kind === 'editor.insertTextAlign' ||
        ce.detail?.action.kind === 'editor.insertBulletList' ||
        ce.detail?.action.kind === 'editor.insertChecklist' ||
        ce.detail?.action.kind === 'editor.insertNumberedList' ||
        ce.detail?.action.kind === 'editor.insertMath' ||
        ce.detail?.action.kind === 'editor.insertTable' ||
        ce.detail?.action.kind === 'editor.insertMermaid'
      ) {
        applyEditorFormatAction(ce.detail.action);
        return;
      }
      if (
        ce.detail?.action.kind === 'editor.spellCheck' ||
        ce.detail?.action.kind === 'editor.grammarCheck' ||
        ce.detail?.action.kind === 'editor.readabilityCheck'
      ) {
        void handleLanguageReviewAction(ce.detail.action.kind);
      }
    };
    window.addEventListener(PALETTE_ACTION_EVENT, onPalette as EventListener);
    return () => window.removeEventListener(PALETTE_ACTION_EVENT, onPalette as EventListener);
  }, [
    applyEditorFormatAction,
    handleExport,
    handleExportFileCopy,
    handleLanguageReviewAction,
    handleNewMarkdownFile,
    handleOpenActivePdfExternally,
    handlePrintActiveDocument,
    handleSave,
    showError,
    showSuccess,
    showWarning,
    speech.exportCloudMp3,
    speech.listenDocument,
    speech.listenSelection,
    speech.stopPlayback,
  ]);

  // Handle sync prompt actions
  const handleKeepLocalChanges = useCallback(() => {
    fileSyncWatcher.handleKeepLocal();
    clearEvents();
  }, [fileSyncWatcher, clearEvents]);

  const handleLoadExternalVersion = useCallback(async () => {
    if (!activePath || !activeDocument) return;
    try {
      const reloadedContent = await IPCService.readFile(activePath);
      replaceDocumentContent(activePath, reloadedContent, { markClean: true });
      fileSyncWatcher.handleLoadExternal();
      clearEvents();
      setFileAccessError(null);
      showSuccess('Loaded external file version');
    } catch (error) {
      const friendlyMessage = getFriendlyErrorMessage(error, 'read');
      showError(`Failed to load external version: ${friendlyMessage}`);
      fileSyncWatcher.closePrompt();
    }
  }, [
    activePath,
    activeDocument,
    replaceDocumentContent,
    fileSyncWatcher,
    clearEvents,
    showSuccess,
    showError,
  ]);

  if (!activeDocument) {
    return (
      <div className="editor-pane">
        <StudioWelcomeHero />
      </div>
    );
  }

  // Render file access error state
  if (fileAccessError) {
    return (
      <div className="editor-pane">
        <div className="editor-error">
          <div className="error-content">
            <h2>Unable to Access File</h2>
            <p>{fileAccessError}</p>
            <button onClick={() => setFileAccessError(null)}>Dismiss</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`editor-pane middle-workbench${historyPreview ? ' history-preview-mode' : ''}`}>
      {(isReadingFile || isSavingFile) && (
        <div
          className="editor-loading"
          data-editor-loading={isReadingFile ? 'reading' : 'saving'}
          role="status"
          aria-live="polite"
        >
          <Loader size={24} className="spinner" />
          <p>{isReadingFile ? 'Reading file...' : 'Saving file...'}</p>
        </div>
      )}
      {!isReadingFile && (
        <>
          {showAiInlineUndoBar && (
            <div className="editor-ai-inline-review-bar" role="region" aria-label="AI suggested edits">
              <span className="editor-ai-inline-review-label">AI suggested edits</span>
              <div className="editor-ai-inline-review-actions">
                <button
                  type="button"
                  className="editor-ai-inline-review-commit"
                  onClick={handleCommitAiInline}
                >
                  <Check size={13} aria-hidden="true" />
                  <span>Commit / Save</span>
                </button>
              </div>
            </div>
          )}
          <AudiobookPlaylistDock
            manifestPath={lastAudiobookManifestPath}
            onClear={() => {
              setLastAudiobookManifestPath(null);
            }}
          />
          {!historyPreview && (
            <DocumentTabsReact
              tabs={tabs}
              activePath={activePath}
              onSelect={selectDocument}
              onClose={closeDocument}
              onReorder={reorderDocuments}
              onTogglePin={(path) => {
                const doc = documents.find((candidate) => candidate.path === path);
                setPinned(path, !(doc?.pinned ?? false));
              }}
            />
          )}
          {historyPreview && typeof onCloseHistoryPreview === 'function' && (
            <div className="history-preview-close-row" role="toolbar" aria-label="History preview controls">
              <button
                type="button"
                className="history-preview-close-button"
                onClick={onCloseHistoryPreview}
                aria-label="Close history preview"
                title="Close history preview"
              >
                ×
              </button>
            </div>
          )}
          <div
            className="middle-content-host"
            style={
              {
                '--editor-font-size': `${Math.round(15 * documentZoom)}px`,
              } as React.CSSProperties
            }
          >
            <MiddleContentHost
              activeDocument={activeDocument}
              onChange={(next) => updateContent(activeDocument.path, next)}
              aiHighlightSections={aiHighlightSections}
              onUndoAiSection={handleUndoAiSection}
              zoomScale={documentZoom}
            />
          </div>
        </>
      )}

      <AudiobookGenerationModal
        isOpen={audiobookModalOpen}
        onClose={() => {
          setAudiobookModalOpen(false);
        }}
        activeDocumentPath={activePath}
        language={activeDocument.language}
        fileType={activeDocument.fileType}
        textContent={activeDocument.content}
        onExportSuccess={(detail) => {
          setLastAudiobookManifestPath(detail.manifestPath);
          showSuccess(`Audiobook saved (${detail.chapterCount} chapters) to ${detail.outputDir}`);
        }}
      />

      <DocumentListenSetupModal
        isOpen={listenSetupOpen}
        mode={listenSetupMode}
        ui={speech.ui}
        onRateChange={speech.setRate}
        onVoiceChange={speech.setVoiceUri}
        onCancel={() => setListenSetupOpen(false)}
        onConfirm={async () => {
          const ok =
            listenSetupMode === 'document'
              ? await speech.listenDocument()
              : speech.listenSelection();
          if (ok) {
            setListenSetupOpen(false);
          }
        }}
      />

      <DocumentSpeechPlaybackModal
        playback={speech.ui.playback}
        ui={speech.ui}
        onPauseResume={speech.togglePause}
        onStop={speech.stopPlayback}
      />

      <SyncPrompt
        isOpen={fileSyncWatcher.showPrompt}
        filePath={activeDocument.path}
        onKeepLocal={handleKeepLocalChanges}
        onLoadExternal={handleLoadExternalVersion}
        isLoading={isReadingFile}
      />
    </div>
  );
};

export default EditorPane;
