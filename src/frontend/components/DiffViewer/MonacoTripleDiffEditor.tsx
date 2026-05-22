import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as monaco from 'monaco-editor';
import 'monaco-editor/min/vs/editor/editor.main.css';
import { ensureGruvboxDiffTheme } from './utils/monacoGruvboxTheme';
import { MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS } from './utils/monacoMergeEditingOptions';
import { createMonacoMirrorModelSync } from './utils/monacoMirrorModelSync';
import { createMonacoDiffScrollCoordinator } from './utils/monacoDiffScrollCoordinator';
import {
  buildCanonicalHunks,
  getNextCanonicalHunkIndex,
  resolveCanonicalHunkIndex,
  type CanonicalHunk,
} from './utils/monacoTripleDiffNavigation';
import type { MonacoDiffLineChange } from './utils/monacoDiffMeldRibbon';
import type { TripleDiffNavBoundaryMode } from './types';
import {
  applyMergeHunkFromModels,
  DeterministicMergeSession,
} from './utils/mergeApplyEngine';
import { buildReplacementTextFromChange } from './utils/monacoEditRange';

/**
 * This component renders a true dual-diff three-way merge using two Monaco
 * diff editors side-by-side and one authoritative result model mirrored into
 * the second diff. All merge actions edit only the authoritative model.
 */
export interface MonacoTripleDiffEditorProps {
  leftRefContent: string;
  rightRefContent: string;
  baseContent: string;
  mergeResultContent: string;
  languageId: string;
  mergeEditing: boolean;
  preferredSide: 'left' | 'right';
  leftPaneTitle: string;
  rightPaneTitle: string;
  mergeResultPaneTitle: string;
  navBoundaryMode: TripleDiffNavBoundaryMode;
  onResultChange?: (text: string) => void;
  onDiffNavigationMeta?: (meta: { total: number; activeIndex: number }) => void;
}

export interface MonacoTripleDiffEditorHandle {
  goToDiff: (direction: 'next' | 'previous') => void;
  getDiffMeta: () => { total: number; activeIndex: number };
}

interface HunkControl {
  hunkId: string;
  top: number;
}

/**
 * This helper computes the y-position of a target line relative to a host
 * overlay element so hunk actions can be anchored near their line in the
 * authoritative modified pane.
 */
function getLineTopInHost(
  editor: monaco.editor.ICodeEditor,
  host: HTMLDivElement,
  lineNumber: number,
): number | null {
  const lineTop = editor.getTopForLineNumber(Math.max(1, lineNumber));
  const scrollTop = editor.getScrollTop();
  const hostRect = host.getBoundingClientRect();
  if (hostRect.height <= 0) {
    return null;
  }
  return lineTop - scrollTop;
}

