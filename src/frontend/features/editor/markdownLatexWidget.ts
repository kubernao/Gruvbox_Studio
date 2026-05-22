import type { Range, Text } from '@codemirror/state';
import { linesSpannedBySelection } from './markdownSelectionLines';
import { Decoration, DecorationSet, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import katex from 'katex';

interface LatexBlock {
  from: number;
  to: number;
  fromLine: number;
  toLine: number;
  code: string;
}

function parseLatexBlocks(doc: Text): LatexBlock[] {
  const blocks: LatexBlock[] = [];
  let lineNumber = 1;

  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber);
    const openMatch = line.text.match(/^```(latex|tex|katex)(?:\s+.*)?$/i);
    if (!openMatch) {
      lineNumber += 1;
      continue;
    }

    const startLineNumber = lineNumber;
    const codeLines: string[] = [];
    let endLineNumber = lineNumber;
    let foundClose = false;
    let scanLine = lineNumber + 1;
    while (scanLine <= doc.lines) {
      const candidate = doc.line(scanLine);
      if (/^```$/.test(candidate.text.trim())) {
        endLineNumber = scanLine;
        foundClose = true;
        break;
      }
      codeLines.push(candidate.text);
      scanLine += 1;
    }

    if (!foundClose) {
      lineNumber += 1;
      continue;
    }

    const startLine = doc.line(startLineNumber);
    const endLine = doc.line(endLineNumber);
    blocks.push({
      from: startLine.from,
      to: endLine.to,
      fromLine: startLineNumber,
      toLine: endLineNumber,
      code: codeLines.join('\n').trim(),
    });
    lineNumber = endLineNumber + 1;
  }

  return blocks;
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const x of a) {
    if (!b.has(x)) {
      return false;
    }
  }
  return true;
}

function computeActiveBlockIndices(blocks: LatexBlock[], activeLines: Set<number>): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    for (let line = block.fromLine; line <= block.toLine; line += 1) {
      if (activeLines.has(line)) {
        s.add(i);
        break;
      }
    }
  }
  return s;
}

function computeViewportBlockIndices(blocks: LatexBlock[], view: EditorView): Set<number> {
  const { from, to } = view.viewport;
  const s = new Set<number>();
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.from < to && block.to > from) {
      s.add(i);
    }
  }
  return s;
}

/** CodeMirror forbids `coordsAtPos` during plugin `update`; restore scroll after layout instead. */
function scheduleRestoreScrollTop(view: EditorView, scrollTop: number): void {
  queueMicrotask(() => {
    view.scrollDOM.scrollTop = scrollTop;
  });
}

class LatexWidget extends WidgetType {
  constructor(private readonly code: string) {
    super();
  }

  toDOM(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'cm-latex-widget';
    if (!this.code) {
      root.textContent = 'Empty expression';
      return root;
    }
    try {
      root.innerHTML = katex.renderToString(this.code, {
        throwOnError: false,
        displayMode: true,
        output: 'html',
      });
    } catch (error) {
      const fallback = document.createElement('pre');
      fallback.className = 'cm-latex-widget-error';
      fallback.textContent = `LaTeX render error: ${error instanceof Error ? error.message : String(error)}`;
      root.appendChild(fallback);
    }
    return root;
  }

  eq(other: LatexWidget): boolean {
    return this.code === other.code;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class LatexWidgetPlugin {
  decorations: DecorationSet;
  private lastActiveBlockIndices: Set<number>;
  private lastViewportBlockIndices: Set<number>;

  constructor(private readonly view: EditorView) {
    const doc = this.view.state.doc;
    const blocks = parseLatexBlocks(doc);
    this.lastActiveBlockIndices = computeActiveBlockIndices(blocks, linesSpannedBySelection(this.view.state));
    this.lastViewportBlockIndices = computeViewportBlockIndices(blocks, this.view);
    this.decorations = this.buildDecorations();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      const blocksBefore = parseLatexBlocks(update.startState.doc);
      const blocksAfter = parseLatexBlocks(update.state.doc);
      const prevActive = computeActiveBlockIndices(blocksBefore, linesSpannedBySelection(update.startState));
      const nextActive = computeActiveBlockIndices(blocksAfter, linesSpannedBySelection(update.state));
      const activeChanged = !setsEqual(prevActive, nextActive);
      const scrollTopToRestore = activeChanged ? this.view.scrollDOM.scrollTop : null;

      this.lastActiveBlockIndices = nextActive;
      this.lastViewportBlockIndices = computeViewportBlockIndices(blocksAfter, this.view);
      this.decorations = this.buildDecorations();

      if (scrollTopToRestore !== null) {
        scheduleRestoreScrollTop(this.view, scrollTopToRestore);
      }
      return;
    }

    if (update.selectionSet) {
      const blocks = parseLatexBlocks(this.view.state.doc);
      const nextActive = computeActiveBlockIndices(blocks, linesSpannedBySelection(this.view.state));
      if (setsEqual(this.lastActiveBlockIndices, nextActive)) {
        return;
      }
      const scrollTopToRestore = this.view.scrollDOM.scrollTop;

      this.lastActiveBlockIndices = nextActive;
      this.lastViewportBlockIndices = computeViewportBlockIndices(blocks, this.view);
      this.decorations = this.buildDecorations();

      scheduleRestoreScrollTop(this.view, scrollTopToRestore);
      return;
    }

    if (update.viewportChanged) {
      const blocks = parseLatexBlocks(this.view.state.doc);
      const nextViewport = computeViewportBlockIndices(blocks, this.view);
      if (setsEqual(this.lastViewportBlockIndices, nextViewport)) {
        return;
      }
      this.lastViewportBlockIndices = nextViewport;
      this.decorations = this.buildDecorations();
    }
  }

  private buildDecorations(): DecorationSet {
    const blocks = parseLatexBlocks(this.view.state.doc);
    const activeLines = linesSpannedBySelection(this.view.state);
    const ranges: Range<Decoration>[] = [];

    for (const block of blocks) {
      let isActive = false;
      for (let line = block.fromLine; line <= block.toLine; line += 1) {
        if (activeLines.has(line)) {
          isActive = true;
          break;
        }
      }
      if (isActive) continue;

      const firstLine = this.view.state.doc.line(block.fromLine);
      ranges.push(
        Decoration.replace({
          widget: new LatexWidget(block.code),
        }).range(firstLine.from, firstLine.to)
      );

      for (let line = block.fromLine + 1; line <= block.toLine; line += 1) {
        const lineObj = this.view.state.doc.line(line);
        ranges.push(Decoration.replace({}).range(lineObj.from, lineObj.to));
        ranges.push(Decoration.line({ class: 'cm-latex-hidden-line' }).range(lineObj.from));
      }
    }

    return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none;
  }
}

export const markdownLatexWidget = ViewPlugin.fromClass(LatexWidgetPlugin, {
  decorations: (plugin) => plugin.decorations,
});
