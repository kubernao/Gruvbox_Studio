import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ForwardedRef } from 'react';
import * as monaco from 'monaco-editor';
import 'monaco-editor/min/vs/editor/editor.main.css';
import { ensureGruvboxDiffTheme } from './utils/monacoGruvboxTheme';
import { lineAnchorYRelativeToHost } from './utils/monacoHunkAnchor';
import { MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS } from './utils/monacoMergeEditingOptions';
import { installMonacoCanceledDiffGuard } from './utils/monacoCanceledDiffGuard';
import type { MonacoDiffLineChange } from './utils/monacoDiffMeldRibbon';
import { buildTripleDiffState, resolveActiveHunkIndex, type TripleDiffState, type TripleVariant } from './utils/tripleDiffState';
import {
  applyMergeHunkFromModels,
  DeterministicMergeSession,
} from './utils/mergeApplyEngine';
import { buildReplacementTextFromChange } from './utils/monacoEditRange';

export interface MonacoMergePaneProps {
  /** Classic layout: merge result / yours (editable left). Ignored when tripleAiLayout. */
  oursContent?: string;
  baseContent: string;
  /** Classic layout: theirs (right). Ignored when tripleAiLayout. */
  theirsContent?: string;
  /** Triple-AI: left reference (AI branch A). */
  leftRefContent?: string;
  /** Triple-AI: right reference (AI branch B). */
  rightRefContent?: string;
  /** Triple-AI: editable merged output (center pane). */
  mergeResultContent?: string;
  /** When true, render single-row AI merge layout: left reference | merge result | right reference. */
  tripleAiLayout?: boolean;
  languageId: string;
  mergeEditing: boolean;
  leftPaneTitle: string;
  basePaneTitle: string;
  rightPaneTitle: string;
  /** Label for the center merge editor when tripleAiLayout. */
  mergeResultPaneTitle?: string;
  onResultChange?: (text: string) => void;
  onDiffNavigationMeta?: (meta: { total: number; activeIndex: number }) => void;
  preferredSide?: 'left' | 'right';
  navBoundaryMode?: 'clamp' | 'wrap';
  advancedMergeVisualsEnabled?: boolean;
  mergeDiagnosticsEnabled?: boolean;
  maxDecoratedHunks?: number;
}

export interface MonacoMergePaneHandle {
  goToDiff: (direction: 'next' | 'previous') => void;
  getDiffMeta: () => { total: number; activeIndex: number };
}

interface HunkControl {
  hunkId: string;
  top: number;
}

interface TriplePaneRoleMapping {
  incomingVariant: TripleVariant;
  currentVariant: TripleVariant;
  incomingLabel: string;
  currentLabel: string;
}

function resolveTriplePaneRoleMapping(preferredSide: 'left' | 'right'): TriplePaneRoleMapping {
  const incomingVariant: TripleVariant = preferredSide === 'right' ? 'right' : 'left';
  return {
    incomingVariant,
    currentVariant: incomingVariant === 'left' ? 'right' : 'left',
    incomingLabel: 'Incoming',
    currentLabel: 'Current',
  };
}

function clampLineRangeToModel(
  model: monaco.editor.ITextModel,
  startLine: number,
  endLine: number,
): { startLine: number; endLine: number; endColumn: number } | null {
  const lineCount = model.getLineCount();
  if (lineCount <= 0) {
    return null;
  }
  const safeStart = Math.min(lineCount, Math.max(1, startLine));
  const safeEnd = Math.min(lineCount, Math.max(safeStart, endLine));
  const endColumn = model.getLineMaxColumn(safeEnd);
  return { startLine: safeStart, endLine: safeEnd, endColumn };
}

const BASE_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  lineNumbers: 'off',
  lineNumbersMinChars: 0,
  fontSize: 13,
  wordWrap: 'on',
  wrappingStrategy: 'advanced',
};

