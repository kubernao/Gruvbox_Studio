import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useLayoutEffect,
  useState,
} from 'react';
import * as monaco from 'monaco-editor';
import 'monaco-editor/min/vs/editor/editor.main.css';
import { ensureGruvboxDiffTheme } from './utils/monacoGruvboxTheme';
import { lineAnchorYRelativeToHost } from './utils/monacoHunkAnchor';
import { MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS } from './utils/monacoMergeEditingOptions';
import { installMonacoCanceledDiffGuard } from './utils/monacoCanceledDiffGuard';
import type { MonacoDiffLineChange } from './utils/monacoDiffMeldRibbon';
import { buildReplacementTextFromChange } from './utils/monacoEditRange';
import { DeterministicMergeSession } from './utils/mergeApplyEngine';

interface HunkControl {
  hunkId: string;
  top: number;
}

function indexOfChangeForModifiedLine(changes: MonacoDiffLineChange[] | null, lineNumber: number): number {
  if (!changes?.length) {
    return -1;
  }
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const start = c.modifiedStartLineNumber;
    const endExclusive = c.modifiedEndLineNumber === 0 ? start + 1 : c.modifiedEndLineNumber + 1;
    if (lineNumber >= start && lineNumber < endExclusive) {
      return i;
    }
  }
  let nearest = 0;
  for (let i = 0; i < changes.length; i++) {
    if (changes[i].modifiedStartLineNumber <= lineNumber) {
      nearest = i;
    }
  }
  return nearest;
}

export interface MonacoDiffEditorHandle {
  setMergeEditing: (enabled: boolean) => void;
  getModifiedValue: () => string;
  setModifiedValue: (text: string) => void;
  goToDiff: (direction: 'next' | 'previous') => void;
  revealFirstDiff: () => void;
  getDiffMeta: () => { total: number; activeIndex: number };
  layout: () => void;
}

export interface MonacoDiffEditorProps {
  className?: string;
  originalText: string;
  modifiedText: string;
  languageId: string;
  mergeEditing: boolean;
  /** Meld-style header labels (short display strings; use title props for full text). */
  leftPaneTitle: string;
  rightPaneTitle: string;
  centerPaneTitle?: string;
  leftPaneTitleAttr?: string;
  rightPaneTitleAttr?: string;
  /** Active diff hunk index for ribbon emphasis (0-based); keep in sync with toolbar navigation. */
  activeDiffHunkIndex?: number;
  /** Fired when diff hunks or cursor position updates navigation metadata. */
  onDiffNavigationMeta?: (meta: { total: number; activeIndex: number }) => void;
  preferredSide?: 'left' | 'right';
}

