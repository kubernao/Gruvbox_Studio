import { describe, expect, it } from 'vitest';
import {
  buildCanonicalHunks,
  getNextCanonicalHunkIndex,
  resolveCanonicalHunkIndex,
} from '../../src/frontend/components/DiffViewer/utils/monacoTripleDiffNavigation';
import { buildTripleDiffState } from '../../src/frontend/components/DiffViewer/utils/tripleDiffState';
import type { MonacoDiffLineChange } from '../../src/frontend/components/DiffViewer/utils/monacoDiffMeldRibbon';

/**
 * This suite validates canonical hunk indexing and navigation semantics used by
 * the dual-diff three-way merge toolbar and keyboard movement.
 */
describe('monacoTripleDiffNavigation', () => {
  it('merges left/right diff streams into deterministic modified-range hunks', () => {
    const left: MonacoDiffLineChange[] = [
      { originalStartLineNumber: 1, originalEndLineNumber: 2, modifiedStartLineNumber: 4, modifiedEndLineNumber: 5 },
    ];
    const right: MonacoDiffLineChange[] = [
      { originalStartLineNumber: 3, originalEndLineNumber: 4, modifiedStartLineNumber: 4, modifiedEndLineNumber: 5 },
      { originalStartLineNumber: 10, originalEndLineNumber: 10, modifiedStartLineNumber: 12, modifiedEndLineNumber: 12 },
    ];

    const hunks = buildCanonicalHunks(left, right);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].id).toBe('hunk:4:5');
    expect(hunks[0].leftChange).toEqual(left[0]);
    expect(hunks[0].rightChange).toEqual(right[0]);
    expect(hunks[1].id).toBe('hunk:12:12');
  });

  it('resolves active index and boundary movement with clamp/wrap', () => {
    const hunks = buildCanonicalHunks(
      [{ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 }],
      [{ originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 8, modifiedEndLineNumber: 8 }],
    );

    expect(resolveCanonicalHunkIndex(hunks, 2)).toBe(0);
    expect(resolveCanonicalHunkIndex(hunks, 9)).toBe(1);
    expect(getNextCanonicalHunkIndex(1, hunks.length, 'next', 'clamp')).toBe(1);
    expect(getNextCanonicalHunkIndex(1, hunks.length, 'next', 'wrap')).toBe(0);
    expect(getNextCanonicalHunkIndex(0, hunks.length, 'previous', 'clamp')).toBe(0);
    expect(getNextCanonicalHunkIndex(0, hunks.length, 'previous', 'wrap')).toBe(1);
  });

  it('keeps adjacent non-overlapping ranges as separate canonical hunks', () => {
    const hunks = buildCanonicalHunks(
      [{ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 5, modifiedEndLineNumber: 6 }],
      [{ originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 7, modifiedEndLineNumber: 8 }],
    );

    expect(hunks).toHaveLength(2);
    expect(hunks[0].id).toBe('hunk:5:6');
    expect(hunks[1].id).toBe('hunk:7:8');
  });

  it('normalizes empty streams and boundary requests', () => {
    const hunks = buildCanonicalHunks([], []);
    expect(hunks).toEqual([]);
    expect(resolveCanonicalHunkIndex([], 5)).toBe(-1);
    expect(getNextCanonicalHunkIndex(0, 0, 'next', 'clamp')).toBe(-1);
  });

  it('keeps modified-range boundaries aligned with tripleDiffState', () => {
    const leftChanges: MonacoDiffLineChange[] = [
      { originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 3, modifiedEndLineNumber: 4 },
      { originalStartLineNumber: 9, originalEndLineNumber: 9, modifiedStartLineNumber: 8, modifiedEndLineNumber: 8 },
    ];
    const rightChanges: MonacoDiffLineChange[] = [
      { originalStartLineNumber: 4, originalEndLineNumber: 4, modifiedStartLineNumber: 4, modifiedEndLineNumber: 5 },
      { originalStartLineNumber: 20, originalEndLineNumber: 20, modifiedStartLineNumber: 12, modifiedEndLineNumber: 12 },
    ];

    const canonical = buildCanonicalHunks(leftChanges, rightChanges).map((hunk) => ({
      start: hunk.modifiedStartLineNumber,
      end: hunk.modifiedEndLineNumber,
    }));
    const triple = buildTripleDiffState(leftChanges, rightChanges, []).hunks.map((hunk) => ({
      start: hunk.modifiedStartLineNumber,
      end: hunk.modifiedEndLineNumber,
    }));

    expect(canonical).toEqual(triple);
  });
});

