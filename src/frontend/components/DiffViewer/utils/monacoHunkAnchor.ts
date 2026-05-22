import type * as monaco from 'monaco-editor';

/**
 * Vertical center of a line in editor coordinates, relative to hostEl's top (for overlay controls).
 * Uses getScrolledVisiblePosition when possible; falls back to getTopForLineNumber so off-viewport
 * lines still get a position after layout (fixes missing controls until first scroll).
 */
export function lineAnchorYRelativeToHost(
  editor: monaco.editor.ICodeEditor,
  hostEl: HTMLElement,
  lineNumber: number,
): number | null {
  const dom = editor.getDomNode();
  if (!dom) {
    return null;
  }
  const hostRect = hostEl.getBoundingClientRect();
  const edRect = dom.getBoundingClientRect();
  const scrolled = editor.getScrolledVisiblePosition({ lineNumber: lineNumber, column: 1 });
  if (scrolled) {
    return edRect.top + scrolled.top + Math.max(8, scrolled.height / 2) - hostRect.top;
  }
  const lineTop = editor.getTopForLineNumber(lineNumber);
  const scrollTop = editor.getScrollTop();
  const lineHeight = editor.getLineHeightForPosition({ lineNumber: lineNumber, column: 1 });
  const yInViewport = lineTop - scrollTop + lineHeight / 2;
  if (!Number.isFinite(yInViewport)) {
    return null;
  }
  return edRect.top + yInViewport - hostRect.top;
}
