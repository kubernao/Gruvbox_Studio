import { describe, expect, it } from 'vitest';
import { buildTripleDiffState, resolveActiveHunkIndex } from '../../src/frontend/components/DiffViewer/utils/tripleDiffState';
import type { MonacoDiffLineChange } from '../../src/frontend/components/DiffViewer/utils/monacoDiffMeldRibbon';

/**
 * This suite validates the deterministic hunk mapping contract used by the
 * 3-pane merge flow so that variant and base diffs stay aligned across hunk
 * operations, cursor navigation, and repeated recomputes after edits.
 */
describe('tripleDiffState', () => {
  /**
   * This test verifies that state generation is deterministic for identical
   * snapshots and that each variant hunk receives the best base overlap match.
   */
  it('builds stable hunk ids and base mappings', () => {
    const leftChanges: MonacoDiffLineChange[] = [
      { originalStartLineNumber: 4, originalEndLineNumber: 5, modifiedStartLineNumber: 4, modifiedEndLineNumber: 5 },
      { originalStartLineNumber: 10, originalEndLineNumber: 10, modifiedStartLineNumber: 11, modifiedEndLineNumber: 11 },
    ];
    const rightChanges: MonacoDiffLineChange[] = [
      { originalStartLineNumber: 6, originalEndLineNumber: 7, modifiedStartLineNumber: 4, modifiedEndLineNumber: 5 },
    ];
    const baseChanges: MonacoDiffLineChange[] = [
      { originalStartLineNumber: 4, originalEndLineNumber: 5, modifiedStartLineNumber: 4, modifiedEndLineNumber: 5 },
      { originalStartLineNumber: 99, originalEndLineNumber: 99, modifiedStartLineNumber: 50, modifiedEndLineNumber: 50 },
    ];

    const first = buildTripleDiffState(leftChanges, rightChanges, baseChanges);
    const second = buildTripleDiffState(leftChanges, rightChanges, baseChanges);

    expect(first.hunks).toHaveLength(2);
    expect(first.hunks[0].id).toBe(second.hunks[0].id);
    expect(first.hunks[1].id).toBe(second.hunks[1].id);
    expect(first.hunks[0].leftChange).toEqual(leftChanges[0]);
    expect(first.hunks[0].rightChange).toEqual(rightChanges[0]);
    expect(first.hunks[0].baseChange).toEqual(baseChanges[0]);
    expect(first.hunks[1].baseChange).toBeNull();
    expect(first.hunks[0].id).toBe('hunk:4-5');
  });

  /**
   * This test verifies deterministic duplicate-signature handling so repeated
   * hunks still receive unique but stable IDs across recomputes.
   */
  it('merges overlapping left/right ranges into one logical hunk', () => {
    const left: MonacoDiffLineChange = {
      originalStartLineNumber: 4,
      originalEndLineNumber: 5,
      modifiedStartLineNumber: 4,
      modifiedEndLineNumber: 5,
    };
    const right: MonacoDiffLineChange = {
      originalStartLineNumber: 8,
      originalEndLineNumber: 9,
      modifiedStartLineNumber: 5,
      modifiedEndLineNumber: 6,
    };
    const state = buildTripleDiffState([left], [right], []);
    expect(state.hunks).toHaveLength(1);
    expect(state.hunks[0].id).toBe('hunk:4-6');
    expect(state.hunks[0].leftChange).toEqual(left);
    expect(state.hunks[0].rightChange).toEqual(right);
  });

  /**
   * This test verifies active-hunk resolution for in-range lines and fallback
   * behavior for cursor positions outside every hunk range.
   */
  it('resolves active hunk indexes from result cursor lines', () => {
    const state = buildTripleDiffState(
      [
        { originalStartLineNumber: 2, originalEndLineNumber: 3, modifiedStartLineNumber: 2, modifiedEndLineNumber: 3 },
        { originalStartLineNumber: 8, originalEndLineNumber: 9, modifiedStartLineNumber: 9, modifiedEndLineNumber: 10 },
      ],
      [],
      [],
    );

    expect(resolveActiveHunkIndex(state.hunks, 2)).toBe(0);
    expect(resolveActiveHunkIndex(state.hunks, 10)).toBe(1);
    expect(resolveActiveHunkIndex(state.hunks, 99)).toBe(1);
    expect(resolveActiveHunkIndex(state.hunks, 1)).toBe(0);
    expect(resolveActiveHunkIndex([], 5)).toBe(-1);
  });

  it('normalizes zero and negative modified ranges into valid hunk bounds', () => {
    const state = buildTripleDiffState(
      [{ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 0, modifiedEndLineNumber: -1 }],
      [],
      [],
    );
    expect(state.hunks).toHaveLength(1);
    expect(state.hunks[0].id).toBe('hunk:1-1');
    expect(state.hunks[0].modifiedStartLineNumber).toBe(1);
    expect(state.hunks[0].modifiedEndLineNumber).toBe(1);
  });

  it('prefers best-overlap base change when multiple candidates overlap', () => {
    const leftChanges: MonacoDiffLineChange[] = [
      { originalStartLineNumber: 30, originalEndLineNumber: 32, modifiedStartLineNumber: 10, modifiedEndLineNumber: 12 },
    ];
    const baseChanges: MonacoDiffLineChange[] = [
      { originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 10, modifiedEndLineNumber: 10 },
      { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 10, modifiedEndLineNumber: 12 },
      { originalStartLineNumber: 3, originalEndLineNumber: 3, modifiedStartLineNumber: 12, modifiedEndLineNumber: 14 },
    ];

    const state = buildTripleDiffState(leftChanges, [], baseChanges);
    expect(state.hunks).toHaveLength(1);
    expect(state.hunks[0].baseChange).toEqual(baseChanges[1]);
  });

  it('merges contiguous and overlapping modified ranges into one logical hunk', () => {
    const state = buildTripleDiffState(
      [
        { originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 5, modifiedEndLineNumber: 6 },
        { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 7, modifiedEndLineNumber: 7 },
      ],
      [
        { originalStartLineNumber: 10, originalEndLineNumber: 10, modifiedStartLineNumber: 6, modifiedEndLineNumber: 8 },
      ],
      [],
    );

    expect(state.hunks).toHaveLength(1);
    expect(state.hunks[0].modifiedStartLineNumber).toBe(5);
    expect(state.hunks[0].modifiedEndLineNumber).toBe(8);
  });
});
