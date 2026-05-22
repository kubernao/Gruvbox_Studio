import { describe, expect, it, vi } from 'vitest';
import {
  applyMergeHunkPatch,
  DeterministicMergeSession,
} from '../../src/frontend/components/DiffViewer/utils/mergeApplyEngine';
import type { MonacoDiffLineChange } from '../../src/frontend/components/DiffViewer/utils/monacoDiffMeldRibbon';

vi.mock('monaco-editor', () => ({
  Range: class Range {
    public constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  editor: {
    setModelLanguage: () => undefined,
  },
}));

/**
 * This helper creates explicit line-change fixtures so tests can focus on one
 * merge scenario at a time without repeating Monaco metadata boilerplate.
 * Keeping this fixture builder tiny and deterministic makes each assertion
 * easier to scan and directly maps tests to user-visible merge operations.
 */
function mkChange(partial: Partial<MonacoDiffLineChange>): MonacoDiffLineChange {
  return {
    originalStartLineNumber: 1,
    originalEndLineNumber: 1,
    modifiedStartLineNumber: 1,
    modifiedEndLineNumber: 1,
    ...partial,
  };
}

describe('mergeApplyEngine', () => {
  /**
   * This case reproduces the regression directly by applying a replacement at
   * line two and asserting line one remains untouched after the operation.
   * If this fails, we have reintroduced the exact "line above deleted" bug.
   */
  it('preserves the line above when replacing a hunk in the middle', () => {
    const resultText = ['alpha', 'bravo', 'charlie'].join('\n');
    const sourceText = ['BRAVO_NEW'].join('\n');
    const change = mkChange({
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 2,
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
    });

    const applied = applyMergeHunkPatch({ resultText, sourceText, change });
    expect(applied.ok).toBe(true);
    expect(applied.nextText).toBe(['alpha', 'BRAVO_NEW', 'charlie'].join('\n'));
  });

  /**
   * This case validates insertion semantics where Monaco marks modifiedEnd as
   * zero. The previous line must stay intact while new lines are inserted
   * below it, which prevents the accidental deletion users are reporting.
   */
  it('inserts new content without deleting the previous line', () => {
    const resultText = ['alpha', 'charlie'].join('\n');
    const sourceText = ['bravo'].join('\n');
    const change = mkChange({
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 0,
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
    });

    const applied = applyMergeHunkPatch({ resultText, sourceText, change });
    expect(applied.ok).toBe(true);
    expect(applied.nextText).toBe(['alpha', 'bravo', 'charlie'].join('\n'));
  });

  /**
   * This case validates delete semantics where replacement text is empty and
   * verifies only the intended lines are removed while neighboring context
   * lines remain unchanged above and below the deleted span.
   */
  it('deletes only the targeted lines for pure-delete hunks', () => {
    const resultText = ['alpha', 'delete-me-1', 'delete-me-2', 'delta'].join('\n');
    const sourceText = '';
    const change = mkChange({
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 3,
      originalStartLineNumber: 2,
      originalEndLineNumber: 0,
    });

    const applied = applyMergeHunkPatch({ resultText, sourceText, change });
    expect(applied.ok).toBe(true);
    expect(applied.nextText).toBe(['alpha', 'delta'].join('\n'));
  });

  /**
   * This case verifies trailing newline preservation so merge operations do not
   * silently flip file-ending style while applying hunks at any position.
   */
  it('preserves trailing newline contract of the result buffer', () => {
    const resultText = 'alpha\nbravo\n';
    const sourceText = 'BRAVO_NEW';
    const change = mkChange({
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 2,
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
    });

    const applied = applyMergeHunkPatch({ resultText, sourceText, change });
    expect(applied.ok).toBe(true);
    expect(applied.nextText).toBe('alpha\nBRAVO_NEW\n');
  });

  /**
   * This case verifies deterministic session replay: two apply clicks recompute
   * from immutable baseline and never depend on prior incremental editor edits.
   */
  it('replays selected hunks deterministically from baseline text', () => {
    const session = new DeterministicMergeSession({
      baselineText: 'A\nB\nC\nD',
      hunks: [
        { id: 'h1', startLineNumber: 2, endLineNumber: 2 },
        { id: 'h2', startLineNumber: 4, endLineNumber: 4 },
      ],
    });
    const first = session.applyChoice('h2', 'DD');
    expect(first.ok).toBe(true);
    const second = session.applyChoice('h1', 'BB');
    expect(second.ok).toBe(true);
    expect(second.nextText).toBe('A\nBB\nC\nDD');
  });

  /**
   * This case verifies insertion hunks anchored at line 1 are materialized as
   * between-line insertions and preserve the preceding context line.
   */
  it('materializes insertion hunks without deleting previous lines', () => {
    const session = new DeterministicMergeSession({
      baselineText: 'alpha\ncharlie',
      hunks: [{ id: 'insert-1', startLineNumber: 1, endLineNumber: 0 }],
    });
    const applied = session.applyChoice('insert-1', 'bravo');
    expect(applied.ok).toBe(true);
    expect(applied.nextText).toBe('alpha\nbravo\ncharlie');
  });
});
