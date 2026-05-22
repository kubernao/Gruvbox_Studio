import type { Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from '@codemirror/view';

interface InlineHtmlMatch {
  from: number;
  to: number;
  source: string;
}

const BLOCKED_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
]);

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'formaction', 'poster']);

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return !(
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('vbscript:') ||
    trimmed.startsWith('data:text/html')
  );
}

function sanitizeInlineHtml(source: string): string | null {
  const template = document.createElement('template');
  template.innerHTML = source;

  const stack: Element[] = Array.from(template.content.children);
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    const tagName = node.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tagName)) {
      return null;
    }
    for (const attr of Array.from(node.attributes)) {
      const attrName = attr.name.toLowerCase();
      if (attrName.startsWith('on')) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.has(attrName) && !isSafeUrl(attr.value)) {
        node.removeAttribute(attr.name);
      }
    }
    stack.push(...Array.from(node.children));
  }

  const safeHtml = template.innerHTML.trim();
  if (!safeHtml) {
    return null;
  }
  return safeHtml;
}

function findInlineHtmlMatches(view: EditorView): InlineHtmlMatch[] {
  const matches: InlineHtmlMatch[] = [];
  const activeLines = new Set<number>();
  const pattern =
    /<([a-z][\w:-]*)(\s[^<>]*?)?>([^<>]*)<\/\1\s*>|<([a-z][\w:-]*)(\s[^<>]*?)?\/?>/gi;

  for (const { from, to } of view.visibleRanges) {
    let lineNo = view.state.doc.lineAt(from).number;
    const endLineNo = view.state.doc.lineAt(to).number;
    while (lineNo <= endLineNo) {
      const line = view.state.doc.line(lineNo);
      if (!activeLines.has(lineNo)) {
        let token: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((token = pattern.exec(line.text)) !== null) {
          const raw = token[0];
          if (!raw.includes('<') || !raw.includes('>')) {
            continue;
          }
          const sanitized = sanitizeInlineHtml(raw);
          if (!sanitized) {
            continue;
          }
          const matchFrom = line.from + token.index;
          const matchTo = matchFrom + raw.length;
          matches.push({ from: matchFrom, to: matchTo, source: sanitized });
        }
      }
      lineNo += 1;
    }
  }

  return matches;
}

class InlineHtmlWidget extends WidgetType {
  constructor(private readonly html: string) {
    super();
  }

  toDOM(): HTMLElement {
    const root = document.createElement('span');
    root.className = 'cm-inline-html-widget';
    root.innerHTML = this.html;
    return root;
  }

  eq(other: InlineHtmlWidget): boolean {
    return this.html === other.html;
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return -1;
  }
}

function buildInlineHtmlDecorations(view: EditorView): DecorationSet {
  const matches = findInlineHtmlMatches(view);
  if (matches.length === 0) {
    return Decoration.none;
  }
  const ranges: Range<Decoration>[] = matches.map((match) =>
    Decoration.replace({
      widget: new InlineHtmlWidget(match.source),
      inclusive: false,
    }).range(match.from, match.to)
  );
  return Decoration.set(ranges, true);
}

class MarkdownInlineHtmlPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildInlineHtmlDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged
    ) {
      this.decorations = buildInlineHtmlDecorations(update.view);
    }
  }
}

export const markdownInlineHtmlWidget = ViewPlugin.fromClass(MarkdownInlineHtmlPlugin, {
  decorations: (plugin) => plugin.decorations,
});