export const MonacoDiffEditor = forwardRef<MonacoDiffEditorHandle, MonacoDiffEditorProps>(
  function MonacoDiffEditor(
    {
      className,
      originalText,
      modifiedText,
      languageId,
      mergeEditing,
      leftPaneTitle,
      rightPaneTitle,
      centerPaneTitle = 'Compare',
      leftPaneTitleAttr,
      rightPaneTitleAttr,
      activeDiffHunkIndex = 0,
      onDiffNavigationMeta,
    },
    ref,
  ) {
    const meldBodyRef = useRef<HTMLDivElement | null>(null);
    const controlsLaneRef = useRef<HTMLDivElement | null>(null);
    const activeHunkRef = useRef(activeDiffHunkIndex);
    activeHunkRef.current = activeDiffHunkIndex;
    const [hunkControls, setHunkControls] = useState<HunkControl[]>([]);
    const hunkMapRef = useRef<Map<string, MonacoDiffLineChange>>(new Map());
    const stableChangeByIdRef = useRef<Map<string, MonacoDiffLineChange>>(new Map());
    const deterministicSessionRef = useRef<DeterministicMergeSession | null>(null);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
    const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
    const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);
    const mergeEditingRef = useRef(mergeEditing);
    mergeEditingRef.current = mergeEditing;
    const disposeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const modelSessionIdRef = useRef(0);

    useEffect(() => installMonacoCanceledDiffGuard(), []);

    const emitNavMeta = useCallback(() => {
      const ed = diffEditorRef.current;
      if (!ed || !onDiffNavigationMeta) {
        return;
      }
      const changes = ed.getLineChanges() as MonacoDiffLineChange[] | null;
      const total = changes?.length ?? 0;
      const line = ed.getModifiedEditor().getPosition()?.lineNumber ?? 1;
      const activeIndex = total > 0 ? indexOfChangeForModifiedLine(changes, line) : -1;
      onDiffNavigationMeta({ total, activeIndex: Math.max(0, activeIndex) });
    }, [onDiffNavigationMeta]);

    const recomputeHunkControls = useCallback(() => {
      const diffEd = diffEditorRef.current;
      const host = meldBodyRef.current;
      if (!diffEd || !host || !mergeEditingRef.current) {
        setHunkControls([]);
        return;
      }
      const modifiedEditor = diffEd.getModifiedEditor();
      const rect = host.getBoundingClientRect();
      const changes = (diffEd.getLineChanges() as MonacoDiffLineChange[] | null) ?? [];
      hunkMapRef.current = new Map(changes.map((change) => [buildDiffHunkId(change), change]));
      const next: HunkControl[] = [];
      for (const ch of changes) {
        const line = Math.max(1, ch.modifiedStartLineNumber || 1);
        const top = lineAnchorYRelativeToHost(modifiedEditor, host, line);
        if (top === null) continue;
        if (top >= -24 && top <= rect.height + 24) {
          next.push({ hunkId: buildDiffHunkId(ch), top });
        }
      }
      setHunkControls(next);
    }, []);

    const replaceHunkFromSide = useCallback((hunkId: string) => {
      const diffEd = diffEditorRef.current;
      const originalModel = originalModelRef.current;
      const modifiedModel = modifiedModelRef.current;
      if (!diffEd || !originalModel || !modifiedModel) {
        return;
      }
      const change = hunkMapRef.current.get(hunkId);
      if (!change) {
        recomputeHunkControls();
        return;
      }
      const stableChange = stableChangeByIdRef.current.get(hunkId);
      const deterministicSession = deterministicSessionRef.current;
      if (stableChange && deterministicSession) {
        const replacement = buildReplacementTextFromChange(originalModel, stableChange);
        const next = deterministicSession.applyChoice(hunkId, replacement);
        if (!next.ok) {
          recomputeHunkControls();
          return;
        }
        modifiedModel.setValue(next.nextText);
      } else {
        const originalLines = buildReplacementTextFromChange(originalModel, change);
        const startIndex = Math.max(0, (change.modifiedStartLineNumber || 1) - 1);
        const endExclusive = change.modifiedEndLineNumber <= 0
          ? startIndex
          : Math.max(startIndex, change.modifiedEndLineNumber);
        const currentLines = modifiedModel.getValue().split('\n');
        const replacementLines = originalLines.length === 0 ? [] : originalLines.split('\n');
        const nextLines = [
          ...currentLines.slice(0, startIndex),
          ...replacementLines,
          ...currentLines.slice(endExclusive),
        ];
        modifiedModel.setValue(nextLines.join('\n'));
      }
      emitNavMeta();
      recomputeHunkControls();
    }, [emitNavMeta, recomputeHunkControls]);

    useEffect(() => {
      ensureGruvboxDiffTheme(monaco);

      const el = containerRef.current;
      if (!el) {
        return;
      }

      const diffEditor = monaco.editor.createDiffEditor(el, {
        automaticLayout: true,
        renderSideBySide: true,
        // Keep a strict two-pane layout; do not auto-fallback to inline when width is tight.
        useInlineViewWhenSpaceIsLimited: false,
        renderSideBySideInlineBreakpoint: 0,
        readOnly: true,
        originalEditable: false,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        diffWordWrap: 'on',
        wrappingStrategy: 'advanced',
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'off',
        lineNumbersMinChars: 0,
        renderOverviewRuler: false,
        enableSplitViewResizing: true,
        ignoreTrimWhitespace: false,
        // Legacy diff hits the worker less aggressively; main fix is deferred setModel below.
        diffAlgorithm: 'legacy',
      });
      diffEditorRef.current = diffEditor;
      diffEditor.getModifiedEditor().updateOptions(MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS);

      const d1 = diffEditor.onDidUpdateDiff(() => {
        if (!deterministicSessionRef.current) {
          const stableChanges = (diffEditor.getLineChanges() as MonacoDiffLineChange[] | null) ?? [];
          if (stableChanges.length > 0) {
            const stableById = new Map<string, MonacoDiffLineChange>();
            for (const stableChange of stableChanges) {
              stableById.set(buildDiffHunkId(stableChange), stableChange);
            }
            stableChangeByIdRef.current = stableById;
            deterministicSessionRef.current = new DeterministicMergeSession({
              baselineText: modifiedText,
              hunks: stableChanges.map((stableChange) => ({
                id: buildDiffHunkId(stableChange),
                startLineNumber: stableChange.modifiedStartLineNumber,
                endLineNumber: stableChange.modifiedEndLineNumber,
              })),
            });
          }
        }
        emitNavMeta();
        recomputeHunkControls();
      });
      const d2 = diffEditor.getModifiedEditor().onDidChangeCursorPosition(() => {
        emitNavMeta();
      });
      const d3 = diffEditor.getModifiedEditor().onDidChangeModelContent(() => {
        emitNavMeta();
        recomputeHunkControls();
      });
      const d4 = diffEditor.getModifiedEditor().onDidScrollChange(() => recomputeHunkControls());

      const ro = new ResizeObserver(() => {
        diffEditor.layout();
        recomputeHunkControls();
      });
      ro.observe(el);
      const bodyEl = meldBodyRef.current;
      if (bodyEl) {
        ro.observe(bodyEl);
      }

      return () => {
        d1.dispose();
        d2.dispose();
        d3.dispose();
        d4.dispose();
        ro.disconnect();
        diffEditor.setModel(null);
        const orig = originalModelRef.current;
        const mod = modifiedModelRef.current;
        originalModelRef.current = null;
        modifiedModelRef.current = null;
        diffEditorRef.current = null;
        stableChangeByIdRef.current = new Map();
        deterministicSessionRef.current = null;
        const edToDispose = diffEditor;
        // Defer disposal so in-flight diff worker cancellation does not surface as an uncaught rejection.
        if (disposeTimeoutRef.current !== null) {
          clearTimeout(disposeTimeoutRef.current);
        }
        disposeTimeoutRef.current = setTimeout(() => {
          disposeTimeoutRef.current = null;
          try {
            edToDispose.dispose();
          } catch {
            /* ignore */
          }
          try {
            orig?.dispose();
          } catch {
            /* ignore */
          }
          try {
            mod?.dispose();
          } catch {
            /* ignore */
          }
        }, 0);
      };
    }, [emitNavMeta, modifiedText, recomputeHunkControls]);

    const detachAndDisposeModelsSync = useCallback(() => {
      const ed = diffEditorRef.current;
      if (ed) {
        ed.setModel(null);
      }
      try {
        originalModelRef.current?.dispose();
      } catch {
        /* ignore */
      }
      try {
        modifiedModelRef.current?.dispose();
      } catch {
        /* ignore */
      }
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    }, []);

    useEffect(() => {
      const ed = diffEditorRef.current;
      if (!ed) {
        return;
      }
      const lang = languageId?.trim() || 'plaintext';
      const orig = originalModelRef.current;
      const mod = modifiedModelRef.current;
      if (orig && mod && !orig.isDisposed() && !mod.isDisposed()) {
        if (orig.getValue() !== originalText) {
          orig.setValue(originalText);
        }
        if (mod.getValue() !== modifiedText) {
          mod.setValue(modifiedText);
        }
        stableChangeByIdRef.current = new Map();
        deterministicSessionRef.current = null;
        monaco.editor.setModelLanguage(orig, lang);
        monaco.editor.setModelLanguage(mod, lang);
        ed.getOriginalEditor().updateOptions({ readOnly: true });
        ed.getModifiedEditor().updateOptions({
          readOnly: !mergeEditingRef.current,
          ...(mergeEditingRef.current ? MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS : {}),
        });
        requestAnimationFrame(() => {
          ed.layout();
          emitNavMeta();
          recomputeHunkControls();
        });
        return undefined;
      }

      detachAndDisposeModelsSync();
      const sid = ++modelSessionIdRef.current;
      const o = monaco.editor.createModel(
        originalText,
        lang,
        monaco.Uri.parse(`inmemory://gruvbox/diff/${sid}/original`),
      );
      const m = monaco.editor.createModel(
        modifiedText,
        lang,
        monaco.Uri.parse(`inmemory://gruvbox/diff/${sid}/modified`),
      );
      originalModelRef.current = o;
      modifiedModelRef.current = m;

      // Defer attaching models so the editor worker processes $acceptNewModel before $computeDiff.
      // Otherwise $computeDiff can see missing mirror models and return null ("no diff result available").
      let cancelled = false;
      const attachTimer = window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        if (diffEditorRef.current !== ed) {
          return;
        }
        if (originalModelRef.current !== o || modifiedModelRef.current !== m) {
          return;
        }
        if (o.isDisposed() || m.isDisposed()) {
          return;
        }
        ed.setModel({ original: o, modified: m });
        ed.getOriginalEditor().updateOptions({ readOnly: true });
        ed.getModifiedEditor().updateOptions({
          readOnly: !mergeEditingRef.current,
          ...(mergeEditingRef.current ? MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS : {}),
        });
        requestAnimationFrame(() => {
          ed.layout();
          emitNavMeta();
          recomputeHunkControls();
        });
      }, 0);

      return () => {
        cancelled = true;
        window.clearTimeout(attachTimer);
        if (originalModelRef.current === o && modifiedModelRef.current === m) {
          const cur = ed.getModel();
          const attachedHere = cur?.original === o && cur?.modified === m;
          if (!attachedHere) {
            try {
              o.dispose();
            } catch {
              /* ignore */
            }
            try {
              m.dispose();
            } catch {
              /* ignore */
            }
            originalModelRef.current = null;
            modifiedModelRef.current = null;
          }
        }
      };
    }, [originalText, modifiedText, languageId, detachAndDisposeModelsSync, emitNavMeta, recomputeHunkControls]);

    useLayoutEffect(() => {
      const ed = diffEditorRef.current;
      if (!ed) {
        return;
      }
      ed.getOriginalEditor().updateOptions({ readOnly: true });
      ed.getModifiedEditor().updateOptions({
        readOnly: !mergeEditing,
        ...(mergeEditing ? MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS : {}),
      });
    }, [mergeEditing]);

    useLayoutEffect(() => {
      if (!mergeEditing) {
        setHunkControls([]);
        return;
      }
      const ed = diffEditorRef.current;
      const host = meldBodyRef.current;
      if (!ed || !host) {
        return;
      }
      ed.layout();
      ed.getModifiedEditor().layout();
      let cancelled = false;
      const schedule = () => {
        if (cancelled) return;
        recomputeHunkControls();
      };
      requestAnimationFrame(() => {
        schedule();
        requestAnimationFrame(schedule);
      });
      const t = window.setTimeout(schedule, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }, [mergeEditing, recomputeHunkControls]);

    useImperativeHandle(
      ref,
      () => ({
        setMergeEditing(enabled: boolean) {
          const ed = diffEditorRef.current;
          if (!ed) {
            return;
          }
          ed.getOriginalEditor().updateOptions({ readOnly: true });
          ed.getModifiedEditor().updateOptions({
            readOnly: !enabled,
            ...(enabled ? MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS : {}),
          });
        },
        getModifiedValue() {
          return modifiedModelRef.current?.getValue() ?? '';
        },
        setModifiedValue(text: string) {
          modifiedModelRef.current?.setValue(text);
        },
        goToDiff(direction: 'next' | 'previous') {
          const editor = diffEditorRef.current;
          if (!editor) {
            return;
          }
          const changes = editor.getLineChanges();
          if (!changes?.length) {
            return;
          }
          try {
            editor.goToDiff(direction);
          } catch {
            /* ignore */
          }
          requestAnimationFrame(() => {
            emitNavMeta();
          });
        },
        revealFirstDiff() {
          const editor = diffEditorRef.current;
          if (!editor) {
            return;
          }
          const changes = editor.getLineChanges();
          if (!changes?.length) {
            return;
          }
          try {
            editor.revealFirstDiff();
          } catch {
            /* ignore */
          }
          requestAnimationFrame(() => {
            emitNavMeta();
          });
        },
        getDiffMeta() {
          const ed = diffEditorRef.current;
          if (!ed) {
            return { total: 0, activeIndex: -1 };
          }
          const changes = ed.getLineChanges() as MonacoDiffLineChange[] | null;
          const total = changes?.length ?? 0;
          const line = ed.getModifiedEditor().getPosition()?.lineNumber ?? 1;
          const activeIndex = total > 0 ? indexOfChangeForModifiedLine(changes, line) : -1;
          return { total, activeIndex: Math.max(0, activeIndex) };
        },
        layout() {
          diffEditorRef.current?.layout();
          recomputeHunkControls();
        },
      }),
      [emitNavMeta, recomputeHunkControls],
    );

    const shellClass = [
      'meld-diff-shell',
      mergeEditing ? 'meld-diff-shell--merge' : '',
      className ?? 'monaco-diff-editor-host',
    ].filter(Boolean).join(' ');

    return (
      <div className={shellClass} data-testid="meld-diff-shell">
        <div className="meld-diff-panes-header" aria-hidden="true">
          <span className="meld-diff-pane-title meld-diff-pane-title--left" title={leftPaneTitleAttr ?? leftPaneTitle}>
            {leftPaneTitle}
          </span>
          <span className="meld-diff-pane-title meld-diff-pane-title--center">{centerPaneTitle}</span>
          <span
            className="meld-diff-pane-title meld-diff-pane-title--right"
            title={rightPaneTitleAttr ?? rightPaneTitle}
          >
            {rightPaneTitle}
          </span>
        </div>
        <div ref={meldBodyRef} className="meld-diff-body">
          <div ref={containerRef} className="meld-diff-editor-slot" />
          <div ref={controlsLaneRef} className="monaco-hunk-controls-lane" aria-hidden={!mergeEditing}>
            {mergeEditing && hunkControls.map((hunk) => (
              <div
                key={hunk.hunkId}
                className="monaco-hunk-control-group"
                style={{ top: `${hunk.top}px` }}
              >
                <button
                  type="button"
                  className="monaco-hunk-btn monaco-hunk-btn-apply-arrow"
                  // Undo always restores the original-side hunk into modified.
                  // This keeps behavior consistent regardless of merge polarity.
                  onClick={() => replaceHunkFromSide(hunk.hunkId)}
                  title="Apply to Result"
                  aria-label="Apply to Result"
                >
                  <span className="monaco-hunk-arrow monaco-hunk-arrow--right" aria-hidden>→</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
);

function buildDiffHunkId(change: MonacoDiffLineChange): string {
  const modifiedStart = Math.max(1, change.modifiedStartLineNumber || 1);
  const modifiedEnd = Math.max(modifiedStart, change.modifiedEndLineNumber || modifiedStart);
  return `diff:${modifiedStart}:${modifiedEnd}:${change.originalStartLineNumber}:${change.originalEndLineNumber}`;
}
