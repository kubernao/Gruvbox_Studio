export type AiChangedSection = {
  id: string;
  currentStartLine: number;
  currentEndLine: number;
  baselineStartLine: number;
  baselineEndLine: number;
};

type ExtractedAiDiffData = {
  lines: number[];
  sections: AiChangedSection[];
};

function extractAiDiffDataFromUnifiedDiff(diffText: string): ExtractedAiDiffData {
  const lines: number[] = [];
  const sections: AiChangedSection[] = [];
  let leftLineNo = 0;
  let rightLineNo = 0;
  let inHunk = false;
  let sectionIndex = 0;
  let sectionRightStart: number | null = null;
  let sectionRightEnd = 0;
  let sectionLeftStart: number | null = null;
  let sectionLeftEnd = 0;

  const flushSection = () => {
    if (sectionRightStart === null || sectionLeftStart === null) {
      sectionRightStart = null;
      sectionRightEnd = 0;
      sectionLeftStart = null;
      sectionLeftEnd = 0;
      return;
    }
    sections.push({
      id: `ai-section-${sectionIndex++}`,
      currentStartLine: sectionRightStart,
      currentEndLine: sectionRightEnd,
      baselineStartLine: sectionLeftStart,
      baselineEndLine: sectionLeftEnd,
    });
    sectionRightStart = null;
    sectionRightEnd = 0;
    sectionLeftStart = null;
    sectionLeftEnd = 0;
  };

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flushSection();
      inHunk = false;
      continue;
    }

    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('Binary files') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode')
    ) {
      continue;
    }

    if (line.startsWith('@@ ')) {
      flushSection();
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m !== null) {
        leftLineNo = parseInt(m[1], 10) - 1;
        rightLineNo = parseInt(m[2], 10) - 1;
        inHunk = true;
      }
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith(' ')) {
      flushSection();
      leftLineNo++;
      rightLineNo++;
    } else if (line.startsWith('-')) {
      const nextLeftLine = leftLineNo + 1;
      if (sectionLeftStart === null) {
        sectionLeftStart = nextLeftLine;
      }
      leftLineNo++;
      sectionLeftEnd = leftLineNo;
      if (sectionRightStart === null) {
        sectionRightStart = rightLineNo + 1;
        sectionRightEnd = rightLineNo;
      }
    } else if (line.startsWith('+')) {
      const nextRightLine = rightLineNo + 1;
      if (sectionRightStart === null) {
        sectionRightStart = nextRightLine;
      }
      if (sectionLeftStart === null) {
        sectionLeftStart = leftLineNo + 1;
        sectionLeftEnd = leftLineNo;
      }
      rightLineNo++;
      lines.push(rightLineNo);
      sectionRightEnd = rightLineNo;
    }
  }

  flushSection();
  return { lines, sections };
}

/**
 * Collects 1-based line numbers on the "new" (right) side of a unified diff —
 * i.e. lines introduced by `+` hunks. Intended for `git diff oldRev newRev`
 * where the editor shows `newRev` and we highlight AI-touched lines.
 */
export function extractAiChangedLinesFromUnifiedDiff(diffText: string): number[] {
  return extractAiDiffDataFromUnifiedDiff(diffText).lines;
}

/**
 * Collects section metadata for AI-changed areas in the "new" (right) side.
 * Each section preserves both current-document line range and baseline range.
 */
export function extractAiChangedSectionsFromUnifiedDiff(diffText: string): AiChangedSection[] {
  return extractAiDiffDataFromUnifiedDiff(diffText).sections;
}
