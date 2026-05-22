/**
 * Merge Result Builder
 * ====================
 *
 * Assembles the final merged file content once the user has resolved every change
 * block in the diff viewer.
 *
 * ### How the merge output is constructed
 *
 * The diff row array is iterated in order.  For each row:
 *
 *   - **`'context'`** rows appear unchanged in both files, so they are emitted as-is
 *     using `leftText` (which equals `rightText` for context lines).
 *
 *   - **`'separator'`** rows mark file boundaries in multi-file diffs and are skipped —
 *     they produce no output in the merged file.
 *
 *   - **Change block rows** (`'del'`, `'ins'`, `'change'`) are processed once per block
 *     (subsequent rows with the same `changeBlockId` are skipped after the first).  The
 *     selected side determines which text lines are emitted:
 *       - `selection === 'left'`  → emit all non-null `leftText` values in the block.
 *       - `selection === 'right'` → emit all non-null `rightText` values in the block.
 *
 * The resulting lines array is joined with `'\n'` to produce the final file content.
 *
 * ### Execution environment
 *
 * The preferred path delegates to the `rust:buildMergeResult` IPC handler, which is
 * faster and produces identical output.  The pure-TS `buildMergeResultSync` runs as
 * a fallback when the Electron bridge is unavailable (tests, Storybook).
 */

import { DiffRow, ChangeBlock } from '../types';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/**
 * Returns the Electron IPC `invoke` function if running inside a renderer process,
 * or `undefined` in non-Electron environments (Vitest, Node scripts, Storybook).
 */
function getInvoke():
  | ((channel: string, ...args: unknown[]) => Promise<unknown>)
  | undefined {
  if (typeof window === 'undefined') return undefined;
  const invoke = window.electronAPI?.invoke;
  return typeof invoke === 'function' ? invoke : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the merged file content from the resolved diff state.
 *
 * Delegates to `rust:buildMergeResult` via IPC when available; falls back to
 * {@link buildMergeResultSync} otherwise.  Both paths produce identical output.
 *
 * @param diffRows         - The full aligned row array from the current diff session.
 * @param changeSelections - Map of blockId → 'left' | 'right' | null.
 *                           Every block must be resolved (non-null) before calling this.
 * @param changeBlocks     - Index of change blocks (needed to look up block row ranges).
 * @throws {Error} If any change block is unresolved (only in the TS fallback path).
 */
export async function buildMergeResult(
  diffRows: DiffRow[],
  changeSelections: Record<number, 'left' | 'right' | null>,
  changeBlocks: ChangeBlock[],
): Promise<string> {
  const invoke = getInvoke();
  if (invoke) {
    return (await invoke('rust:buildMergeResult', {
      diffRows,
      changeSelections,
      changeBlocks,
    })) as string;
  }
  return buildMergeResultSync(diffRows, changeSelections, changeBlocks);
}

/**
 * Returns an array of `changeBlockId` values for every block that has not yet been
 * resolved (i.e. `changeSelections[id]` is null or missing).
 *
 * Used by the save flow to gate the save button and display an unresolved-count badge.
 *
 * @param changeBlocks     - All change blocks in the diff session.
 * @param changeSelections - Current selection state.
 */
export function getUnresolvedBlockIds(
  changeBlocks: ChangeBlock[],
  changeSelections: Record<number, 'left' | 'right' | null>,
): number[] {
  return changeBlocks
    .filter((b) => (changeSelections[b.id] ?? null) === null)
    .map((b) => b.id);
}

/**
 * Produces a `changeSelections` map with every block set to the same `side`.
 * Used by the "Accept all" / "Reject all" toolbar actions.
 *
 * @param changeBlocks - All change blocks to resolve.
 * @param side         - The side to assign to every block.
 */
export function resolveAllBlocksToSide(
  changeBlocks: ChangeBlock[],
  side: 'left' | 'right',
): Record<number, 'left' | 'right'> {
  const result: Record<number, 'left' | 'right'> = {};
  for (const block of changeBlocks) {
    result[block.id] = side;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pure-TS fallback implementation
// ---------------------------------------------------------------------------

/**
 * Synchronous merge result builder used when the Rust IPC bridge is unavailable.
 *
 * ### Iteration strategy
 *
 * The function makes a single pass over `diffRows`.  A `processedBlockIds` set
 * prevents a block's lines from being emitted more than once — the set is checked
 * at the first row that belongs to a new block, and the entire block is consumed
 * from `diffRows` using a slice before moving on.
 *
 * Context rows are emitted immediately; separator rows (multi-file diffs) are skipped
 * because they do not correspond to any content in the output file.
 *
 * @throws {Error} If any change block has no selection yet (`null`).
 */
function buildMergeResultSync(
  diffRows: DiffRow[],
  changeSelections: Record<number, 'left' | 'right' | null>,
  changeBlocks: ChangeBlock[],
): string {
  // Guard: every block must be resolved before we can build a valid merged file
  const unresolved = changeBlocks.filter((b) => (changeSelections[b.id] ?? null) === null);
  if (unresolved.length > 0) {
    throw new Error(`Cannot save: ${unresolved.length} unresolved change blocks`);
  }

  // Build a lookup map so we can find a block's row range in O(1) by its ID
  const blockById = new Map<number, ChangeBlock>();
  for (const b of changeBlocks) {
    blockById.set(b.id, b);
  }

  const lines: string[] = [];
  // Tracks which blocks have already been emitted to avoid duplicate output
  const processedBlockIds = new Set<number>();

  for (const row of diffRows) {
    // Multi-file separator — no content in the output
    if (row.type === 'separator') continue;

    // Context line — identical on both sides, emit once
    if (row.type === 'context') {
      lines.push(row.leftText ?? row.rightText ?? '');
      continue;
    }

    // Change row with no block ID — shouldn't happen in well-formed data, but skip safely
    if (row.changeBlockId === null) continue;

    // Skip rows that belong to a block we've already processed
    if (processedBlockIds.has(row.changeBlockId)) continue;
    processedBlockIds.add(row.changeBlockId);

    const block = blockById.get(row.changeBlockId);
    if (block === undefined) continue; // defensive: block not in index

    // Emit all lines from the chosen side of this block.
    // Rows where the chosen side has null text (e.g. the left side of a pure-ins row)
    // are skipped — they contribute no content to the output file.
    const selection  = changeSelections[row.changeBlockId] ?? 'right';
    const blockRows  = diffRows.slice(block.firstRowIdx, block.lastRowIdx + 1);

    if (selection === 'left') {
      for (const br of blockRows) {
        if (br.leftText !== null) lines.push(br.leftText);
      }
    } else {
      for (const br of blockRows) {
        if (br.rightText !== null) lines.push(br.rightText);
      }
    }
  }

  return lines.join('\n');
}
