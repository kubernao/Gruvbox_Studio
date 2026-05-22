// @vitest-environment jsdom
/**
 * Per-hunk accept logic for MonacoMergePane
 * =========================================
 *
 * `MonacoMergePane.applyIncomingHunk` (classic) and
 * `applyHunkFromVariant` / `applyUndoToBase` (triple AI) are tight wrappers
 * around two pure helpers:
 *
 *   - `buildSafeRangeFromChange(targetModel, change)` — produces the Monaco
 *     range to replace in the result/yours buffer.
 *   - `buildReplacementTextFromChange(sourceModel, change)` — extracts the
 *     incoming line slice from the source buffer.
 *
 * The wrapping then calls `editor.executeEdits` with `{ range, text }`. This
 * means the wrapper has no decision logic of its own; the entire correctness
 * of per-hunk accept rests on these two helpers + the polarity decision in
 * the caller.
 *
 *   C15 — pure deletion: insert range collapsed, replacement text empty
 *   C16 — pure insertion (originalEnd > 0, modifiedEnd = 0): zero-width range
 *   C17 — multi-line replacement: range spans N lines, text joined with LF
 *   C18 — replacement with line numbers past EOF: range clamped to line count
 *   C19 — single-line replace produces correct end column from line max
 *   C20 — defensive: change with negative startLine still clamps to 1
 *   C21 — replacement text uses sourceModel content (variant polarity check)
 *
 * Failing assertions here would manifest in the UI as "Apply Incoming"
 * inserting wrong content, deleting wrong line ranges, or crashing Monaco
 * with an out-of-bounds range — all of which we have seen in the field.
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * Mock `monaco-editor` to a minimal shape so importing the helper does not
 * pull in the full editor bundle (which crashes JSDOM during module init).
 * The helpers only use `Range` and `editor.setModelLanguage`.
 */
vi.mock('monaco-editor', () => {
  class Range {
    public startLineNumber: number;
    public startColumn: number;
    public endLineNumber: number;
    public endColumn: number;

    public constructor(
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number,
    ) {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }
  }

  return {
    Range,
    editor: {
      setModelLanguage: () => undefined,
    },
  };
});

import {
  buildReplacementTextFromChange,
  buildSafeRangeFromChange,
} from '../../src/frontend/components/DiffViewer/utils/monacoEditRange';
import { applyMergeHunkFromModels } from '../../src/frontend/components/DiffViewer/utils/mergeApplyEngine';

/**
 * Minimal stand-in for `monaco.editor.ITextModel`. Only the methods used by
 * the helpers are implemented. `getLineMaxColumn` returns one past the
 * character count to match Monaco's semantics (column is 1-indexed, end-of-line
 * column is `lineLength + 1`).
 */
class FakeModel {
  constructor(private readonly lines: string[]) {}
  getLineCount(): number {
    return this.lines.length;
  }
  getLineMaxColumn(line: number): number {
    if (line < 1 || line > this.lines.length) {
      return 1;
    }
    return this.lines[line - 1].length + 1;
  }
  getLinesContent(): string[] {
    return [...this.lines];
  }
}

/**
 * Builds a `MonacoDiffLineChange` with sane defaults so individual cases can
 * focus on the field under test. Monaco itself uses these field names verbatim.
 */
function mkChange(
  partial: Partial<{
    originalStartLineNumber: number;
    originalEndLineNumber: number;
    modifiedStartLineNumber: number;
    modifiedEndLineNumber: number;
  }>,
) {
  return {
    originalStartLineNumber: 1,
    originalEndLineNumber: 1,
    modifiedStartLineNumber: 1,
    modifiedEndLineNumber: 1,
    ...partial,
  } as any;
}

