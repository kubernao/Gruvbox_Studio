// @vitest-environment jsdom
/**
 * Merge resolver pure-TS contracts
 * ================================
 *
 * Pure-unit coverage for the merge-result builder used by the diff viewer's
 * accept-all / reject-all / per-hunk save flows. The tests intentionally avoid
 * any Monaco editor or Electron IPC: they exercise the fallback path of
 * {@link buildMergeResult} (which resolves to {@link buildMergeResultSync}
 * when `window.electronAPI` is absent) and the small helper functions used
 * by the toolbar.
 *
 * Each test corresponds to a pre-planned coverage row (U1-U3) from the
 * merge editor accept-changes test matrix.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMergeResult,
  getUnresolvedBlockIds,
  resolveAllBlocksToSide,
} from '../../src/frontend/components/DiffViewer/utils/mergeResolver';
import type { ChangeBlock, DiffRow } from '../../src/frontend/components/DiffViewer/types';

/**
 * Build a context row that is identical on both sides. Context rows must always
 * round-trip through the merge result regardless of which side is preferred.
 */
function ctx(text: string, leftLineNo: number, rightLineNo: number): DiffRow {
  return {
    type: 'context',
    leftLineNo,
    rightLineNo,
    leftText: text,
    rightText: text,
    changeBlockId: null,
  };
}

/**
 * Build a "change" row where both sides have content. Used to assert that the
 * resolver respects the per-block selection map and emits exactly one side.
 */
function change(blockId: number, leftText: string, rightText: string): DiffRow {
  return {
    type: 'change',
    leftLineNo: 1,
    rightLineNo: 1,
    leftText,
    rightText,
    changeBlockId: blockId,
  };
}

/** Build a pure-insert row (left side is null). */
function ins(blockId: number, rightText: string): DiffRow {
  return {
    type: 'ins',
    leftLineNo: null,
    rightLineNo: 1,
    leftText: null,
    rightText,
    changeBlockId: blockId,
  };
}

/** Build a pure-delete row (right side is null). */
function del(blockId: number, leftText: string): DiffRow {
  return {
    type: 'del',
    leftLineNo: 1,
    rightLineNo: null,
    leftText,
    rightText: null,
    changeBlockId: blockId,
  };
}

/** Resolve change-block bounds from a row array so individual tests stay small. */
function buildBlocks(rows: DiffRow[]): ChangeBlock[] {
  const byId = new Map<number, { firstRowIdx: number; lastRowIdx: number }>();
  rows.forEach((row, idx) => {
    const id = row.changeBlockId;
    if (id === null) return;
    const entry = byId.get(id);
    if (entry === undefined) {
      byId.set(id, { firstRowIdx: idx, lastRowIdx: idx });
      return;
    }
    entry.lastRowIdx = idx;
  });
  return Array.from(byId.entries()).map(([id, range]) => ({ id, ...range }));
}

