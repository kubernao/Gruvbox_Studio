import * as monaco from 'monaco-editor';
import type { MonacoDiffLineChange } from './monacoDiffMeldRibbon';

/**
 * This helper builds safe edit ranges for Monaco apply-actions so insert, replace,
 * and delete operations always produce a valid range. It normalizes zero-length
 * modified ranges into insertion points and clamps all line references to the
 * target model's current line bounds.
 */
export function buildSafeRangeFromChange(
  targetModel: monaco.editor.ITextModel,
  change: MonacoDiffLineChange,
): monaco.Range {
  const startLine = Math.max(1, change.modifiedStartLineNumber || 1);
  const endLine = change.modifiedEndLineNumber;
  if (endLine <= 0) {
    return new monaco.Range(startLine, 1, startLine, 1);
  }
  const safeEndLine = Math.min(Math.max(startLine, endLine), targetModel.getLineCount());
  return new monaco.Range(startLine, 1, safeEndLine, targetModel.getLineMaxColumn(safeEndLine));
}

/**
 * This helper extracts replacement text from the source side of a diff change.
 * It treats zero-length original ranges as deletions and otherwise returns an
 * exact line slice suitable for direct Monaco executeEdits replacement.
 */
export function buildReplacementTextFromChange(
  sourceModel: monaco.editor.ITextModel,
  change: MonacoDiffLineChange,
): string {
  if (change.originalEndLineNumber === 0) {
    return '';
  }
  const originalStart = Math.max(1, change.originalStartLineNumber);
  const originalEnd = Math.max(originalStart, change.originalEndLineNumber);
  return sourceModel.getLinesContent().slice(originalStart - 1, originalEnd).join('\n');
}

