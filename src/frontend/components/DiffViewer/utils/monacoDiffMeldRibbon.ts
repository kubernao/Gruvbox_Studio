import type * as monaco from 'monaco-editor';

/** Shape returned by `IStandaloneDiffEditor.getLineChanges()` in Monaco 0.55. */
export interface MonacoDiffLineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

export type RibbonKind = 'del' | 'ins' | 'change';

/** Maps a Monaco line change to custom diff ribbon semantics (see DiffViewer.css `.diff-ribbon-*`). */
export function ribbonKindFromLineChange(c: MonacoDiffLineChange): RibbonKind {
  if (c.modifiedEndLineNumber === 0) {
    return 'del';
  }
  if (c.originalEndLineNumber === 0) {
    return 'ins';
  }
  return 'change';
}

function anchorLineForOriginal(c: MonacoDiffLineChange): number {
  if (c.originalEndLineNumber === 0) {
    return Math.max(1, c.originalStartLineNumber);
  }
  return Math.floor((c.originalStartLineNumber + c.originalEndLineNumber) / 2);
}

function anchorLineForModified(c: MonacoDiffLineChange): number {
  if (c.modifiedEndLineNumber === 0) {
    return Math.max(1, c.modifiedStartLineNumber);
  }
  return Math.floor((c.modifiedStartLineNumber + c.modifiedEndLineNumber) / 2);
}

/**
 * Maps a line in the editor to overlay-local (x, y) for ribbon endpoints.
 * Returns null when the line is not in the scrolled viewport.
 */
function anchorInOverlay(
  editor: monaco.editor.ICodeEditor,
  lineNumber: number,
  overlayRect: DOMRect,
  edge: 'left' | 'right',
): { x: number; y: number } | null {
  const dom = editor.getDomNode();
  if (!dom) {
    return null;
  }
  const pos = editor.getScrolledVisiblePosition({ lineNumber, column: 1 });
  if (!pos) {
    return null;
  }
  const er = dom.getBoundingClientRect();
  const y = er.top + pos.top + pos.height / 2 - overlayRect.top;
  const x =
    edge === 'right'
      ? er.right - overlayRect.left - 4
      : er.left - overlayRect.left + 4;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

/**
 * Paints Meld-style Bézier ribbons between paired diff hunks on the original and modified editors.
 */
export function paintMonacoDiffRibbons(args: {
  diff: monaco.editor.IStandaloneDiffEditor;
  overlayHost: HTMLElement;
  svg: SVGSVGElement;
  activeChangeIndex: number;
}): void {
  const { diff, overlayHost, svg, activeChangeIndex } = args;
  const w = Math.max(1, overlayHost.clientWidth);
  const h = Math.max(1, overlayHost.clientHeight);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));

  const changes = diff.getLineChanges() as MonacoDiffLineChange[] | null;
  if (!changes?.length) {
    svg.replaceChildren();
    return;
  }

  const overlayRect = overlayHost.getBoundingClientRect();
  const orig = diff.getOriginalEditor();
  const mod = diff.getModifiedEditor();

  const ns = 'http://www.w3.org/2000/svg';
  const frag = document.createDocumentFragment();

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const lo = anchorLineForOriginal(c);
    const lm = anchorLineForModified(c);
    const a = anchorInOverlay(orig, lo, overlayRect, 'right');
    const b = anchorInOverlay(mod, lm, overlayRect, 'left');
    if (!a || !b) {
      continue;
    }
    const active = i === activeChangeIndex;
    const kind = ribbonKindFromLineChange(c);
    const path = document.createElementNS(ns, 'path');
    const mx = (a.x + b.x) / 2;
    const d = `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
    path.setAttribute('d', d);
    const cls = [
      'diff-ribbon',
      `diff-ribbon-${kind}`,
      ...(active ? ['diff-ribbon-current'] : []),
    ].join(' ');
    path.setAttribute('class', cls);
    frag.appendChild(path);
  }

  svg.replaceChildren(frag);
}
