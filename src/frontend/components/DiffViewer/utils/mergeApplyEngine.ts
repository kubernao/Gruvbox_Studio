import DiffMatchPatch from 'diff-match-patch';
import type { MonacoDiffLineChange } from './monacoDiffMeldRibbon';
import { buildReplacementTextFromChange } from './monacoEditRange';

export interface MergeApplyEngineArgs {
  resultText: string;
  sourceText: string;
  change: MonacoDiffLineChange;
}

export interface MergeApplyEngineResult {
  ok: boolean;
  nextText: string;
  operation: 'insert' | 'delete' | 'replace';
  reason?: string;
}

export interface DeterministicMergeHunk {
  id: string;
  startLineNumber: number;
  endLineNumber: number;
}

interface DeterministicChoice {
  replacementLines: string[];
}

interface NormalizedLineWindow {
  startIndex: number;
  endExclusive: number;
  operation: 'insert' | 'delete' | 'replace';
}

const dmp = new DiffMatchPatch();

/**
 * This helper applies a single merge hunk by rebuilding plain text from line-aware
 * patch operations instead of letting Monaco range edits mutate neighboring lines.
 * It keeps behavior deterministic by validating that the line directly above the
 * targeted hunk is preserved and by refusing writes when patch application cannot
 * be verified from the current buffer snapshot.
 */
export function applyMergeHunkPatch(args: MergeApplyEngineArgs): MergeApplyEngineResult {
  const { resultText, sourceText, change } = args;
  const hasTrailingNewline = resultText.endsWith('\n');
  const resultLines = toLines(resultText);
  const incomingLines = toLines(sourceText);
  const window = normalizeLineWindow(resultLines.length, change);
  const anchorLineBefore = window.startIndex > 0 ? resultLines[window.startIndex - 1] : null;
  const currentSlice = resultLines.slice(window.startIndex, window.endExclusive).join('\n');
  const replacementSlice = incomingLines.join('\n');

  const patchedSlice = applyPatchSlice(currentSlice, replacementSlice);
  if (patchedSlice === null) {
    return {
      ok: false,
      nextText: resultText,
      operation: window.operation,
      reason: 'Unable to apply patch for selected hunk.',
    };
  }

  const replacementFromPatch = patchedSlice === '' ? [] : patchedSlice.split('\n');
  const nextLines = [
    ...resultLines.slice(0, window.startIndex),
    ...replacementFromPatch,
    ...resultLines.slice(window.endExclusive),
  ];

  if (!preservesLineAbove(anchorLineBefore, nextLines, window.startIndex)) {
    return {
      ok: false,
      nextText: resultText,
      operation: window.operation,
      reason: 'Refused apply because the line above the hunk changed unexpectedly.',
    };
  }

  return {
    ok: true,
    nextText: fromLines(nextLines, hasTrailingNewline),
    operation: window.operation,
  };
}

/**
 * This helper composes a merge-apply request directly from Monaco models so each
 * caller can remain focused on user intent while this module owns line surgery.
 * It ensures source extraction always follows the same range semantics used in
 * diff visualization, eliminating duplicate conversion logic in UI components.
 */
export function applyMergeHunkFromModels(args: {
  resultModel: { getValue: () => string };
  sourceModel: { getLinesContent: () => string[] };
  change: MonacoDiffLineChange;
}): MergeApplyEngineResult {
  const { resultModel, sourceModel, change } = args;
  const sourceText = buildReplacementTextFromChange(sourceModel as any, change);
  return applyMergeHunkPatch({
    resultText: resultModel.getValue(),
    sourceText,
    change,
  });
}

/**
 * This class provides a deterministic, state-based merge reducer that never
 * applies incremental editor range edits. Each click updates one hunk choice
 * and materializes the full result from the immutable baseline plus all current
 * choices, which removes cumulative range drift across repeated actions.
 */
export class DeterministicMergeSession {
  private readonly baselineLines: string[];
  private readonly hunkOrder: DeterministicMergeHunk[];
  private readonly hunkById: Map<string, DeterministicMergeHunk>;
  private readonly choices: Map<string, DeterministicChoice>;
  private readonly hadTrailingNewline: boolean;

  /**
   * This constructor freezes baseline text and canonical hunk order so every
   * materialization is deterministic regardless of previous apply sequence.
   */
  public constructor(args: { baselineText: string; hunks: DeterministicMergeHunk[] }) {
    this.hadTrailingNewline = args.baselineText.endsWith('\n');
    this.baselineLines = toLines(args.baselineText);
    this.hunkOrder = [...args.hunks].sort((a, b) => {
      if (a.startLineNumber !== b.startLineNumber) {
        return a.startLineNumber - b.startLineNumber;
      }
      return a.endLineNumber - b.endLineNumber;
    });
    this.hunkById = new Map(this.hunkOrder.map((hunk) => [hunk.id, hunk]));
    this.choices = new Map();
  }

