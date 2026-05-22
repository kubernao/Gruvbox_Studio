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

import { buildReplacementTextFromChange, buildSafeRangeFromChange } from '../../src/frontend/components/DiffViewer/utils/monacoEditRange';
import type { MonacoDiffLineChange } from '../../src/frontend/components/DiffViewer/utils/monacoDiffMeldRibbon';

/**
 * Minimal fake model for range/replacement helpers.
 * Keeps tests deterministic and focused on helper contracts.
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

describe('monacoEditRange helpers', () => {
  it('builds insertion range when modified end is zero', () => {
    const target = new FakeModel(['a', 'bb', 'ccc']);
    const change = mkChange({ modifiedStartLineNumber: 2, modifiedEndLineNumber: 0 });

    const range = buildSafeRangeFromChange(target as any, change);
    expect(range.startLineNumber).toBe(2);
    expect(range.endLineNumber).toBe(2);
    expect(range.startColumn).toBe(1);
    expect(range.endColumn).toBe(1);
  });

  it('clamps replacement range end to model bounds', () => {
    const target = new FakeModel(['a', 'bb']);
    const change = mkChange({ modifiedStartLineNumber: 1, modifiedEndLineNumber: 99 });

    const range = buildSafeRangeFromChange(target as any, change);
    expect(range.startLineNumber).toBe(1);
    expect(range.endLineNumber).toBe(2);
    expect(range.endColumn).toBe(3);
  });

  it('extracts replacement text from original slice', () => {
    const source = new FakeModel(['alpha', 'beta', 'gamma', 'delta']);
    const change = mkChange({ originalStartLineNumber: 2, originalEndLineNumber: 3 });

    const text = buildReplacementTextFromChange(source as any, change);
    expect(text).toBe('beta\ngamma');
  });

  it('returns empty replacement text for delete semantics', () => {
    const source = new FakeModel(['alpha', 'beta']);
    const change = mkChange({ originalStartLineNumber: 2, originalEndLineNumber: 0 });

    const text = buildReplacementTextFromChange(source as any, change);
    expect(text).toBe('');
  });

  it('clamps invalid negative modified bounds to the first line', () => {
    const target = new FakeModel(['one', 'two']);
    const change = mkChange({ modifiedStartLineNumber: -8, modifiedEndLineNumber: -3 });

    const range = buildSafeRangeFromChange(target as any, change);
    expect(range.startLineNumber).toBe(1);
    expect(range.endLineNumber).toBe(1);
    expect(range.startColumn).toBe(1);
    expect(range.endColumn).toBe(1);
  });

  it('returns an empty replacement when original range starts past model length', () => {
    const source = new FakeModel(['alpha', 'beta']);
    const change = mkChange({ originalStartLineNumber: 99, originalEndLineNumber: 120 });

    const text = buildReplacementTextFromChange(source as any, change);
    expect(text).toBe('');
  });
});
