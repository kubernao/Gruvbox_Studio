import type { Range, Text } from '@codemirror/state';
import { linesSpannedBySelection } from './markdownSelectionLines';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewPlugin as CMViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import mermaid from 'mermaid';

type MermaidTheme = 'default' | 'dark';

interface MermaidBlock {
  from: number;
  to: number;
  code: string;
  fromLine: number;
  toLine: number;
}

let mermaidInitialized = false;
let currentTheme: MermaidTheme | null = null;

/** Stable ViewPlugin instance per theme (tests use view.plugin(markdownMermaidWidget('dark'))). */
const mermaidViewPluginByTheme = new Map<MermaidTheme, CMViewPlugin<MermaidWidgetPlugin>>();

let nextMermaidRenderId = 0;

const MERMAID_SVG_CACHE_MAX = 32;
const mermaidSvgCacheKeys: string[] = [];
const mermaidSvgCache = new Map<string, string>();

function mermaidSvgCacheGet(key: string): string | undefined {
  const hit = mermaidSvgCache.get(key);
  if (hit === undefined) {
    return undefined;
  }
  mermaidSvgCache.delete(key);
  mermaidSvgCache.set(key, hit);
  const idx = mermaidSvgCacheKeys.indexOf(key);
  if (idx >= 0) {
    mermaidSvgCacheKeys.splice(idx, 1);
    mermaidSvgCacheKeys.push(key);
  }
  return hit;
}

function mermaidSvgCacheSet(key: string, svg: string): void {
  if (mermaidSvgCache.has(key)) {
    const oldIdx = mermaidSvgCacheKeys.indexOf(key);
    if (oldIdx >= 0) {
      mermaidSvgCacheKeys.splice(oldIdx, 1);
    }
  }
  mermaidSvgCache.set(key, svg);
  mermaidSvgCacheKeys.push(key);
  while (mermaidSvgCacheKeys.length > MERMAID_SVG_CACHE_MAX) {
    const oldest = mermaidSvgCacheKeys.shift();
    if (oldest !== undefined) {
      mermaidSvgCache.delete(oldest);
    }
  }
}

function ensureMermaidInitialized(theme: MermaidTheme): void {
  if (!mermaidInitialized || currentTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
    mermaidInitialized = true;
    currentTheme = theme;
  }
}

function parseMermaidBlocks(doc: Text): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  const lineCount = doc.lines;
  let lineNumber = 1;

  while (lineNumber <= lineCount) {
    const line = doc.line(lineNumber);
    const openMatch = line.text.match(/^```mermaid(?:\s+.*)?$/i);
    if (!openMatch) {
      lineNumber += 1;
      continue;
    }

    const startLine = line;
    const codeLines: string[] = [];
    let endLine = startLine;
    let foundClose = false;
    let scanLine = lineNumber + 1;

    while (scanLine <= lineCount) {
      const candidate = doc.line(scanLine);
      if (/^```$/.test(candidate.text.trim())) {
        endLine = candidate;
        foundClose = true;
        break;
      }
      codeLines.push(candidate.text);
      endLine = candidate;
      scanLine += 1;
    }

    if (!foundClose) {
      lineNumber += 1;
      continue;
    }

    blocks.push({
      from: startLine.from,
      to: endLine.to,
      code: codeLines.join('\n'),
      fromLine: startLine.number,
      toLine: endLine.number,
    });
    lineNumber = endLine.number + 1;
  }

  return blocks;
}