  /**
   * This method updates one hunk choice and emits the full recomputed result.
   * Passing an empty replacement array represents deleting the hunk content.
   */
  public applyChoice(hunkId: string, replacementText: string): { ok: boolean; nextText: string; reason?: string } {
    if (!this.hunkById.has(hunkId)) {
      return { ok: false, nextText: this.materialize(), reason: 'Unknown hunk id.' };
    }
    this.choices.set(hunkId, { replacementLines: toLines(replacementText) });
    return { ok: true, nextText: this.materialize() };
  }

  /**
   * This method clears one hunk choice and recomputes output from baseline.
   */
  public clearChoice(hunkId: string): { ok: boolean; nextText: string; reason?: string } {
    if (!this.hunkById.has(hunkId)) {
      return { ok: false, nextText: this.materialize(), reason: 'Unknown hunk id.' };
    }
    this.choices.delete(hunkId);
    return { ok: true, nextText: this.materialize() };
  }

  /**
   * This method materializes the merged text from immutable baseline plus all
   * selected hunk replacements, which guarantees deterministic replay.
   */
  public materialize(): string {
    const out: string[] = [];
    let cursorLine = 1;
    for (const hunk of this.hunkOrder) {
      const start = Math.max(0, hunk.startLineNumber);
      const end = hunk.endLineNumber;
      if (end <= 0) {
        const emitUntil = Math.min(this.baselineLines.length, start);
        while (cursorLine <= emitUntil) {
          out.push(this.baselineLines[cursorLine - 1]);
          cursorLine += 1;
        }
        const choice = this.choices.get(hunk.id);
        if (choice) {
          out.push(...choice.replacementLines);
        }
        continue;
      }

      const safeStart = Math.max(1, start);
      const safeEnd = Math.max(safeStart, end);
      while (cursorLine < safeStart && cursorLine <= this.baselineLines.length) {
        out.push(this.baselineLines[cursorLine - 1]);
        cursorLine += 1;
      }
      const choice = this.choices.get(hunk.id);
      if (choice) {
        out.push(...choice.replacementLines);
      } else {
        for (let line = safeStart; line <= safeEnd && line <= this.baselineLines.length; line += 1) {
          out.push(this.baselineLines[line - 1]);
        }
      }
      cursorLine = safeEnd + 1;
    }
    while (cursorLine <= this.baselineLines.length) {
      out.push(this.baselineLines[cursorLine - 1]);
      cursorLine += 1;
    }
    return fromLines(out, this.hadTrailingNewline);
  }
}

/**
 * This helper converts Monaco line-number change metadata into a clamped zero-based
 * replace window for plain-text operations. The output always forms a valid splice
 * window even when Monaco emits insertion/deletion sentinels at file boundaries.
 */
function normalizeLineWindow(lineCount: number, change: MonacoDiffLineChange): NormalizedLineWindow {
  const startLine = Math.max(1, change.modifiedStartLineNumber || 1);
  if (change.modifiedEndLineNumber <= 0) {
    const insertionIndex = clamp(startLine - 1, 0, lineCount);
    return {
      startIndex: insertionIndex,
      endExclusive: insertionIndex,
      operation: change.originalEndLineNumber <= 0 ? 'replace' : 'insert',
    };
  }
  const startIndex = clamp(startLine - 1, 0, lineCount);
  const endExclusive = clamp(change.modifiedEndLineNumber, startIndex, lineCount);
  return {
    startIndex,
    endExclusive,
    operation: change.originalEndLineNumber <= 0 ? 'delete' : 'replace',
  };
}

/**
 * This helper applies a patch to a local slice and returns null when any patch
 * fragment fails. Even though this is a localized operation, using patch apply
 * guarantees a consistent text transform primitive shared by all merge callers.
 */
function applyPatchSlice(currentSlice: string, replacementSlice: string): string | null {
  const patches = dmp.patch_make(currentSlice, replacementSlice);
  const [next, outcomes] = dmp.patch_apply(patches, currentSlice) as [string, boolean[]];
  if (outcomes.some((ok) => !ok)) {
    return null;
  }
  return next;
}

/**
 * This helper preserves line-array semantics for empty buffers and avoids injecting
 * phantom blank lines, which is required for deterministic merge output rendering.
 */
function toLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * This helper rebuilds a text buffer from normalized lines while preserving the
 * original trailing-newline contract from the editable merge result document.
 */
function fromLines(lines: string[], hadTrailingNewline: boolean): string {
  const base = lines.join('\n');
  if (!hadTrailingNewline) {
    return base;
  }
  if (base.length === 0) {
    return '\n';
  }
  return `${base}\n`;
}

/**
 * This helper verifies the invariant that merge apply must not rewrite the line
 * immediately above the targeted hunk, which is the regression this rework fixes.
 */
function preservesLineAbove(
  expectedAnchor: string | null,
  nextLines: string[],
  targetStartIndex: number,
): boolean {
  if (expectedAnchor === null) {
    return true;
  }
  if (targetStartIndex <= 0) {
    return true;
  }
  return nextLines[targetStartIndex - 1] === expectedAnchor;
}

/**
 * This helper keeps index arithmetic readable by centralizing inclusive clamp
 * behavior for file-boundary and stale-diff edge cases.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