export const MonacoTripleDiffEditor = forwardRef<MonacoTripleDiffEditorHandle, MonacoTripleDiffEditorProps>(
  function MonacoTripleDiffEditor(props, ref) {
    const {
      leftRefContent,
      rightRefContent,
      baseContent,
      mergeResultContent,
      languageId,
      mergeEditing,
      preferredSide,
      leftPaneTitle,
      rightPaneTitle,
      mergeResultPaneTitle,
      navBoundaryMode,
      onResultChange,
      onDiffNavigationMeta,
    } = props;

    const leftHostRef = useRef<HTMLDivElement | null>(null);
    const rightHostRef = useRef<HTMLDivElement | null>(null);
    const controlsHostRef = useRef<HTMLDivElement | null>(null);

    const leftDiffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
    const rightDiffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
    const leftRefModelRef = useRef<monaco.editor.ITextModel | null>(null);
    const rightRefModelRef = useRef<monaco.editor.ITextModel | null>(null);
    const baseModelRef = useRef<monaco.editor.ITextModel | null>(null);
    const resultAuthoritativeModelRef = useRef<monaco.editor.ITextModel | null>(null);
    const resultMirrorModelRef = useRef<monaco.editor.ITextModel | null>(null);
    const canonicalHunksRef = useRef<CanonicalHunk[]>([]);
    const hunkByIdRef = useRef<Map<string, CanonicalHunk>>(new Map());
    const stableHunkByIdRef = useRef<Map<string, CanonicalHunk>>(new Map());
    const deterministicSessionRef = useRef<DeterministicMergeSession | null>(null);
    const [hunkControls, setHunkControls] = useState<HunkControl[]>([]);
    const lineChangeSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
    const scrollCoordinatorRef = useRef<{ dispose: () => void } | null>(null);

    const roleLabels = useMemo(
      () => ({
        left: preferredSide === 'left' ? 'Incoming' : 'Current',
        right: preferredSide === 'right' ? 'Incoming' : 'Current',
      }),
      [preferredSide],
    );

    /**
     * This helper derives canonical hunks from both visible diff editors and
     * updates toolbar navigation metadata from the authoritative diff cursor.
     */
    const recomputeNavigation = useCallback(() => {
      const leftDiff = leftDiffRef.current;
      const rightDiff = rightDiffRef.current;
      if (!leftDiff || !rightDiff) {
        canonicalHunksRef.current = [];
        onDiffNavigationMeta?.({ total: 0, activeIndex: 0 });
        return;
      }

      const leftChanges = (leftDiff.getLineChanges() as MonacoDiffLineChange[] | null) ?? [];
      const rightChanges = (rightDiff.getLineChanges() as MonacoDiffLineChange[] | null) ?? [];
      canonicalHunksRef.current = buildCanonicalHunks(leftChanges, rightChanges);
      hunkByIdRef.current = new Map(canonicalHunksRef.current.map((hunk) => [hunk.id, hunk]));
      if (!deterministicSessionRef.current && canonicalHunksRef.current.length > 0) {
        stableHunkByIdRef.current = new Map(canonicalHunksRef.current.map((hunk) => [hunk.id, hunk]));
        deterministicSessionRef.current = new DeterministicMergeSession({
          baselineText: mergeResultContent,
          hunks: canonicalHunksRef.current.map((hunk) => ({
            id: hunk.id,
            startLineNumber: hunk.modifiedStartLineNumber,
            endLineNumber: hunk.modifiedEndLineNumber,
          })),
        });
      }

      const lineNumber = leftDiff.getModifiedEditor().getPosition()?.lineNumber ?? 1;
      const activeIndex = resolveCanonicalHunkIndex(canonicalHunksRef.current, lineNumber);
      onDiffNavigationMeta?.({
        total: canonicalHunksRef.current.length,
        activeIndex: Math.max(0, activeIndex),
      });
    }, [mergeResultContent, onDiffNavigationMeta]);

    /**
     * This helper positions merge action controls beside visible hunks in the
     * authoritative modified pane and keeps actions bounded to on-screen hunks.
     */
    const recomputeHunkControls = useCallback(() => {
      const host = controlsHostRef.current;
      const leftDiff = leftDiffRef.current;
      if (!host || !leftDiff || !mergeEditing) {
        setHunkControls([]);
        return;
      }
      const modifiedEditor = leftDiff.getModifiedEditor();
      const hostHeight = host.getBoundingClientRect().height;
      const nextControls: HunkControl[] = [];
      for (const hunk of canonicalHunksRef.current) {
        const top = getLineTopInHost(modifiedEditor, host, hunk.modifiedStartLineNumber);
        if (top === null) {
          continue;
        }
        if (!hunk.leftChange && !hunk.rightChange) {
          continue;
        }
        if (top >= -24 && top <= hostHeight + 24) {
          nextControls.push({ hunkId: hunk.id, top });
        }
      }
      setHunkControls(nextControls);
    }, [mergeEditing]);

    const recomputeAll = useCallback(() => {
      recomputeNavigation();
      recomputeHunkControls();
    }, [recomputeHunkControls, recomputeNavigation]);

    const applyTextToAuthoritativeRange = useCallback((hunkId: string, change: MonacoDiffLineChange, sourceModel: monaco.editor.ITextModel) => {
      const hunk = stableHunkByIdRef.current.get(hunkId) ?? hunkByIdRef.current.get(hunkId);
      const model = resultAuthoritativeModelRef.current;
      if (!hunk || !model) {
        recomputeAll();
        return;
      }
      const deterministicSession = deterministicSessionRef.current;
      const applied = deterministicSession
        ? (() => {
            const replacement = buildReplacementTextFromChange(sourceModel, change);
            const next = deterministicSession.applyChoice(hunkId, replacement);
            return next.ok
              ? { ok: true, nextText: next.nextText }
              : { ok: false, nextText: model.getValue() };
          })()
        : applyMergeHunkFromModels({
            resultModel: model,
            sourceModel,
            change,
          });
      if (!applied.ok) {
        recomputeAll();
        return;
      }
      model.setValue(applied.nextText);
    }, [recomputeAll]);

    /**
     * This helper maps hunk-level line changes to deterministic text surgery so
     * merge actions always write through the authoritative result model only.
     */
    const applyHunkFromChange = useCallback((hunkId: string, change: MonacoDiffLineChange | null, source: monaco.editor.ITextModel | null) => {
      if (!change || !source) {
        recomputeAll();
        return;
      }
      applyTextToAuthoritativeRange(hunkId, change, source);
    }, [applyTextToAuthoritativeRange, recomputeAll]);

    /**
     * This helper restores the hunk range from base text by line range so users
     * can always reset a result segment back to ancestor content.
     */
    const applyRestoreBase = useCallback((hunkId: string) => {
      const hunk = hunkByIdRef.current.get(hunkId);
      const baseModel = baseModelRef.current;
      if (!hunk || !baseModel) {
        recomputeAll();
        return;
      }
      const baseChange = hunk.leftChange ?? hunk.rightChange;
      if (!baseChange) {
        recomputeAll();
        return;
      }
      applyTextToAuthoritativeRange(hunkId, baseChange, baseModel);
    }, [applyTextToAuthoritativeRange, recomputeAll]);

    useEffect(() => {
      ensureGruvboxDiffTheme(monaco);
      const leftHost = leftHostRef.current;
      const rightHost = rightHostRef.current;
      if (!leftHost || !rightHost) {
        return;
      }

      const createDiff = (host: HTMLDivElement): monaco.editor.IStandaloneDiffEditor =>
        monaco.editor.createDiffEditor(host, {
          automaticLayout: true,
          renderSideBySide: true,
          useInlineViewWhenSpaceIsLimited: false,
          diffAlgorithm: 'legacy',
          readOnly: true,
          originalEditable: false,
          enableSplitViewResizing: true,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          diffWordWrap: 'on',
          wrappingStrategy: 'advanced',
          minimap: { enabled: false },
          lineNumbers: 'off',
          lineNumbersMinChars: 0,
          renderOverviewRuler: false,
        });

      const leftDiff = createDiff(leftHost);
      const rightDiff = createDiff(rightHost);
      leftDiffRef.current = leftDiff;
      rightDiffRef.current = rightDiff;
      leftDiff.getModifiedEditor().updateOptions(MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS);
      rightDiff.getModifiedEditor().updateOptions(MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS);

      const leftRefModel = monaco.editor.createModel(leftRefContent, languageId || 'plaintext');
      const rightRefModel = monaco.editor.createModel(rightRefContent, languageId || 'plaintext');
      const baseModel = monaco.editor.createModel(baseContent, languageId || 'plaintext');
      const resultAuthoritativeModel = monaco.editor.createModel(mergeResultContent, languageId || 'plaintext');
      const resultMirrorModel = monaco.editor.createModel(mergeResultContent, languageId || 'plaintext');

      leftRefModelRef.current = leftRefModel;
      rightRefModelRef.current = rightRefModel;
      baseModelRef.current = baseModel;
      resultAuthoritativeModelRef.current = resultAuthoritativeModel;
      resultMirrorModelRef.current = resultMirrorModel;

      leftDiff.setModel({ original: leftRefModel, modified: resultAuthoritativeModel });
      rightDiff.setModel({ original: rightRefModel, modified: resultMirrorModel });

      const mirrorSync = createMonacoMirrorModelSync({
        authoritativeModel: resultAuthoritativeModel,
        mirrorModel: resultMirrorModel,
        languageId,
      });

      const leftUpdate = leftDiff.onDidUpdateDiff(() => recomputeAll());
      const rightUpdate = rightDiff.onDidUpdateDiff(() => recomputeAll());
      const leftCursor = leftDiff.getModifiedEditor().onDidChangeCursorPosition(() => recomputeNavigation());
      const modelChange = leftDiff.getModifiedEditor().onDidChangeModelContent(() => {
        onResultChange?.(resultAuthoritativeModel.getValue());
        recomputeAll();
      });
      const leftScroll = leftDiff.getModifiedEditor().onDidScrollChange(() => recomputeHunkControls());
      const rightScroll = rightDiff.getModifiedEditor().onDidScrollChange(() => recomputeHunkControls());
      lineChangeSubscriptionRef.current = modelChange;

      scrollCoordinatorRef.current = createMonacoDiffScrollCoordinator({
        primary: leftDiff.getModifiedEditor(),
        secondary: rightDiff.getModifiedEditor(),
      });

      recomputeAll();

      return () => {
        lineChangeSubscriptionRef.current?.dispose();
        lineChangeSubscriptionRef.current = null;
        scrollCoordinatorRef.current?.dispose();
        scrollCoordinatorRef.current = null;
        leftUpdate.dispose();
        rightUpdate.dispose();
        leftCursor.dispose();
        leftScroll.dispose();
        rightScroll.dispose();
        mirrorSync.dispose();
        leftDiff.setModel(null);
        rightDiff.setModel(null);
        leftDiff.dispose();
        rightDiff.dispose();
        leftRefModel.dispose();
        rightRefModel.dispose();
        baseModel.dispose();
        resultAuthoritativeModel.dispose();
        resultMirrorModel.dispose();
        leftDiffRef.current = null;
        rightDiffRef.current = null;
        leftRefModelRef.current = null;
        rightRefModelRef.current = null;
        baseModelRef.current = null;
        resultAuthoritativeModelRef.current = null;
        resultMirrorModelRef.current = null;
        stableHunkByIdRef.current = new Map();
        deterministicSessionRef.current = null;
      };
    }, [
      baseContent,
      languageId,
      leftRefContent,
      mergeResultContent,
      onResultChange,
      recomputeAll,
      recomputeHunkControls,
      recomputeNavigation,
      rightRefContent,
    ]);

    useEffect(() => {
      const resultModel = resultAuthoritativeModelRef.current;
      const leftModel = leftRefModelRef.current;
      const rightModel = rightRefModelRef.current;
      const baseModel = baseModelRef.current;
      if (!resultModel || !leftModel || !rightModel || !baseModel) {
        return;
      }
      if (leftModel.getValue() !== leftRefContent) {
        leftModel.setValue(leftRefContent);
      }
      if (rightModel.getValue() !== rightRefContent) {
        rightModel.setValue(rightRefContent);
      }
      if (baseModel.getValue() !== baseContent) {
        baseModel.setValue(baseContent);
      }
      if (resultModel.getValue() !== mergeResultContent) {
        resultModel.setValue(mergeResultContent);
      }
      stableHunkByIdRef.current = new Map();
      deterministicSessionRef.current = null;
      monaco.editor.setModelLanguage(leftModel, languageId || 'plaintext');
      monaco.editor.setModelLanguage(rightModel, languageId || 'plaintext');
      monaco.editor.setModelLanguage(baseModel, languageId || 'plaintext');
      monaco.editor.setModelLanguage(resultModel, languageId || 'plaintext');
      recomputeAll();
    }, [baseContent, languageId, leftRefContent, mergeResultContent, recomputeAll, rightRefContent]);

    useEffect(() => {
      leftDiffRef.current?.getModifiedEditor().updateOptions({
        readOnly: !mergeEditing,
        ...(mergeEditing ? MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS : {}),
      });
      rightDiffRef.current?.getModifiedEditor().updateOptions({
        readOnly: true,
      });
      recomputeHunkControls();
    }, [mergeEditing, recomputeHunkControls]);

    const goToDiff = useCallback(
      (direction: 'next' | 'previous') => {
        const leftDiff = leftDiffRef.current;
        const rightDiff = rightDiffRef.current;
        if (!leftDiff || !rightDiff || canonicalHunksRef.current.length === 0) {
          return;
        }
        const lineNumber = leftDiff.getModifiedEditor().getPosition()?.lineNumber ?? 1;
        const currentIndex = resolveCanonicalHunkIndex(canonicalHunksRef.current, lineNumber);
        const targetIndex = getNextCanonicalHunkIndex(
          Math.max(0, currentIndex),
          canonicalHunksRef.current.length,
          direction,
          navBoundaryMode,
        );
        if (targetIndex < 0) {
          return;
        }
        const line = canonicalHunksRef.current[targetIndex].modifiedStartLineNumber;
        try {
          leftDiff.goToDiff(direction);
        } catch {
          leftDiff.getModifiedEditor().setPosition({ lineNumber: line, column: 1 });
          leftDiff.getModifiedEditor().revealLineInCenter(line);
        }
        rightDiff.getModifiedEditor().setPosition({ lineNumber: line, column: 1 });
        rightDiff.getModifiedEditor().revealLineInCenter(line);
        recomputeNavigation();
      },
      [navBoundaryMode, recomputeNavigation],
    );

    const getDiffMeta = useCallback(() => {
      const lineNumber = leftDiffRef.current?.getModifiedEditor().getPosition()?.lineNumber ?? 1;
      const activeIndex = resolveCanonicalHunkIndex(canonicalHunksRef.current, lineNumber);
      return {
        total: canonicalHunksRef.current.length,
        activeIndex: Math.max(0, activeIndex),
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        goToDiff,
        getDiffMeta,
      }),
      [getDiffMeta, goToDiff],
    );

    useEffect(() => {
      const editor = leftDiffRef.current?.getModifiedEditor();
      if (!editor) {
        return;
      }
      const subscription = editor.onKeyDown((event) => {
        if (event.keyCode === monaco.KeyCode.F7) {
          event.preventDefault();
          event.stopPropagation();
          goToDiff(event.shiftKey ? 'previous' : 'next');
        }
      });
      return () => subscription.dispose();
    }, [goToDiff]);

    return (
      <div
        className={`monaco-triple-diff-shell${mergeEditing ? ' monaco-triple-diff-shell--merge' : ''}`}
        data-testid="monaco-triple-diff-shell"
      >
        <div className="monaco-triple-diff-header" aria-hidden="true">
          <span className="monaco-merge-pane-title">{`${roleLabels.left}: ${leftPaneTitle}`}</span>
          <span className="monaco-merge-pane-title">{mergeResultPaneTitle}</span>
          <span className="monaco-merge-pane-title">{`${roleLabels.right}: ${rightPaneTitle}`}</span>
        </div>
        <div className="monaco-triple-diff-body">
          <div className="monaco-triple-diff-column">
            <div ref={leftHostRef} className="monaco-triple-diff-host" />
          </div>
          <div className="monaco-triple-diff-column">
            <div ref={rightHostRef} className="monaco-triple-diff-host" />
          </div>
          <div className="monaco-triple-diff-controls" ref={controlsHostRef} aria-hidden={!mergeEditing}>
            {mergeEditing &&
              hunkControls.map((control) => {
                const hunk = hunkByIdRef.current.get(control.hunkId);
                if (!hunk) {
                  return null;
                }
                return (
                  <div
                    key={hunk.id}
                    className="monaco-hunk-control-group monaco-hunk-control-group--triple"
                    style={{ top: `${control.top}px` }}
                  >
                    {hunk.leftChange && (
                      <button
                        type="button"
                        className="monaco-hunk-btn monaco-hunk-btn-apply"
                        onClick={() => applyHunkFromChange(control.hunkId, hunk.leftChange, leftRefModelRef.current)}
                        title="Apply Incoming to Result"
                      >
                        Apply Incoming
                      </button>
                    )}
                    {hunk.rightChange && (
                      <button
                        type="button"
                        className="monaco-hunk-btn monaco-hunk-btn-apply"
                        onClick={() => applyHunkFromChange(control.hunkId, hunk.rightChange, rightRefModelRef.current)}
                        title="Apply Current to Result"
                      >
                        Apply Current
                      </button>
                    )}
                    {(hunk.leftChange || hunk.rightChange) && (
                      <button
                        type="button"
                        className="monaco-hunk-btn monaco-hunk-btn-apply"
                        onClick={() => applyRestoreBase(control.hunkId)}
                        title="Apply Base to Result"
                      >
                        Apply Base
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    );
  },
);