async function renderMermaidSvg(code: string, id: string): Promise<string> {
  const { svg } = await mermaid.render(id, code);
  return svg;
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

function computeActiveBlockIndices(blocks: MermaidBlock[], activeLines: Set<number>): Set<number> {
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

function computeViewportBlockIndices(blocks: MermaidBlock[], view: EditorView): Set<number> {
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

class MermaidWidget extends WidgetType {
  private renderId: string | null = null;

  constructor(
    private readonly code: string,
    private readonly theme: MermaidTheme
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'cm-mermaid-widget';
    if (this.renderId === null) {
      this.renderId = `gruvbox-mermaid-widget-${nextMermaidRenderId++}`;
    }
    const cacheKey = `${this.theme}::${this.code}`;
    const cached = mermaidSvgCacheGet(cacheKey);
    if (cached !== undefined) {
      root.innerHTML = cached;
      return root;
    }
    root.textContent = 'Rendering diagram...';
    void this.renderInto(root, cacheKey);
    return root;
  }

  private async renderInto(root: HTMLElement, cacheKey: string): Promise<void> {
    const id = this.renderId ?? `gruvbox-mermaid-widget-${nextMermaidRenderId++}`;
    this.renderId = id;
    try {
      ensureMermaidInitialized(this.theme);
      const svg = await renderMermaidSvg(this.code, id);
      mermaidSvgCacheSet(cacheKey, svg);
      root.innerHTML = svg;
    } catch (error) {
      root.innerHTML = '';
      const fallback = document.createElement('pre');
      fallback.className = 'cm-mermaid-widget-error';
      fallback.textContent = `Mermaid render error: ${
        error instanceof Error ? error.message : String(error)
      }`;
      root.appendChild(fallback);
    }
  }

  eq(other: MermaidWidget): boolean {
    return this.code === other.code && this.theme === other.theme;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class MermaidWidgetPlugin {
  decorations: DecorationSet;
  private lastActiveBlockIndices: Set<number>;
  private lastViewportBlockIndices: Set<number>;

  constructor(
    private readonly view: EditorView,
    private readonly theme: MermaidTheme
  ) {
    const doc = this.view.state.doc;
    const blocks = parseMermaidBlocks(doc);
    this.lastActiveBlockIndices = computeActiveBlockIndices(blocks, linesSpannedBySelection(this.view.state));
    this.lastViewportBlockIndices = computeViewportBlockIndices(blocks, this.view);
    this.decorations = this.buildDecorations();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      const blocksBefore = parseMermaidBlocks(update.startState.doc);
      const blocksAfter = parseMermaidBlocks(update.state.doc);
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
      const blocks = parseMermaidBlocks(this.view.state.doc);
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
      const blocks = parseMermaidBlocks(this.view.state.doc);
      const nextViewport = computeViewportBlockIndices(blocks, this.view);
      if (setsEqual(this.lastViewportBlockIndices, nextViewport)) {
        return;
      }
      this.lastViewportBlockIndices = nextViewport;
      this.decorations = this.buildDecorations();
    }
  }

  private replacementRangeForLine(lineNumber: number): { from: number; to: number } | null {
    const line = this.view.state.doc.line(lineNumber);
    if (line.to <= line.from) {
      return null;
    }
    return { from: line.from, to: line.to };
  }

  private buildDecorations(): DecorationSet {
    const blocks = parseMermaidBlocks(this.view.state.doc);
    const activeLines = linesSpannedBySelection(this.view.state);
    const ranges: Range<Decoration>[] = [];

    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      let isActive = false;
      for (let line = block.fromLine; line <= block.toLine; line += 1) {
        if (activeLines.has(line)) {
          isActive = true;
          break;
        }
      }
      if (isActive) {
        continue;
      }

      const firstLineRange = this.replacementRangeForLine(block.fromLine);
      if (firstLineRange) {
        ranges.push(
          Decoration.replace({
            widget: new MermaidWidget(block.code, this.theme),
          }).range(firstLineRange.from, firstLineRange.to)
        );
      }

      for (let line = block.fromLine + 1; line <= block.toLine; line += 1) {
        const lineObj = this.view.state.doc.line(line);
        const lineRange = this.replacementRangeForLine(line);
        if (lineRange) {
          ranges.push(Decoration.replace({}).range(lineRange.from, lineRange.to));
        }
        ranges.push(Decoration.line({ class: 'cm-mermaid-hidden-line' }).range(lineObj.from));
      }
    }

    return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none;
  }
}

export function markdownMermaidWidget(theme: MermaidTheme) {
  let cached = mermaidViewPluginByTheme.get(theme);
  if (!cached) {
    cached = ViewPlugin.fromClass(
      class extends MermaidWidgetPlugin {
        constructor(view: EditorView) {
          super(view, theme);
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      }
    );
    mermaidViewPluginByTheme.set(theme, cached);
  }
  return cached;
}
