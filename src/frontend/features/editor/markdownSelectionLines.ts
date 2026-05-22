import type { EditorState } from '@codemirror/state';

/** Every 1-based line number touched by any selection range (from anchor through head). */
export function linesSpannedBySelection(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let n = fromLine; n <= toLine; n += 1) {
      lines.add(n);
    }
  }
  return lines;
}
