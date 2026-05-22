import type { MonacoDiffLineChange } from './monacoDiffMeldRibbon';

export interface CanonicalHunk {
  id: string;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
  leftChange: MonacoDiffLineChange | null;
  rightChange: MonacoDiffLineChange | null;
}

/**
 * Builds deterministic hunks keyed by modified/result line ranges from two diff streams.
 */
export function buildCanonicalHunks(
  leftChanges: MonacoDiffLineChange[] | null,
  rightChanges: MonacoDiffLineChange[] | null,
): CanonicalHunk[] {
  const mergedRanges = mergeLogicalRanges([
    ...(leftChanges ?? []).map(toModifiedRange),
    ...(rightChanges ?? []).map(toModifiedRange),
  ]);
  return mergedRanges.map((range) => ({
    id: `hunk:${range.start}:${range.end}`,
    modifiedStartLineNumber: range.start,
    modifiedEndLineNumber: range.end,
    leftChange: findBestSideMatch(leftChanges ?? [], range),
    rightChange: findBestSideMatch(rightChanges ?? [], range),
  }));
}

export function resolveCanonicalHunkIndex(hunks: CanonicalHunk[], lineNumber: number): number {
  if (hunks.length === 0) {
    return -1;
  }
  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index];
    if (lineNumber >= hunk.modifiedStartLineNumber && lineNumber <= hunk.modifiedEndLineNumber) {
      return index;
    }
  }
  let nearest = 0;
  for (let index = 0; index < hunks.length; index += 1) {
    if (hunks[index].modifiedStartLineNumber <= lineNumber) {
      nearest = index;
    }
  }
  return nearest;
}

export function getNextCanonicalHunkIndex(
  currentIndex: number,
  total: number,
  direction: 'next' | 'previous',
  boundaryMode: 'clamp' | 'wrap',
): number {
  if (total === 0) {
    return -1;
  }
  if (direction === 'next') {
    if (currentIndex >= total - 1) {
      return boundaryMode === 'wrap' ? 0 : total - 1;
    }
    return currentIndex + 1;
  }
  if (currentIndex <= 0) {
    return boundaryMode === 'wrap' ? total - 1 : 0;
  }
  return currentIndex - 1;
}

function toModifiedRange(change: MonacoDiffLineChange): { start: number; end: number } {
  const start = Math.max(1, change.modifiedStartLineNumber || 1);
  const end = Math.max(start, change.modifiedEndLineNumber || start);
  return { start, end };
}

function mergeLogicalRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (!ranges.length) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    // Keep adjacent ranges separate; only overlapping ranges are merged.
    // This mirrors triple merge hunk identity and prevents neighboring hunks
    // from collapsing into one actionable block.
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

function findBestSideMatch(
  changes: MonacoDiffLineChange[],
  targetRange: { start: number; end: number },
): MonacoDiffLineChange | null {
  let best: MonacoDiffLineChange | null = null;
  let bestScore = -1;
  for (const change of changes) {
    const range = toModifiedRange(change);
    const overlap = Math.max(
      0,
      Math.min(range.end, targetRange.end) - Math.max(range.start, targetRange.start) + 1,
    );
    if (overlap <= 0) {
      continue;
    }
    const distance =
      Math.abs(range.start - targetRange.start) + Math.abs(range.end - targetRange.end);
    const score = overlap * 10 - distance;
    if (score > bestScore) {
      best = change;
      bestScore = score;
    }
  }
  return best;
}

