import type { MonacoDiffLineChange } from './monacoDiffMeldRibbon';

export type TripleVariant = 'left' | 'right';

export interface TripleDiffHunk {
  /**
   * Stable identifier for a logical hunk derived from modified (result) range.
   * This remains deterministic across recomputes for unchanged ranges.
   */
  id: string;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
  leftChange: MonacoDiffLineChange | null;
  rightChange: MonacoDiffLineChange | null;
  baseChange: MonacoDiffLineChange | null;
}

export interface TripleDiffState {
  hunks: TripleDiffHunk[];
}

/**
 * Build a deterministic hunk-state snapshot for 3-pane merge mode from the two
 * hidden Monaco diff streams: variant->result and base->result.
 */
export function buildTripleDiffState(
  leftChanges: MonacoDiffLineChange[],
  rightChanges: MonacoDiffLineChange[],
  baseChanges: MonacoDiffLineChange[],
): TripleDiffState {
  const normalizedBase = [...baseChanges].sort(sortByModifiedStart);
  const allEntries = [
    ...leftChanges.map((change) => ({ side: 'left' as const, change })),
    ...rightChanges.map((change) => ({ side: 'right' as const, change })),
  ].sort((a, b) => sortByModifiedStart(a.change, b.change));
  const logicalRanges = mergeLogicalRanges(allEntries.map((entry) => toRange(entry.change)));
  const hunks = logicalRanges.map((logicalRange) => {
    const leftChange = findBestSideMatch(leftChanges, logicalRange);
    const rightChange = findBestSideMatch(rightChanges, logicalRange);
    const baseProbe = leftChange ?? rightChange;
    const baseChange = baseProbe ? findBestBaseMatch(baseProbe, normalizedBase) : null;
    return {
      id: `hunk:${logicalRange.start}-${logicalRange.end}`,
      modifiedStartLineNumber: logicalRange.start,
      modifiedEndLineNumber: logicalRange.end,
      leftChange,
      rightChange,
      baseChange,
    };
  });

  return { hunks };
}

/**
 * Given the current cursor line in the result editor, return the active hunk index.
 */
export function resolveActiveHunkIndex(hunks: TripleDiffHunk[], lineNumber: number): number {
  if (!hunks.length) {
    return -1;
  }
  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];
    if (lineNumber >= hunk.modifiedStartLineNumber && lineNumber <= hunk.modifiedEndLineNumber) {
      return i;
    }
  }
  let nearest = 0;
  for (let i = 0; i < hunks.length; i++) {
    if (hunks[i].modifiedStartLineNumber <= lineNumber) {
      nearest = i;
    }
  }
  return nearest;
}

function findBestBaseMatch(
  variant: MonacoDiffLineChange,
  baseChanges: MonacoDiffLineChange[],
): MonacoDiffLineChange | null {
  let best: MonacoDiffLineChange | null = null;
  let bestScore = -1;
  const variantStart = normalizeStart(variant.modifiedStartLineNumber);
  const variantEnd = normalizeEnd(variant.modifiedEndLineNumber, variantStart);
  for (const candidate of baseChanges) {
    const candidateStart = normalizeStart(candidate.modifiedStartLineNumber);
    const candidateEnd = normalizeEnd(candidate.modifiedEndLineNumber, candidateStart);
    const overlap = Math.max(0, Math.min(variantEnd, candidateEnd) - Math.max(variantStart, candidateStart) + 1);
    if (overlap <= 0) {
      continue;
    }
    const spanDistance = Math.abs(variantStart - candidateStart) + Math.abs(variantEnd - candidateEnd);
    const score = overlap * 10 - spanDistance;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function findBestSideMatch(
  changes: MonacoDiffLineChange[],
  target: { start: number; end: number },
): MonacoDiffLineChange | null {
  let best: MonacoDiffLineChange | null = null;
  let bestScore = -1;
  for (const candidate of changes) {
    const candidateRange = toRange(candidate);
    const overlap = computeOverlap(candidateRange, target);
    if (overlap <= 0) {
      continue;
    }
    const distance =
      Math.abs(candidateRange.start - target.start) + Math.abs(candidateRange.end - target.end);
    const score = overlap * 10 - distance;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function mergeLogicalRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (!ranges.length) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev || range.start > prev.end + 1) {
      merged.push({ ...range });
      continue;
    }
    prev.end = Math.max(prev.end, range.end);
  }
  return merged;
}

function sortByModifiedStart(a: MonacoDiffLineChange, b: MonacoDiffLineChange): number {
  return normalizeStart(a.modifiedStartLineNumber) - normalizeStart(b.modifiedStartLineNumber);
}

function toRange(change: MonacoDiffLineChange): { start: number; end: number } {
  const start = normalizeStart(change.modifiedStartLineNumber);
  const end = normalizeEnd(change.modifiedEndLineNumber, start);
  return { start, end };
}

function computeOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start) + 1);
}

function normalizeStart(start: number): number {
  return Math.max(1, start || 1);
}

function normalizeEnd(end: number, start: number): number {
  return Math.max(start, end || start);
}