function MonacoMergePaneClassic(props: MonacoMergePaneProps) {
  const {
    oursContent = '',
    baseContent,
    theirsContent = '',
    languageId,
    mergeEditing,
    leftPaneTitle,
    basePaneTitle,
    rightPaneTitle,
    onResultChange,
  } = props;

  const leftHostRef = useRef<HTMLDivElement | null>(null);
  const baseHostRef = useRef<HTMLDivElement | null>(null);
  const rightHostRef = useRef<HTMLDivElement | null>(null);

  const leftEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const baseEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const rightEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const leftModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const baseModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const rightModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const mergeDiffHostRef = useRef<HTMLDivElement | null>(null);
  const mergeDiffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const hunkMapRef = useRef<Map<string, MonacoDiffLineChange>>(new Map());
  const stableClassicChangeByIdRef = useRef<Map<string, MonacoDiffLineChange>>(new Map());
  const deterministicClassicSessionRef = useRef<DeterministicMergeSession | null>(null);
  const hunkControlsRef = useRef<HTMLDivElement | null>(null);
  const [hunkControls, setHunkControls] = useState<HunkControl[]>([]);

  useEffect(() => installMonacoCanceledDiffGuard(), []);

  const recomputeHunkControls = useCallback(() => {
    const diffEd = mergeDiffRef.current;
    const leftEditor = leftEditorRef.current;
    const host = hunkControlsRef.current;
    if (!diffEd || !leftEditor || !host || !mergeEditing) {
      setHunkControls([]);
      return;
    }
    const changes = (diffEd.getLineChanges() as MonacoDiffLineChange[] | null) ?? [];
    hunkMapRef.current = new Map(
      changes.map((change) => [buildClassicHunkId(change), change]),
    );
    const hostRect = host.getBoundingClientRect();
    const next: HunkControl[] = [];
    for (const ch of changes) {
      const line = Math.max(1, ch.modifiedStartLineNumber || 1);
      const top = lineAnchorYRelativeToHost(leftEditor, host, line);
      if (top === null) continue;
      if (top >= -24 && top <= hostRect.height + 24) {
        next.push({ hunkId: buildClassicHunkId(ch), top });
      }
    }
    setHunkControls(next);
  }, [mergeEditing]);

  const applyIncomingHunk = useCallback((hunkId: string) => {
    const diffEd = mergeDiffRef.current;
    const leftModel = leftModelRef.current;
    const rightModel = rightModelRef.current;
    if (!diffEd || !leftModel || !rightModel) {
      return;
    }
    const change = hunkMapRef.current.get(hunkId);
    if (!change) {
      recomputeHunkControls();
      return;
    }
    const stableChange = stableClassicChangeByIdRef.current.get(hunkId);
    const deterministicSession = deterministicClassicSessionRef.current;
    const applied = (stableChange && deterministicSession)
      ? (() => {
          const replacement = buildReplacementTextFromChange(rightModel, stableChange);
          const next = deterministicSession.applyChoice(hunkId, replacement);
          return next.ok
            ? { ok: true, nextText: next.nextText }
            : { ok: false, nextText: leftModel.getValue() };
        })()
      : applyMergeHunkFromModels({
          resultModel: leftModel,
          sourceModel: rightModel,
          change,
        });
    if (!applied.ok) {
      recomputeHunkControls();
      return;
    }
    leftModel.setValue(applied.nextText);
    onResultChange?.(applied.nextText);
    recomputeHunkControls();
  }, [onResultChange, recomputeHunkControls]);

  useEffect(() => {
    ensureGruvboxDiffTheme(monaco);

    const leftHost = leftHostRef.current;
    const baseHost = baseHostRef.current;
    const rightHost = rightHostRef.current;
    if (!leftHost || !baseHost || !rightHost) {
      return;
    }

    const leftEditor = monaco.editor.create(leftHost, { ...BASE_OPTIONS, readOnly: !mergeEditing });
    const baseEditor = monaco.editor.create(baseHost, { ...BASE_OPTIONS, readOnly: true });
    const rightEditor = monaco.editor.create(rightHost, { ...BASE_OPTIONS, readOnly: true });

    leftEditorRef.current = leftEditor;
    baseEditorRef.current = baseEditor;
    rightEditorRef.current = rightEditor;
    leftEditor.updateOptions(MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS);

    const leftModel = monaco.editor.createModel(oursContent, languageId || 'plaintext');
    const baseModel = monaco.editor.createModel(baseContent, languageId || 'plaintext');
    const rightModel = monaco.editor.createModel(theirsContent, languageId || 'plaintext');

    leftModelRef.current = leftModel;
    baseModelRef.current = baseModel;
    rightModelRef.current = rightModel;

    leftEditor.setModel(leftModel);
    baseEditor.setModel(baseModel);
    rightEditor.setModel(rightModel);

    const diffHost = document.createElement('div');
    diffHost.style.position = 'absolute';
    diffHost.style.left = '-99999px';
    diffHost.style.top = '0';
    diffHost.style.width = '1px';
    diffHost.style.height = '1px';
    diffHost.style.opacity = '0';
    document.body.appendChild(diffHost);
    mergeDiffHostRef.current = diffHost;
    const hiddenDiff = monaco.editor.createDiffEditor(diffHost, {
      renderSideBySide: false,
      readOnly: true,
      enableSplitViewResizing: false,
      minimap: { enabled: false },
      lineNumbers: 'off',
      lineNumbersMinChars: 0,
    });
    hiddenDiff.setModel({ original: rightModel, modified: leftModel });
    mergeDiffRef.current = hiddenDiff;

    const onLeftChange = leftEditor.onDidChangeModelContent(() => {
      onResultChange?.(leftEditor.getValue());
      recomputeHunkControls();
    });
    const onLeftScroll = leftEditor.onDidScrollChange(() => recomputeHunkControls());
    const onDiffUpdate = hiddenDiff.onDidUpdateDiff(() => {
      if (!deterministicClassicSessionRef.current) {
        const stableChanges = (hiddenDiff.getLineChanges() as MonacoDiffLineChange[] | null) ?? [];
        if (stableChanges.length > 0) {
          const stableById = new Map<string, MonacoDiffLineChange>();
          for (const stableChange of stableChanges) {
            stableById.set(buildClassicHunkId(stableChange), stableChange);
          }
          stableClassicChangeByIdRef.current = stableById;
          deterministicClassicSessionRef.current = new DeterministicMergeSession({
            baselineText: oursContent,
            hunks: stableChanges.map((stableChange) => ({
              id: buildClassicHunkId(stableChange),
              startLineNumber: stableChange.modifiedStartLineNumber,
              endLineNumber: stableChange.modifiedEndLineNumber,
            })),
          });
        }
      }
      recomputeHunkControls();
    });

    const ro = new ResizeObserver(() => {
      leftEditor.layout();
      baseEditor.layout();
      rightEditor.layout();
      recomputeHunkControls();
    });
    ro.observe(leftHost);
    ro.observe(baseHost);
    ro.observe(rightHost);

    if (mergeEditing) {
      requestAnimationFrame(() => {
        recomputeHunkControls();
        requestAnimationFrame(() => recomputeHunkControls());
      });
      window.setTimeout(() => recomputeHunkControls(), 0);
    }

    return () => {
      onLeftChange.dispose();
      onLeftScroll.dispose();
      onDiffUpdate.dispose();
      ro.disconnect();
      hiddenDiff.setModel(null);
      hiddenDiff.dispose();
      if (diffHost.parentNode) {
        diffHost.parentNode.removeChild(diffHost);
      }
      mergeDiffRef.current = null;
      mergeDiffHostRef.current = null;
      leftEditor.dispose();
      baseEditor.dispose();
      rightEditor.dispose();
      leftModel.dispose();
      baseModel.dispose();
      rightModel.dispose();
      leftEditorRef.current = null;
      baseEditorRef.current = null;
      rightEditorRef.current = null;
      leftModelRef.current = null;
      baseModelRef.current = null;
      rightModelRef.current = null;
      stableClassicChangeByIdRef.current = new Map();
      deterministicClassicSessionRef.current = null;
    };
  }, [mergeEditing, onResultChange, oursContent, recomputeHunkControls]);

  useEffect(() => {
    const lang = languageId || 'plaintext';
    const leftModel = leftModelRef.current;
    const baseModel = baseModelRef.current;
    const rightModel = rightModelRef.current;
    if (leftModel) {
      if (leftModel.getValue() !== oursContent) leftModel.setValue(oursContent);
      monaco.editor.setModelLanguage(leftModel, lang);
    }
    if (baseModel) {
      if (baseModel.getValue() !== baseContent) baseModel.setValue(baseContent);
      monaco.editor.setModelLanguage(baseModel, lang);
    }
    if (rightModel) {
      if (rightModel.getValue() !== theirsContent) rightModel.setValue(theirsContent);
      monaco.editor.setModelLanguage(rightModel, lang);
    }
    stableClassicChangeByIdRef.current = new Map();
    deterministicClassicSessionRef.current = null;
  }, [oursContent, baseContent, theirsContent, languageId]);

  useEffect(() => {
    leftEditorRef.current?.updateOptions({
      readOnly: !mergeEditing,
      ...(mergeEditing ? MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS : {}),
    });
    recomputeHunkControls();
  }, [mergeEditing, recomputeHunkControls]);

  useLayoutEffect(() => {
    if (!mergeEditing) {
      setHunkControls([]);
      return;
    }
    const leftEditor = leftEditorRef.current;
    const host = hunkControlsRef.current;
    if (!leftEditor || !host) {
      return;
    }
    leftEditor.layout();
    let cancelled = false;
    const schedule = () => {
      if (!cancelled) {
        recomputeHunkControls();
      }
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

  return (
    <div className={`monaco-merge-shell${mergeEditing ? ' monaco-merge-shell--merge' : ''}`} data-testid="monaco-merge-shell">
      <div className="monaco-merge-header" aria-hidden="true">
        <span className="monaco-merge-pane-title">{leftPaneTitle}</span>
        <span className="monaco-merge-pane-title">{basePaneTitle}</span>
        <span className="monaco-merge-pane-title">{rightPaneTitle}</span>
      </div>
      <div className="monaco-merge-body">
        <div className="monaco-merge-pane-slot monaco-merge-pane-slot-left" ref={leftHostRef} />
        <div className="monaco-merge-pane-slot monaco-merge-pane-slot-base" ref={baseHostRef} />
        <div className="monaco-merge-pane-slot monaco-merge-pane-slot-right" ref={rightHostRef} />
        <div className="monaco-merge-controls-lane" ref={hunkControlsRef} aria-hidden={!mergeEditing}>
          {mergeEditing &&
            hunkControls.map((hunk) => (
              <div
                key={hunk.hunkId}
                className="monaco-hunk-control-group"
                style={{ top: `${hunk.top}px` }}
              >
                <button
                  type="button"
                  className="monaco-hunk-btn monaco-hunk-btn-apply-arrow"
                  onClick={() => applyIncomingHunk(hunk.hunkId)}
                  title="Apply to Result"
                  aria-label="Apply to Result"
                >
                  <span className="monaco-hunk-arrow monaco-hunk-arrow--left" aria-hidden>←</span>
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function buildClassicHunkId(change: MonacoDiffLineChange): string {
  const start = Math.max(1, change.modifiedStartLineNumber || 1);
  const end = Math.max(start, change.modifiedEndLineNumber || start);
  return `classic:${start}:${end}:${change.originalStartLineNumber}:${change.originalEndLineNumber}`;
}

interface MonacoMergePaneTripleAiProps extends MonacoMergePaneProps {
  imperativeRef: ForwardedRef<MonacoMergePaneHandle>;
}

function MonacoMergePaneTripleAi(props: MonacoMergePaneTripleAiProps) {
  const {
    leftRefContent = '',
    baseContent,
    rightRefContent = '',
    mergeResultContent = '',
    languageId,
    mergeEditing,
    leftPaneTitle,
    rightPaneTitle,
    mergeResultPaneTitle = 'Result',
    onResultChange,
    onDiffNavigationMeta,
    imperativeRef,
    preferredSide = 'right',
    navBoundaryMode = 'clamp',
    advancedMergeVisualsEnabled = false,
    mergeDiagnosticsEnabled = false,
    maxDecoratedHunks = 500,
  } = props;

  const roleMapping = resolveTriplePaneRoleMapping(preferredSide);

  const leftHostRef = useRef<HTMLDivElement | null>(null);
  const baseHostRef = useRef<HTMLDivElement | null>(null);
  const rightHostRef = useRef<HTMLDivElement | null>(null);
  const resultHostRef = useRef<HTMLDivElement | null>(null);

  const leftEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const baseEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const rightEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const resultEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const leftModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const baseModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const rightModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const resultModelRef = useRef<monaco.editor.ITextModel | null>(null);

  const leftVariantDiffHostRef = useRef<HTMLDivElement | null>(null);
  const leftVariantDiffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const rightVariantDiffHostRef = useRef<HTMLDivElement | null>(null);
  const rightVariantDiffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const baseDiffHostRef = useRef<HTMLDivElement | null>(null);
  const baseDiffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  const hunkControlsRef = useRef<HTMLDivElement | null>(null);
  const [hunkControls, setHunkControls] = useState<HunkControl[]>([]);
  const resultDecorationIdsRef = useRef<string[]>([]);
  const leftDecorationIdsRef = useRef<string[]>([]);
  const rightDecorationIdsRef = useRef<string[]>([]);
  const tripleStateRef = useRef<TripleDiffState>({ hunks: [] });
  const hunkByIdRef = useRef<Map<string, TripleDiffState['hunks'][number]>>(new Map());
  const stableTripleHunkByIdRef = useRef<Map<string, TripleDiffState['hunks'][number]>>(new Map());
  const deterministicTripleSessionRef = useRef<DeterministicMergeSession | null>(null);
  const recomputeTimerRef = useRef<number | null>(null);
  const recomputeRafRef = useRef<number | null>(null);
  const recomputeGenerationRef = useRef(0);
  const isSyncingScrollRef = useRef(false);

  useEffect(() => installMonacoCanceledDiffGuard(), []);

  const clearScheduledRecompute = useCallback(() => {
    if (recomputeTimerRef.current !== null) {
      window.clearTimeout(recomputeTimerRef.current);
      recomputeTimerRef.current = null;
    }
    if (recomputeRafRef.current !== null) {
      window.cancelAnimationFrame(recomputeRafRef.current);
      recomputeRafRef.current = null;
    }
  }, []);

  const buildAndStoreTripleState = useCallback(() => {
    const leftVariantDiff = leftVariantDiffRef.current;
    const rightVariantDiff = rightVariantDiffRef.current;
    const baseDiff = baseDiffRef.current;
    if (!leftVariantDiff || !rightVariantDiff || !baseDiff) {
      tripleStateRef.current = { hunks: [] };
      hunkByIdRef.current = new Map();
      stableTripleHunkByIdRef.current = new Map();
      deterministicTripleSessionRef.current = null;
      return;
    }
    const leftVariantChanges = (leftVariantDiff.getLineChanges() as MonacoDiffLineChange[] | null) ?? [];
    const rightVariantChanges = (rightVariantDiff.getLineChanges() as MonacoDiffLineChange[] | null) ?? [];
    const baseChanges = (baseDiff.getLineChanges() as MonacoDiffLineChange[] | null) ?? [];
    tripleStateRef.current = buildTripleDiffState(leftVariantChanges, rightVariantChanges, baseChanges);
    hunkByIdRef.current = new Map(tripleStateRef.current.hunks.map((hunk) => [hunk.id, hunk]));
    if (!deterministicTripleSessionRef.current && tripleStateRef.current.hunks.length > 0) {
      stableTripleHunkByIdRef.current = new Map(tripleStateRef.current.hunks.map((hunk) => [hunk.id, hunk]));
      deterministicTripleSessionRef.current = new DeterministicMergeSession({
        baselineText: mergeResultContent,
        hunks: tripleStateRef.current.hunks.map((hunk) => ({
          id: hunk.id,
          startLineNumber: hunk.modifiedStartLineNumber,
          endLineNumber: hunk.modifiedEndLineNumber,
        })),
      });
    }
  }, [mergeResultContent]);

  const emitNavMeta = useCallback(() => {
    if (!onDiffNavigationMeta) {
      return;
    }
    const hunks = tripleStateRef.current.hunks;
    const line = resultEditorRef.current?.getPosition()?.lineNumber ?? 1;
    const activeIndex = resolveActiveHunkIndex(hunks, line);
    onDiffNavigationMeta({ total: hunks.length, activeIndex: Math.max(0, activeIndex) });
  }, [onDiffNavigationMeta]);

  const recomputeHunkControls = useCallback(() => {
    const resultEditor = resultEditorRef.current;
    const host = hunkControlsRef.current;
    if (!resultEditor || !host || !mergeEditing) {
      setHunkControls([]);
      return;
    }
    const hunks = tripleStateRef.current.hunks;
    const hostRect = host.getBoundingClientRect();
    const next: HunkControl[] = [];
    for (const hunk of hunks) {
      const line = Math.max(1, hunk.modifiedStartLineNumber || 1);
      const top = lineAnchorYRelativeToHost(resultEditor, host, line);
      if (top === null) continue;
      if (top >= -24 && top <= hostRect.height + 24) {
        next.push({ hunkId: hunk.id, top });
      }
    }
    setHunkControls(next);
  }, [mergeEditing]);

  const updateResultDiffDecorations = useCallback(() => {
    const resultEditor = resultEditorRef.current;
    const leftEditor = leftEditorRef.current;
    const rightEditor = rightEditorRef.current;
    const resultModel = resultModelRef.current;
    const leftModel = leftModelRef.current;
    const rightModel = rightModelRef.current;
    if (!resultEditor || !resultModel) {
      return;
    }
    if (!leftEditor || !rightEditor || !leftModel || !rightModel) {
      return;
    }
    if (!leftVariantDiffRef.current || !rightVariantDiffRef.current) {
      resultDecorationIdsRef.current = resultEditor.deltaDecorations(resultDecorationIdsRef.current, []);
      leftDecorationIdsRef.current = leftEditor.deltaDecorations(leftDecorationIdsRef.current, []);
      rightDecorationIdsRef.current = rightEditor.deltaDecorations(rightDecorationIdsRef.current, []);
      return;
    }
    const variantHunks = tripleStateRef.current.hunks
      .map((hunk) =>
        roleMapping.incomingVariant === 'left' ? hunk.leftChange : hunk.rightChange,
      )
      .filter((change): change is MonacoDiffLineChange => Boolean(change));
    if (variantHunks.length > maxDecoratedHunks) {
      resultDecorationIdsRef.current = resultEditor.deltaDecorations(resultDecorationIdsRef.current, []);
      leftDecorationIdsRef.current = leftEditor.deltaDecorations(leftDecorationIdsRef.current, []);
      rightDecorationIdsRef.current = rightEditor.deltaDecorations(rightDecorationIdsRef.current, []);
      return;
    }
    const resultDecorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const ch of variantHunks) {
      const startLine = Math.max(1, ch.modifiedStartLineNumber || 1);
      const endLine = Math.max(startLine, ch.modifiedEndLineNumber || startLine);
      const safeRange = clampLineRangeToModel(resultModel, startLine, endLine);
      if (!safeRange) {
        continue;
      }
      resultDecorations.push({
        range: new monaco.Range(safeRange.startLine, 1, safeRange.endLine, safeRange.endColumn),
        options: {
          isWholeLine: true,
          className: 'monaco-merge-line-diff',
        },
      });
    }
    resultDecorationIdsRef.current = resultEditor.deltaDecorations(resultDecorationIdsRef.current, resultDecorations);

    const sideDecorations = advancedMergeVisualsEnabled ? variantHunks.map((ch) => {
      const sideStart = Math.max(1, ch.originalStartLineNumber || 1);
      const sideEnd = Math.max(sideStart, ch.originalEndLineNumber || sideStart);
      const model = roleMapping.incomingVariant === 'left' ? leftModel : rightModel;
      const safeRange = clampLineRangeToModel(model, sideStart, sideEnd);
      if (!safeRange) {
        return null;
      }
      return {
        range: new monaco.Range(safeRange.startLine, 1, safeRange.endLine, safeRange.endColumn),
        options: {
          isWholeLine: true,
          className: 'monaco-merge-side-diff-active',
        },
      };
    }).filter(Boolean) as monaco.editor.IModelDeltaDecoration[] : [];
    const inactiveDecorations = advancedMergeVisualsEnabled ? variantHunks.map((ch) => {
      const sideStart = Math.max(1, ch.originalStartLineNumber || 1);
      const sideEnd = Math.max(sideStart, ch.originalEndLineNumber || sideStart);
      const model = roleMapping.incomingVariant === 'left' ? rightModel : leftModel;
      const safeRange = clampLineRangeToModel(model, sideStart, sideEnd);
      if (!safeRange) {
        return null;
      }
      return {
        range: new monaco.Range(safeRange.startLine, 1, safeRange.endLine, safeRange.endColumn),
        options: {
          isWholeLine: true,
          className: 'monaco-merge-side-diff-inactive',
        },
      };
    }).filter(Boolean) as monaco.editor.IModelDeltaDecoration[] : [];
    if (roleMapping.incomingVariant === 'left') {
      leftDecorationIdsRef.current = leftEditor.deltaDecorations(leftDecorationIdsRef.current, sideDecorations);
      rightDecorationIdsRef.current = rightEditor.deltaDecorations(rightDecorationIdsRef.current, inactiveDecorations);
    } else {
      rightDecorationIdsRef.current = rightEditor.deltaDecorations(rightDecorationIdsRef.current, sideDecorations);
      leftDecorationIdsRef.current = leftEditor.deltaDecorations(leftDecorationIdsRef.current, inactiveDecorations);
    }
  }, [advancedMergeVisualsEnabled, maxDecoratedHunks, roleMapping.incomingVariant]);

  const scheduleRecompute = useCallback(() => {
    const startedAt = performance.now();
    const emitDiagnostics = (phase: 'raf' | 'timeout') => {
      const elapsed = performance.now() - startedAt;
      if (mergeDiagnosticsEnabled && elapsed > 20) {
        console.debug('[triple-diff] recompute', { phase, elapsedMs: Math.round(elapsed), hunkCount: tripleStateRef.current.hunks.length });
      }
    };
    const generation = ++recomputeGenerationRef.current;
    clearScheduledRecompute();
    recomputeRafRef.current = window.requestAnimationFrame(() => {
      if (generation !== recomputeGenerationRef.current) {
        return;
      }
      recomputeRafRef.current = null;
      buildAndStoreTripleState();
      updateResultDiffDecorations();
      recomputeHunkControls();
      emitNavMeta();
      emitDiagnostics('raf');
    });
    recomputeTimerRef.current = window.setTimeout(() => {
      if (generation !== recomputeGenerationRef.current) {
        return;
      }
      recomputeTimerRef.current = null;
      buildAndStoreTripleState();
      updateResultDiffDecorations();
      recomputeHunkControls();
      emitNavMeta();
      emitDiagnostics('timeout');
    }, 0);
  }, [
    buildAndStoreTripleState,
    clearScheduledRecompute,
    emitNavMeta,
    mergeDiagnosticsEnabled,
    recomputeHunkControls,
    updateResultDiffDecorations,
  ]);

  const applyHunkFromVariant = useCallback(
    (hunkId: string, variant: TripleVariant) => {
      const refModel = variant === 'left' ? leftModelRef.current : rightModelRef.current;
      const resultModel = resultModelRef.current;
      if (!refModel || !resultModel) {
        return;
      }
      const hunk = stableTripleHunkByIdRef.current.get(hunkId) ?? hunkByIdRef.current.get(hunkId);
      if (!hunk) {
        scheduleRecompute();
        return;
      }
      const change = variant === 'left' ? hunk.leftChange : hunk.rightChange;
      if (!change) {
        scheduleRecompute();
        return;
      }
      const deterministicSession = deterministicTripleSessionRef.current;
      const applied = deterministicSession
        ? (() => {
            const replacement = buildReplacementTextFromChange(refModel, change);
            const next = deterministicSession.applyChoice(hunkId, replacement);
            return next.ok
              ? { ok: true, nextText: next.nextText }
              : { ok: false, nextText: resultModel.getValue() };
          })()
        : applyMergeHunkFromModels({
            resultModel,
            sourceModel: refModel,
            change,
          });
      if (!applied.ok) {
        scheduleRecompute();
        return;
      }
      resultModel.setValue(applied.nextText);
      onResultChange?.(applied.nextText);
      scheduleRecompute();
    },
    [onResultChange, scheduleRecompute],
  );

  const applyUndoToBase = useCallback(
    (hunkId: string) => {
      const baseModel = baseModelRef.current;
      const resultModel = resultModelRef.current;
      if (!baseModel || !resultModel) {
        return;
      }
      const hunk = stableTripleHunkByIdRef.current.get(hunkId) ?? hunkByIdRef.current.get(hunkId);
      const ch = hunk?.baseChange;
      if (!ch) {
        scheduleRecompute();
        return;
      }
      const deterministicSession = deterministicTripleSessionRef.current;
      const applied = deterministicSession
        ? (() => {
            const replacement = buildReplacementTextFromChange(baseModel, ch);
            const next = deterministicSession.applyChoice(hunkId, replacement);
            return next.ok
              ? { ok: true, nextText: next.nextText }
              : { ok: false, nextText: resultModel.getValue() };
          })()
        : applyMergeHunkFromModels({
            resultModel,
            sourceModel: baseModel,
            change: ch,
          });
      if (!applied.ok) {
        scheduleRecompute();
        return;
      }
      resultModel.setValue(applied.nextText);
      onResultChange?.(applied.nextText);
      scheduleRecompute();
    },
    [onResultChange, scheduleRecompute],
  );

  useEffect(() => {
    ensureGruvboxDiffTheme(monaco);

    const leftHost = leftHostRef.current;
    const baseHost = baseHostRef.current;
    const rightHost = rightHostRef.current;
    const resultHost = resultHostRef.current;
    if (!leftHost || !baseHost || !rightHost || !resultHost) {
      return;
    }

    const leftEditor = monaco.editor.create(leftHost, { ...BASE_OPTIONS, readOnly: true });
    const baseEditor = monaco.editor.create(baseHost, { ...BASE_OPTIONS, readOnly: true });
    const rightEditor = monaco.editor.create(rightHost, { ...BASE_OPTIONS, readOnly: true });
    const resultEditor = monaco.editor.create(resultHost, { ...BASE_OPTIONS, readOnly: !mergeEditing });

    leftEditorRef.current = leftEditor;
    baseEditorRef.current = baseEditor;
    rightEditorRef.current = rightEditor;
    resultEditorRef.current = resultEditor;
    resultEditor.updateOptions(MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS);

    const leftModel = monaco.editor.createModel(leftRefContent, languageId || 'plaintext');
    const baseModel = monaco.editor.createModel(baseContent, languageId || 'plaintext');
    const rightModel = monaco.editor.createModel(rightRefContent, languageId || 'plaintext');
    const resultModel = monaco.editor.createModel(mergeResultContent, languageId || 'plaintext');

    leftModelRef.current = leftModel;
    baseModelRef.current = baseModel;
    rightModelRef.current = rightModel;
    resultModelRef.current = resultModel;

    leftEditor.setModel(leftModel);
    baseEditor.setModel(baseModel);
    rightEditor.setModel(rightModel);
    resultEditor.setModel(resultModel);

    const mkHidden = () => {
      const diffHost = document.createElement('div');
      diffHost.style.position = 'absolute';
      diffHost.style.left = '-99999px';
      diffHost.style.top = '0';
      diffHost.style.width = '1px';
      diffHost.style.height = '1px';
      diffHost.style.opacity = '0';
      document.body.appendChild(diffHost);
      const hiddenDiff = monaco.editor.createDiffEditor(diffHost, {
        renderSideBySide: false,
        readOnly: true,
        enableSplitViewResizing: false,
        minimap: { enabled: false },
        lineNumbers: 'off',
        lineNumbersMinChars: 0,
      });
      return { diffHost, hiddenDiff };
    };

    const leftVariant = mkHidden();
    leftVariantDiffHostRef.current = leftVariant.diffHost;
    leftVariant.hiddenDiff.setModel({ original: leftModel, modified: resultModel });
    leftVariantDiffRef.current = leftVariant.hiddenDiff;

    const rightVariant = mkHidden();
    rightVariantDiffHostRef.current = rightVariant.diffHost;
    rightVariant.hiddenDiff.setModel({ original: rightModel, modified: resultModel });
    rightVariantDiffRef.current = rightVariant.hiddenDiff;

    const b = mkHidden();
    baseDiffHostRef.current = b.diffHost;
    b.hiddenDiff.setModel({ original: baseModel, modified: resultModel });
    baseDiffRef.current = b.hiddenDiff;

    const onResultChangeEv = resultEditor.onDidChangeModelContent(() => {
      onResultChange?.(resultEditor.getValue());
      scheduleRecompute();
    });
    const syncScrollFrom = (source: monaco.editor.IStandaloneCodeEditor) => {
      if (isSyncingScrollRef.current) {
        return;
      }
      isSyncingScrollRef.current = true;
      const top = source.getScrollTop();
      const left = source.getScrollLeft();
      const editors = [leftEditor, rightEditor, resultEditor];
      for (const editor of editors) {
        if (editor === source) {
          continue;
        }
        editor.setScrollTop(top);
        editor.setScrollLeft(left);
      }
      isSyncingScrollRef.current = false;
    };
    const onLeftScroll = leftEditor.onDidScrollChange(() => {
      syncScrollFrom(leftEditor);
      scheduleRecompute();
    });
    const onRightScroll = rightEditor.onDidScrollChange(() => {
      syncScrollFrom(rightEditor);
      scheduleRecompute();
    });
    const onResultScroll = resultEditor.onDidScrollChange(() => {
      syncScrollFrom(resultEditor);
      scheduleRecompute();
    });
    const onResultCursor = resultEditor.onDidChangeCursorPosition(() => emitNavMeta());
    const onLeftVariantDiffUpdate = leftVariant.hiddenDiff.onDidUpdateDiff(() => scheduleRecompute());
    const onRightVariantDiffUpdate = rightVariant.hiddenDiff.onDidUpdateDiff(() => scheduleRecompute());
    const onBaseDiffUpdate = b.hiddenDiff.onDidUpdateDiff(() => scheduleRecompute());

    const ro = new ResizeObserver(() => {
      leftEditor.layout();
      baseEditor.layout();
      rightEditor.layout();
      resultEditor.layout();
      scheduleRecompute();
    });
    ro.observe(leftHost);
    ro.observe(baseHost);
    ro.observe(rightHost);
    ro.observe(resultHost);

    if (mergeEditing) {
      scheduleRecompute();
    }
    scheduleRecompute();

    return () => {
      onResultChangeEv.dispose();
      onLeftScroll.dispose();
      onRightScroll.dispose();
      onResultScroll.dispose();
      onResultCursor.dispose();
      onLeftVariantDiffUpdate.dispose();
      onRightVariantDiffUpdate.dispose();
      onBaseDiffUpdate.dispose();
      ro.disconnect();
      clearScheduledRecompute();
      leftVariant.hiddenDiff.setModel(null);
      leftVariant.hiddenDiff.dispose();
      if (leftVariant.diffHost.parentNode) leftVariant.diffHost.parentNode.removeChild(leftVariant.diffHost);
      rightVariant.hiddenDiff.setModel(null);
      rightVariant.hiddenDiff.dispose();
      if (rightVariant.diffHost.parentNode) rightVariant.diffHost.parentNode.removeChild(rightVariant.diffHost);
      b.hiddenDiff.setModel(null);
      b.hiddenDiff.dispose();
      if (b.diffHost.parentNode) b.diffHost.parentNode.removeChild(b.diffHost);
      leftVariantDiffRef.current = null;
      rightVariantDiffRef.current = null;
      baseDiffRef.current = null;
      leftVariantDiffHostRef.current = null;
      rightVariantDiffHostRef.current = null;
      baseDiffHostRef.current = null;
      resultDecorationIdsRef.current = [];
      leftDecorationIdsRef.current = [];
      rightDecorationIdsRef.current = [];
      tripleStateRef.current = { hunks: [] };
      hunkByIdRef.current = new Map();
      stableTripleHunkByIdRef.current = new Map();
      deterministicTripleSessionRef.current = null;
      leftEditor.dispose();
      baseEditor.dispose();
      rightEditor.dispose();
      resultEditor.dispose();
      leftModel.dispose();
      baseModel.dispose();
      rightModel.dispose();
      resultModel.dispose();
      leftEditorRef.current = null;
      baseEditorRef.current = null;
      rightEditorRef.current = null;
      resultEditorRef.current = null;
      leftModelRef.current = null;
      baseModelRef.current = null;
      rightModelRef.current = null;
      resultModelRef.current = null;
    };
  }, [clearScheduledRecompute, emitNavMeta, mergeEditing, onResultChange, scheduleRecompute]);

  useEffect(() => {
    const lang = languageId || 'plaintext';
    const leftModel = leftModelRef.current;
    const baseModel = baseModelRef.current;
    const rightModel = rightModelRef.current;
    const resultModel = resultModelRef.current;
    if (leftModel) {
      if (leftModel.getValue() !== leftRefContent) leftModel.setValue(leftRefContent);
      monaco.editor.setModelLanguage(leftModel, lang);
    }
    if (baseModel) {
      if (baseModel.getValue() !== baseContent) baseModel.setValue(baseContent);
      monaco.editor.setModelLanguage(baseModel, lang);
    }
    if (rightModel) {
      if (rightModel.getValue() !== rightRefContent) rightModel.setValue(rightRefContent);
      monaco.editor.setModelLanguage(rightModel, lang);
    }
    if (resultModel) {
      if (resultModel.getValue() !== mergeResultContent) resultModel.setValue(mergeResultContent);
      monaco.editor.setModelLanguage(resultModel, lang);
    }
    stableTripleHunkByIdRef.current = new Map();
    deterministicTripleSessionRef.current = null;
    scheduleRecompute();
  }, [leftRefContent, baseContent, rightRefContent, mergeResultContent, languageId, scheduleRecompute]);

  useEffect(() => {
    scheduleRecompute();
  }, [roleMapping.incomingVariant, scheduleRecompute]);

  useEffect(() => {
    resultEditorRef.current?.updateOptions({
      readOnly: !mergeEditing,
      ...(mergeEditing ? MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS : {}),
    });
    scheduleRecompute();
  }, [mergeEditing, scheduleRecompute]);

  useLayoutEffect(() => {
    if (!mergeEditing) {
      setHunkControls([]);
      return;
    }
    const resultEditor = resultEditorRef.current;
    const host = hunkControlsRef.current;
    if (!resultEditor || !host) {
      return;
    }
    resultEditor.layout();
    let cancelled = false;
    const schedule = () => {
      if (!cancelled) {
        scheduleRecompute();
      }
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
  }, [mergeEditing, scheduleRecompute]);

  const jumpToDiff = useCallback((direction: 'next' | 'previous') => {
    const hunks = tripleStateRef.current.hunks;
    const editor = resultEditorRef.current;
    if (!editor || !hunks.length) {
      return;
    }
    const currentLine = editor.getPosition()?.lineNumber ?? 1;
    const currentIndex = resolveActiveHunkIndex(hunks, currentLine);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = (() => {
      if (direction === 'next') {
        if (currentIndex >= hunks.length - 1) {
          return navBoundaryMode === 'wrap' ? 0 : hunks.length - 1;
        }
        return currentIndex + 1;
      }
      if (currentIndex <= 0) {
        return navBoundaryMode === 'wrap' ? hunks.length - 1 : 0;
      }
      return currentIndex - 1;
    })();
    const line = hunks[targetIndex].modifiedStartLineNumber;
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealLineInCenter(line);
    emitNavMeta();
  }, [emitNavMeta, navBoundaryMode]);

  const getDiffMeta = useCallback(() => {
    const hunks = tripleStateRef.current.hunks;
    const line = resultEditorRef.current?.getPosition()?.lineNumber ?? 1;
    const activeIndex = resolveActiveHunkIndex(hunks, line);
    return { total: hunks.length, activeIndex: Math.max(0, activeIndex) };
  }, []);

  useImperativeHandle(imperativeRef, () => ({
    goToDiff: jumpToDiff,
    getDiffMeta,
  }), [getDiffMeta, jumpToDiff]);

  useEffect(() => {
    const resultEditor = resultEditorRef.current;
    if (!resultEditor) {
      return;
    }
    const keySubscription = resultEditor.onKeyDown((event) => {
      if (event.keyCode === monaco.KeyCode.F7) {
        event.preventDefault();
        event.stopPropagation();
        jumpToDiff(event.shiftKey ? 'previous' : 'next');
      }
    });
    return () => {
      keySubscription.dispose();
    };
  }, [jumpToDiff]);

  return (
    <div
      className={`monaco-merge-shell monaco-merge-shell--triple-ai${mergeEditing ? ' monaco-merge-shell--merge' : ''}`}
      data-testid="monaco-merge-shell"
    >
      <div className="monaco-merge-header" aria-hidden="true">
        <span className="monaco-merge-pane-title">
          {roleMapping.incomingVariant === 'left' ? `${roleMapping.incomingLabel}: ${leftPaneTitle}` : `${roleMapping.currentLabel}: ${leftPaneTitle}`}
        </span>
        <span className="monaco-merge-pane-title">{mergeResultPaneTitle}</span>
        <span className="monaco-merge-pane-title">
          {roleMapping.incomingVariant === 'right' ? `${roleMapping.incomingLabel}: ${rightPaneTitle}` : `${roleMapping.currentLabel}: ${rightPaneTitle}`}
        </span>
      </div>
      <div className="monaco-merge-triple-variant-bar" role="note" aria-label="3-way merge actions">
        <span className="monaco-merge-triple-variant-label">
          Actions write to Result only: Apply Incoming / Apply Current / Apply Base
        </span>
      </div>
      <div className="monaco-merge-triple-body">
        <div className="monaco-merge-pane-slot monaco-merge-pane-slot-left" ref={leftHostRef} />
        <div className="monaco-merge-triple-center" ref={hunkControlsRef}>
          <div className="monaco-merge-pane-slot monaco-merge-pane-slot-result" ref={resultHostRef} />
          <div className="monaco-merge-controls-lane" aria-hidden={!mergeEditing}>
            {mergeEditing &&
              hunkControls.map((hunk) => (
                <div
                  key={hunk.hunkId}
                  className="monaco-hunk-control-group monaco-hunk-control-group--triple"
                  style={{ top: `${hunk.top}px` }}
                >
                  {(hunkByIdRef.current.get(hunk.hunkId)?.[roleMapping.incomingVariant === 'left' ? 'leftChange' : 'rightChange']) && (
                    <button
                      type="button"
                      className="monaco-hunk-btn monaco-hunk-btn-apply"
                      onClick={() => applyHunkFromVariant(hunk.hunkId, roleMapping.incomingVariant)}
                      title="Apply Incoming to Result"
                    >
                      Apply Incoming
                    </button>
                  )}
                  {(hunkByIdRef.current.get(hunk.hunkId)?.[roleMapping.currentVariant === 'left' ? 'leftChange' : 'rightChange']) && (
                    <button
                      type="button"
                      className="monaco-hunk-btn monaco-hunk-btn-apply"
                      onClick={() => applyHunkFromVariant(hunk.hunkId, roleMapping.currentVariant)}
                      title="Apply Current to Result"
                    >
                      Apply Current
                    </button>
                  )}
                  {hunkByIdRef.current.get(hunk.hunkId)?.baseChange && (
                    <button
                      type="button"
                      className="monaco-hunk-btn monaco-hunk-btn-apply"
                      onClick={() => applyUndoToBase(hunk.hunkId)}
                      title="Apply Base to Result"
                    >
                      Apply Base
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
        <div className="monaco-merge-pane-slot monaco-merge-pane-slot-right" ref={rightHostRef} />
        <div className="monaco-merge-pane-slot monaco-merge-pane-slot-base monaco-merge-pane-slot-base-hidden" ref={baseHostRef} aria-hidden="true" />
      </div>
    </div>
  );
}

export const MonacoMergePane = forwardRef<MonacoMergePaneHandle, MonacoMergePaneProps>(function MonacoMergePane(props, ref) {
  if (props.tripleAiLayout) {
    return <MonacoMergePaneTripleAi {...props} imperativeRef={ref} />;
  }
  return <MonacoMergePaneClassic {...props} />;
});
