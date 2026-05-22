/**
 * Monaco edit-range EOL contracts
 * ===============================
 *
 * Companion to {@link ./monaco-edit-range.test.ts} that focuses specifically on
 * end-of-line handling when the diff viewer applies a per-hunk accept against
 * the modified Monaco model. The accept flow:
 *   1. Calls {@link buildSafeRangeFromChange} to produce the destination range.
 *   2. Calls {@link buildReplacementTextFromChange} to produce the replacement string.
 *   3. Hands both to Monaco's `executeEdits`.
 *
 * Step 2 hard-codes `\n` as the join separator. This contract is fine because
 * Monaco's `pushEditOperations` normalises EOL to the model's configured EOL
 * before applying, but the helpers must NEVER inject a stray newline at the
 * start or end of the replacement, or duplicate `\r` characters when the source
 * lines were tokenised from CRLF input.
 *
 * The tests below document both behaviours so a regression cannot ship without
 * an explicit contract change.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('monaco-editor', () => {
  class Range {
    public startLineNumber: number;
    public startColumn: number;
    public endLineNumber: number;
    public endColumn: number;

    public constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
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
import type { MonacoDiffLineChange } from '../../src/frontend/components/DiffViewer/utils/monacoDiffMeldRibbon';

/**
 * Minimal Monaco model that lets the EOL tests select the line content shape
 * (LF-tokenised vs. CRLF-tokenised) without pulling in the real editor. The
 * helper only consumes `getLineCount`, `getLineMaxColumn`, and `getLinesContent`.
 */
class FakeModel {
  private readonly lines: string[];

  public constructor(lines: string[]) {
    this.lines = lines;
  }

  public getLineCount(): number {
    return this.lines.length;
  }

  public getLineMaxColumn(lineNumber: number): number {
    const idx = Math.max(0, Math.min(this.lines.length - 1, lineNumber - 1));
    return this.lines[idx].length + 1;
  }

  public getLinesContent(): string[] {
    return [...this.lines];
  }
}

function mkChange(partial: Partial<MonacoDiffLineChange>): MonacoDiffLineChange {
  return {
    originalStartLineNumber: 1,
    originalEndLineNumber: 1,
    modifiedStartLineNumber: 1,
    modifiedEndLineNumber: 1,
    ...partial,
  };
}

describe('monacoEditRange EOL handling', () => {
  /**
   * U4 — Single-line replacement must not inject leading or trailing EOL.
   *
   * The diff viewer's per-hunk accept calls `executeEdits` with
   * `{ range, text: replacement }`. If the replacement includes a stray
   * `\n` at either end, Monaco inserts a phantom blank line into the modified
   * buffer; users see one extra empty line per accepted hunk, and the merge
   * save flow then writes that extra line to disk.
   */
  it('returns single-line text with no leading or trailing newline', () => {
    const source = new FakeModel(['first', 'middle', 'last']);
    const change = mkChange({ originalStartLineNumber: 2, originalEndLineNumber: 2 });

    const text = buildReplacementTextFromChange(source as any, change);
    expect(text).toBe('middle');
    expect(text.startsWith('\n')).toBe(false);
    expect(text.endsWith('\n')).toBe(false);
  });

  /**
   * U5 — Multi-line replacement uses LF as the join separator and preserves
   * any `\r` characters carried inside individual line content.
   *
   * Monaco's `getLinesContent` strips `\n` but does not strip `\r`. When the
   * original buffer was loaded from a CRLF document, the lines themselves may
   * end in `\r`. The helper must not double-strip those characters: the model
   * is responsible for EOL normalisation when the edit is applied. If the
   * helper rewrote `\r` we would silently corrupt CRLF documents.
   *
   * Conversely the helper must always join with `\n`, never `\r\n`. Monaco
   * normalises `\n` to the model's configured EOL on insert, so emitting LF
   * keeps the string portable across LF and CRLF models.
   */
  it('joins multi-line CRLF-tokenised source with LF and preserves embedded carriage returns', () => {
    const source = new FakeModel(['alpha\r', 'beta\r', 'gamma\r', 'delta\r']);
    const change = mkChange({ originalStartLineNumber: 1, originalEndLineNumber: 3 });

    const text = buildReplacementTextFromChange(source as any, change);
    // Expected layout: each input line keeps its trailing \r, join uses \n only.
    expect(text).toBe('alpha\r\nbeta\r\ngamma\r');
    expect(text.includes('\r\n\r')).toBe(false); // no \r duplication
    expect(text.endsWith('\n')).toBe(false);     // no trailing newline added
  });

  /**
   * Boundary check: the build-range helper must produce a valid insertion point
   * (zero-width range) for a delete-only change. EOL plays no part here, but the
   * range column must be 1 so Monaco does not include the trailing newline of
   * the previous line in the deletion.
   */
  it('produces a zero-width insertion range at column 1 for delete-only changes', () => {
    const target = new FakeModel(['one', 'two', 'three']);
    const change = mkChange({
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 0,
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
    });

    const range = buildSafeRangeFromChange(target as any, change);
    expect(range.startLineNumber).toBe(2);
    expect(range.endLineNumber).toBe(2);
    expect(range.startColumn).toBe(1);
    expect(range.endColumn).toBe(1);
  });
});