afterEach(() => {
  // Keep tests hermetic: the diff viewer renders inside Electron in production,
  // but the resolver fallback path relies on window.electronAPI being absent.
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('mergeResolver pure-TS fallback', () => {
  /**
   * U1 — Unresolved blocks must reject save.
   *
   * The diff viewer relies on this guard to prevent the merge save flow from
   * writing partially-resolved content to disk. Removing the guard would silently
   * accept the right-side default and corrupt the file, so the contract is to
   * throw instead of returning an ambiguous string.
   */
  it('rejects save when any change block is unresolved', async () => {
    const rows: DiffRow[] = [
      ctx('alpha', 1, 1),
      change(1, 'left-1', 'right-1'),
      ctx('beta', 2, 2),
    ];
    const blocks = buildBlocks(rows);

    await expect(buildMergeResult(rows, {}, blocks)).rejects.toThrow(/unresolved/i);
  });

  /**
   * U2 — Single-block per-side selection.
   *
   * Verifies the smallest accept/reject contract: a single change block with
   * left selected emits the left side; right selected emits the right side.
   * This is the exact flow used by the per-hunk accept buttons.
   */
  it('emits left or right text from a single block based on selection', async () => {
    const rows: DiffRow[] = [
      ctx('header', 1, 1),
      change(1, 'LEFT', 'RIGHT'),
      ctx('footer', 3, 3),
    ];
    const blocks = buildBlocks(rows);

    const leftMerged = await buildMergeResult(rows, { 1: 'left' }, blocks);
    expect(leftMerged).toBe('header\nLEFT\nfooter');

    const rightMerged = await buildMergeResult(rows, { 1: 'right' }, blocks);
    expect(rightMerged).toBe('header\nRIGHT\nfooter');
  });

  /**
   * U3 — Multi-block ordering with mixed insert/delete/change/separator rows.
   *
   * The accept-all and reject-all flows must process every block in the order
   * they appear in the diff. This test mixes pure-inserts (no left text),
   * pure-deletes (no right text), and a multi-line change to confirm that:
   *   - inserts are emitted only when their side has text
   *   - deletes are emitted only when their side has text
   *   - separator rows produce no output
   *   - context rows are emitted exactly once
   *   - the relative order of blocks is preserved
   */
  it('emits multiple blocks in order with mixed insert/delete/change rows', async () => {
    const rows: DiffRow[] = [
      ctx('intro', 1, 1),
      del(1, 'OLD-LINE'),         // block 1 — pure delete
      ctx('between', 2, 1),
      ins(2, 'NEW-LINE'),         // block 2 — pure insert
      ctx('after-ins', 3, 3),
      change(3, 'L1', 'R1'),      // block 3 — multi-line change
      change(3, 'L2', 'R2'),
      { type: 'separator', leftLineNo: null, rightLineNo: null, leftText: null, rightText: null, changeBlockId: null },
      ctx('end', 4, 5),
    ];
    const blocks = buildBlocks(rows);

    // Accept all = left for AI proposed edits, right for normal git diffs. The
    // resolver does not know about polarity, so we test both sides explicitly.
    const allLeft = await buildMergeResult(
      rows,
      { 1: 'left', 2: 'left', 3: 'left' },
      blocks,
    );
    // Block 1 left = 'OLD-LINE'; Block 2 left = null (skipped); Block 3 left = 'L1','L2'
    expect(allLeft).toBe('intro\nOLD-LINE\nbetween\nafter-ins\nL1\nL2\nend');

    const allRight = await buildMergeResult(
      rows,
      { 1: 'right', 2: 'right', 3: 'right' },
      blocks,
    );
    // Block 1 right = null (skipped); Block 2 right = 'NEW-LINE'; Block 3 right = 'R1','R2'
    expect(allRight).toBe('intro\nbetween\nNEW-LINE\nafter-ins\nR1\nR2\nend');

    // Mixed selection — block 1 keep old (left), block 2 take new (right),
    // block 3 reject (left). This is the per-hunk accept flow's most general case.
    const mixed = await buildMergeResult(
      rows,
      { 1: 'left', 2: 'right', 3: 'left' },
      blocks,
    );
    expect(mixed).toBe('intro\nOLD-LINE\nbetween\nNEW-LINE\nafter-ins\nL1\nL2\nend');
  });
});

describe('mergeResolver helpers', () => {
  /**
   * Confirms the unresolved-id list drives the save button enabled state.
   * Order is preserved so the navigation pane can jump to the next pending hunk.
   */
  it('returns ordered ids for blocks lacking a selection', () => {
    const blocks: ChangeBlock[] = [
      { id: 1, firstRowIdx: 0, lastRowIdx: 0 },
      { id: 2, firstRowIdx: 1, lastRowIdx: 1 },
      { id: 3, firstRowIdx: 2, lastRowIdx: 2 },
    ];

    expect(getUnresolvedBlockIds(blocks, {})).toEqual([1, 2, 3]);
    expect(getUnresolvedBlockIds(blocks, { 1: 'left', 3: 'right' })).toEqual([2]);
    expect(getUnresolvedBlockIds(blocks, { 1: 'left', 2: null, 3: 'right' })).toEqual([2]);
    expect(getUnresolvedBlockIds(blocks, { 1: 'left', 2: 'right', 3: 'left' })).toEqual([]);
  });

  /**
   * The accept-all / reject-all toolbar uses {@link resolveAllBlocksToSide} to
   * generate a fresh selection map. The contract is: every block id is present,
   * and every value matches the requested side. Mutating an existing object is
   * never safe because React state must be replaced atomically.
   */
  it('returns a complete selection map with the requested side for every block', () => {
    const blocks: ChangeBlock[] = [
      { id: 7, firstRowIdx: 0, lastRowIdx: 1 },
      { id: 9, firstRowIdx: 5, lastRowIdx: 6 },
    ];

    const left = resolveAllBlocksToSide(blocks, 'left');
    const right = resolveAllBlocksToSide(blocks, 'right');

    expect(left).toEqual({ 7: 'left', 9: 'left' });
    expect(right).toEqual({ 7: 'right', 9: 'right' });
    // Both calls must return new objects so React detects the change.
    expect(left).not.toBe(right);
  });
});