describe('Per-hunk accept helpers (MonacoMergePane apply path)', () => {
  /**
   * C15 — Pure deletion. The hunk says "remove modified lines 2–3, no
   * incoming text." Replacement text must be empty so executeEdits performs
   * a delete.
   */
  it('returns empty replacement text for pure deletion (originalEndLineNumber === 0)', () => {
    const source = new FakeModel(['ignored']);
    const change = mkChange({ originalEndLineNumber: 0 });
    const text = buildReplacementTextFromChange(source as any, change);
    expect(text).toBe('');
  });

  /**
   * C16 — Pure insertion in modified buffer. modifiedEnd=0 means "insert at
   * modifiedStart". The range must be a zero-width Range so executeEdits
   * inserts rather than replaces.
   */
  it('produces a zero-width range when modifiedEndLineNumber is 0 (pure insertion)', () => {
    const target = new FakeModel(['line a', 'line b']);
    const change = mkChange({
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 0,
    });
    const range = buildSafeRangeFromChange(target as any, change);
    expect(range.startLineNumber).toBe(2);
    expect(range.startColumn).toBe(1);
    expect(range.endLineNumber).toBe(2);
    expect(range.endColumn).toBe(1);
  });

  /**
   * C17 — Multi-line replacement. Replacement text joins the source slice
   * with LF. This case verifies that `getLinesContent().slice` math is
   * correct for the [start, end] inclusive contract.
   */
  it('joins multi-line replacement text with LF for inclusive original range', () => {
    const source = new FakeModel(['alpha', 'beta', 'gamma', 'delta']);
    const change = mkChange({ originalStartLineNumber: 2, originalEndLineNumber: 3 });
    const text = buildReplacementTextFromChange(source as any, change);
    expect(text).toBe('beta\ngamma');
    // No trailing newline — Monaco handles line break insertion separately
    expect(text.endsWith('\n')).toBe(false);
  });

  /**
   * C18 — Defensive clamp. If the diff produced a modifiedEndLineNumber
   * past the buffer (stale model after race), the range must clamp to the
   * actual line count rather than passing an invalid range to Monaco.
   */
  it('clamps modifiedEndLineNumber to model line count', () => {
    const target = new FakeModel(['only-line']);
    const change = mkChange({
      modifiedStartLineNumber: 1,
      modifiedEndLineNumber: 99, // far past EOF
    });
    const range = buildSafeRangeFromChange(target as any, change);
    expect(range.startLineNumber).toBe(1);
    expect(range.endLineNumber).toBe(1);
    // End column = "only-line".length + 1 = 10
    expect(range.endColumn).toBe('only-line'.length + 1);
  });

  /**
   * C19 — Single-line replacement uses the line's max column for end column.
   * Verifies that a 1-line hunk replaces from column 1 to past-the-end of the
   * same line.
   */
  it('uses model.getLineMaxColumn for the end column on single-line replacements', () => {
    const target = new FakeModel(['short', 'much-longer-line']);
    const change = mkChange({
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 2,
    });
    const range = buildSafeRangeFromChange(target as any, change);
    expect(range.endLineNumber).toBe(2);
    expect(range.endColumn).toBe('much-longer-line'.length + 1);
  });

  /**
   * C20 — Defensive: a change with negative or zero modifiedStartLineNumber
   * must clamp to 1 rather than throwing. Real-world we have seen cases where
   * Monaco produces modifiedStart=0 for pure insertions at the top of the
   * buffer.
   */
  it('clamps non-positive modifiedStartLineNumber to 1', () => {
    const target = new FakeModel(['a', 'b']);
    const change = mkChange({
      modifiedStartLineNumber: 0,
      modifiedEndLineNumber: 1,
    });
    const range = buildSafeRangeFromChange(target as any, change);
    expect(range.startLineNumber).toBe(1);
    expect(range.startColumn).toBe(1);
    expect(range.endLineNumber).toBe(1);
  });

  /**
   * C21 — Variant polarity. The replacement text is extracted from whichever
   * model the caller passes — left for "Apply Incoming" when polarity is
   * left-incoming, right when right-incoming. Verifies that the helper has
   * no implicit bias and the caller's polarity choice flows through.
   */
  it('extracts replacement text from the source model passed in (polarity flows through)', () => {
    const left = new FakeModel(['LEFT_LINE_1', 'LEFT_LINE_2']);
    const right = new FakeModel(['RIGHT_LINE_1', 'RIGHT_LINE_2']);
    const change = mkChange({ originalStartLineNumber: 1, originalEndLineNumber: 1 });

    const fromLeft = buildReplacementTextFromChange(left as any, change);
    const fromRight = buildReplacementTextFromChange(right as any, change);

    expect(fromLeft).toBe('LEFT_LINE_1');
    expect(fromRight).toBe('RIGHT_LINE_1');
    expect(fromLeft).not.toBe(fromRight);
  });

  /**
   * This case documents the classic merge path expectation after the engine
   * migration: applying a right-side hunk must replace only the targeted lines
   * in the editable left/result model while preserving surrounding context.
   */
  it('applies classic incoming hunk through mergeApplyEngine without touching line above', () => {
    const resultModel = new FakeModel(['keep-above', 'replace-me', 'keep-below']) as any;
    resultModel.getValue = () => resultModel.getLinesContent().join('\n');
    const sourceModel = new FakeModel(['source-1', 'SOURCE_NEW', 'source-3']) as any;
    const change = mkChange({
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 2,
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
    });
    const applied = applyMergeHunkFromModels({ resultModel, sourceModel, change });
    expect(applied.ok).toBe(true);
    expect(applied.nextText).toBe('keep-above\nSOURCE_NEW\nkeep-below');
  });

  /**
   * This case documents the triple merge variant path expectation where an
   * insertion hunk is applied into the center result model and the previous
   * line must stay untouched even when modifiedEndLineNumber is zero.
   */
  it('applies triple variant insertion without deleting prior line', () => {
    const resultModel = new FakeModel(['line-a', 'line-c']) as any;
    resultModel.getValue = () => resultModel.getLinesContent().join('\n');
    const sourceModel = new FakeModel(['line-a', 'line-b', 'line-c']) as any;
    const change = mkChange({
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 0,
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
    });
    const applied = applyMergeHunkFromModels({ resultModel, sourceModel, change });
    expect(applied.ok).toBe(true);
    expect(applied.nextText).toBe('line-a\nline-b\nline-c');
  });
});
