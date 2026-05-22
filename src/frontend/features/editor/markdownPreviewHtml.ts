import { marked } from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import katex from 'katex';

marked.setOptions({ gfm: true, breaks: true });

/** Prefix for Mermaid diagram root `id` in export HTML; must match main-process rasterizer pattern. */
export const MERMAID_EXPORT_ID_PREFIX = 'gruvbox-docs-mermaid-';

const EXTRA_TAGS = [
  'input',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'code',
  'span',
  'br',
  'del',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'svg',
  'g',
  'path',
  'line',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'text',
  'tspan',
  'foreignObject',
  'defs',
  'use',
  'symbol',
  'image',
  'title',
  'desc',
  'marker',
  'pattern',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'style',
];

/** Extra attributes beyond DOMPurify defaults (SVG + XHTML-in-SVG + tables). */
const PREVIEW_ADD_ATTR = [
  'xmlns',
  'xmlns:xlink',
  'viewBox',
  'width',
  'height',
  'role',
  'aria-roledescription',
  'transform',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'marker-start',
  'marker-end',
  'x1',
  'x2',
  'y1',
  'y2',
  'x',
  'y',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'points',
  'text-anchor',
  'dominant-baseline',
  'dx',
  'dy',
  'href',
  'xlink:href',
  'preserveAspectRatio',
  'overflow',
  'requiredExtensions',
  'refX',
  'refY',
  'markerWidth',
  'markerHeight',
  'orient',
  'patternUnits',
  'fx',
  'fy',
  'offset',
  'stop-color',
  'stop-opacity',
  'type',
  'colspan',
  'rowspan',
  'align',
  'opacity',
  'checked',
  'disabled',
  'name',
  'rel',
  'target',
  'alt',
  'title',
  'src',
];

/** Default DOMPurify forbidden-contents minus `foreignobject` so Mermaid XHTML labels work. */
const PREVIEW_FORBID_CONTENTS = [
  'annotation-xml',
  'audio',
  'colgroup',
  'desc',
  'head',
  'iframe',
  'math',
  'mi',
  'mn',
  'mo',
  'ms',
  'mtext',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'script',
  'style',
  'svg',
  'template',
  'thead',
  'title',
  'video',
  'xmp',
];

const MERMAID_BLOCK_PATTERN = /```mermaid[^\n]*\n([\s\S]*?)```/gi;
const MERMAID_PLACEHOLDER_PREFIX = 'GRUVBOXMERMAIDBLOCK';
const LATEX_BLOCK_PATTERN = /\$\$([\s\S]*?)\$\$/g;
const LATEX_INLINE_PATTERN = /(?<!\$)\$([^\n$][^$]*?)\$(?!\$)/g;
const LATEX_BLOCK_PLACEHOLDER_PREFIX = 'GRUVBOXLATEXBLOCK';
const LATEX_INLINE_PLACEHOLDER_PREFIX = 'GRUVBOXLATEXINLINE';

type MermaidTheme = 'default' | 'dark';

interface MarkdownPreviewOptions {
  mermaidTheme?: MermaidTheme;
}

let mermaidInitialized = false;

function getDomPurify(): typeof DOMPurify {
  return DOMPurify;
}

export function sanitizePreviewHtml(dirty: string): string {
  const purify = getDomPurify();
  return purify.sanitize(dirty, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: EXTRA_TAGS,
    ADD_ATTR: PREVIEW_ADD_ATTR,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_CONTENTS: PREVIEW_FORBID_CONTENTS,
    HTML_INTEGRATION_POINTS: {
      'annotation-xml': true,
      foreignobject: true,
    },
  });
}

function newMermaidExportNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function createMermaidRenderId(nonce: string, index: number): string {
  return `${MERMAID_EXPORT_ID_PREFIX}${nonce}-${index}`;
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getInvoke():
  | ((channel: string, ...args: unknown[]) => Promise<unknown>)
  | undefined {
  if (typeof window === 'undefined') return undefined;
  const invoke = window.electronAPI?.invoke;
  return typeof invoke === 'function' ? invoke : undefined;
}

function markdownToSafeHtmlSync(md: string): string {
  try {
    const dirty = marked.parse(md, { async: false }) as string;
    return sanitizePreviewHtml(dirty);
  } catch {
    return '<p class="markdown-preview-error">Preview could not be rendered.</p>';
  }
}

async function renderMermaidSvg(definition: string, renderId: string): Promise<string> {
  try {
    const { svg } = await mermaid.render(renderId, definition.trim());
    return svg;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<pre class="diagram-error">Mermaid render error: ${escapeHtmlText(message)}</pre>`;
  }
}

async function markdownToSafeHtmlWithMermaid(
  md: string,
  mermaidTheme: MermaidTheme
): Promise<string> {
  if (!mermaidInitialized || mermaid.mermaidAPI.getConfig().theme !== mermaidTheme) {
    mermaid.initialize({ startOnLoad: false, theme: mermaidTheme, securityLevel: 'strict' });
    mermaidInitialized = true;
  }

  const mermaidNonce = newMermaidExportNonce();
  const mermaidDefinitions: string[] = [];
  const latexBlocks: string[] = [];
  const latexInline: string[] = [];
  const markdownWithMermaidPlaceholders = md.replace(
    MERMAID_BLOCK_PATTERN,
    (_full, definition: string) => {
      const id = mermaidDefinitions.length;
      mermaidDefinitions.push(definition);
      return `${MERMAID_PLACEHOLDER_PREFIX}${id}TOKEN`;
    }
  );
  const markdownWithLatexBlockPlaceholders = markdownWithMermaidPlaceholders.replace(
    LATEX_BLOCK_PATTERN,
    (_full, expression: string) => {
      const id = latexBlocks.length;
      latexBlocks.push(expression);
      return `${LATEX_BLOCK_PLACEHOLDER_PREFIX}${id}TOKEN`;
    }
  );
  const markdownWithPlaceholders = markdownWithLatexBlockPlaceholders.replace(
    LATEX_INLINE_PATTERN,
    (_full, expression: string) => {
      const id = latexInline.length;
      latexInline.push(expression);
      return `${LATEX_INLINE_PLACEHOLDER_PREFIX}${id}TOKEN`;
    }
  );

  const dirtyHtml = (await marked.parse(markdownWithPlaceholders, { async: true })) as string;
  let html = sanitizePreviewHtml(dirtyHtml);

  for (let i = 0; i < mermaidDefinitions.length; i += 1) {
    const renderId = createMermaidRenderId(mermaidNonce, i);
    const svg = await renderMermaidSvg(mermaidDefinitions[i], renderId);
    const marker = `${MERMAID_PLACEHOLDER_PREFIX}${i}TOKEN`;
    html = html.replace(marker, svg);
  }
  for (let i = 0; i < latexBlocks.length; i += 1) {
    const marker = `${LATEX_BLOCK_PLACEHOLDER_PREFIX}${i}TOKEN`;
    const rendered = `<div class="katex-display">${katex.renderToString(latexBlocks[i].trim(), {
      throwOnError: false,
      displayMode: true,
      output: 'html',
    })}</div>`;
    html = html.replace(marker, rendered);
  }
  for (let i = 0; i < latexInline.length; i += 1) {
    const marker = `${LATEX_INLINE_PLACEHOLDER_PREFIX}${i}TOKEN`;
    const rendered = katex.renderToString(latexInline[i].trim(), {
      throwOnError: false,
      displayMode: false,
      output: 'html',
    });
    html = html.replace(marker, rendered);
  }

  return html;
}

/**
 * Render markdown to HTML safe for `dangerouslySetInnerHTML` (user-authored notes).
 * Uses Rust + ammonia in Electron; falls back to marked + DOMPurify in tests.
 */
export async function markdownToSafeHtml(
  md: string,
  options: MarkdownPreviewOptions = {}
): Promise<string> {
  const mermaidTheme = options.mermaidTheme ?? 'default';
  if (MERMAID_BLOCK_PATTERN.test(md) || LATEX_BLOCK_PATTERN.test(md) || LATEX_INLINE_PATTERN.test(md)) {
    MERMAID_BLOCK_PATTERN.lastIndex = 0;
    LATEX_BLOCK_PATTERN.lastIndex = 0;
    LATEX_INLINE_PATTERN.lastIndex = 0;
    return markdownToSafeHtmlWithMermaid(md, mermaidTheme);
  }
  MERMAID_BLOCK_PATTERN.lastIndex = 0;
  LATEX_BLOCK_PATTERN.lastIndex = 0;
  LATEX_INLINE_PATTERN.lastIndex = 0;
  const invoke = getInvoke();
  if (invoke) {
    try {
      const html = (await invoke('rust:renderMarkdown', md)) as string;
      if (typeof html === 'string' && html.length > 0) {
        return html;
      }
    } catch {
      /* fall through */
    }
  }
  return markdownToSafeHtmlSync(md);
}
