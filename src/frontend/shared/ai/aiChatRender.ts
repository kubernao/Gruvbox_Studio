/**
 * Markdown and ANSI rendering for AI chat responses.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

type AnsiState = {
  bold: boolean;
  underline: boolean;
  fg: string | null;
  bg: string | null;
};

const ANSI_FG_CLASSES: Record<number, string> = {
  30: 'ansi-fg-black',
  31: 'ansi-fg-red',
  32: 'ansi-fg-green',
  33: 'ansi-fg-yellow',
  34: 'ansi-fg-blue',
  35: 'ansi-fg-magenta',
  36: 'ansi-fg-cyan',
  37: 'ansi-fg-white',
  90: 'ansi-fg-bright-black',
  91: 'ansi-fg-bright-red',
  92: 'ansi-fg-bright-green',
  93: 'ansi-fg-bright-yellow',
  94: 'ansi-fg-bright-blue',
  95: 'ansi-fg-bright-magenta',
  96: 'ansi-fg-bright-cyan',
  97: 'ansi-fg-bright-white',
};

const ANSI_BG_CLASSES: Record<number, string> = {
  40: 'ansi-bg-black',
  41: 'ansi-bg-red',
  42: 'ansi-bg-green',
  43: 'ansi-bg-yellow',
  44: 'ansi-bg-blue',
  45: 'ansi-bg-magenta',
  46: 'ansi-bg-cyan',
  47: 'ansi-bg-white',
  100: 'ansi-bg-bright-black',
  101: 'ansi-bg-bright-red',
  102: 'ansi-bg-bright-green',
  103: 'ansi-bg-bright-yellow',
  104: 'ansi-bg-bright-blue',
  105: 'ansi-bg-bright-magenta',
  106: 'ansi-bg-bright-cyan',
  107: 'ansi-bg-bright-white',
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ansiStateToClasses(state: AnsiState): string[] {
  const classes: string[] = [];
  if (state.bold) {
    classes.push('ansi-bold');
  }
  if (state.underline) {
    classes.push('ansi-underline');
  }
  if (state.fg !== null) {
    classes.push(state.fg);
  }
  if (state.bg !== null) {
    classes.push(state.bg);
  }
  return classes;
}

function ansiToHtml(raw: string): string {
  const state: AnsiState = {
    bold: false,
    underline: false,
    fg: null,
    bg: null,
  };
  let html = '';
  let lastIndex = 0;
  let spanOpen = false;
  const pattern = /\x1b\[([0-9;]*)m/g;

  const closeSpan = (): void => {
    if (spanOpen) {
      html += '</span>';
      spanOpen = false;
    }
  };

  const openSpan = (): void => {
    const classes = ansiStateToClasses(state);
    if (classes.length === 0) {
      return;
    }
    html += `<span class="${classes.join(' ')}">`;
    spanOpen = true;
  };

  const appendText = (text: string): void => {
    if (text !== '') {
      html += escapeHtml(text);
    }
  };

  for (const match of raw.matchAll(pattern)) {
    const [token, codesText] = match;
    const index = match.index ?? 0;
    appendText(raw.slice(lastIndex, index));
    closeSpan();

    const codes = codesText === '' ? [0] : codesText.split(';').map((value) => Number(value));
    for (const code of codes) {
      if (code === 0) {
        state.bold = false;
        state.underline = false;
        state.fg = null;
        state.bg = null;
      } else if (code === 1) {
        state.bold = true;
      } else if (code === 22) {
        state.bold = false;
      } else if (code === 4) {
        state.underline = true;
      } else if (code === 24) {
        state.underline = false;
      } else if (code === 39) {
        state.fg = null;
      } else if (code === 49) {
        state.bg = null;
      } else if (ANSI_FG_CLASSES[code] !== undefined) {
        state.fg = ANSI_FG_CLASSES[code];
      } else if (ANSI_BG_CLASSES[code] !== undefined) {
        state.bg = ANSI_BG_CLASSES[code];
      }
    }
    openSpan();
    lastIndex = index + token.length;
  }

  appendText(raw.slice(lastIndex));
  closeSpan();
  return html;
}

type ToolToken = {
  state: 'run' | 'ok' | 'err' | 'building' | 'update';
  title: string;
  body: string;
};

const ASSISTANT_INLINE_TOKEN_RE =
  /\[\[GVX_THINK:([^\]]*)\]\]|\[\[GVX_TOOL:(run|ok|err|building|update):([^:\]]*):([^\]]*)\]\]/g;

function decodeToolTokenValue(raw: string): string {
  try {
    // Convert literal \n / \t sequences to actual whitespace before
    // displaying so streaming tool-card text renders with proper breaks.
    const decoded = decodeURIComponent(raw);
    return decoded.split('\\n').join('\n').split('\\t').join('\t');
  } catch {
    return raw;
  }
}

type AssistantContentPart =
  | { type: 'text'; value: string }
  | { type: 'thinking'; value: string }
  | { type: 'tool'; value: ToolToken };

function tokenizeAssistantContent(raw: string): AssistantContentPart[] {
  const out: AssistantContentPart[] = [];
  let last = 0;
  for (const match of raw.matchAll(ASSISTANT_INLINE_TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      out.push({ type: 'text', value: raw.slice(last, idx) });
    }
    if (match[1] !== undefined) {
      out.push({ type: 'thinking', value: decodeToolTokenValue(match[1]) });
    } else {
      out.push({
        type: 'tool',
        value: {
          state:
            match[2] === 'err' ? 'err'
            : match[2] === 'run' ? 'run'
            : match[2] === 'building' ? 'building'
            : match[2] === 'update' ? 'update'
            : 'ok',
          title: decodeToolTokenValue(match[3] ?? ''),
          body: decodeToolTokenValue(match[4] ?? ''),
        },
      });
    }
    last = idx + match[0].length;
  }
  if (last < raw.length) {
    out.push({ type: 'text', value: raw.slice(last) });
  }
  return out;
}

type RenderableAssistantPart =
  | { type: 'text'; value: string }
  | { type: 'thinking'; value: string }
  | { type: 'toolGroup'; values: ToolToken[] };

function groupAssistantContentParts(parts: AssistantContentPart[]): RenderableAssistantPart[] {
  const out: RenderableAssistantPart[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part.type === 'text' || part.type === 'thinking') {
      out.push(part);
      i += 1;
      continue;
    }
    const values: ToolToken[] = [];
    while (i < parts.length) {
      const cur = parts[i];
      if (cur.type === 'tool') {
        values.push(cur.value);
        i += 1;
        continue;
      }
      if (cur.type === 'text' && cur.value.trim() === '') {
        i += 1;
        continue;
      }
      break;
    }
    out.push({ type: 'toolGroup', values });
  }
  return out;
}

/**
 * Renders streaming assistant prose as already-revealed text plus an optional
 * trailing span that fades in, so each IPC chunk only animates its delta.
 */
/**
 * Renders plain preformatted stream text with a fading tail span for newly
 * arrived characters during an active assistant turn.
 */
function renderStreamPreHtml(text: string, stableCharCount: number, escape: (value: string) => string): string {
  const stableEnd = Math.min(Math.max(0, stableCharCount), text.length);
  const stableText = text.slice(0, stableEnd);
  const chunkText = text.slice(stableEnd);
  const stableHtml = stableText === '' ? '' : escape(stableText);
  const chunkHtml =
    chunkText === ''
      ? ''
      : `<span class="ai-chat-stream-chunk">${escape(chunkText)}</span>`;
  return `${stableHtml}${chunkHtml}`;
}

function renderStreamTextHtml(text: string, stableCharCount: number): string {
  const inner = renderStreamPreHtml(text, stableCharCount, ansiToHtml);
  return `<div class="ai-chat-stream-text">${inner}</div>`;
}

type StreamRevealState = { budget: number };

/**
 * Advances the stream reveal budget across a timeline part and reports how
 * much of that part was already shown plus whether the whole part is new.
 */
function consumeStreamReveal(
  reveal: StreamRevealState,
  plainLen: number,
): { stableChars: number; animateShell: boolean } {
  const before = reveal.budget;
  const stableChars = Math.min(before, plainLen);
  reveal.budget = Math.max(0, reveal.budget - plainLen);
  return { stableChars, animateShell: before === 0 && plainLen > 0 };
}

/**
 * Index of the last thinking or tool card in the grouped assistant timeline.
 */
function findLastCardPartIndex(parts: RenderableAssistantPart[]): number {
  let lastCardPartIndex = -1;
  parts.forEach((part, index) => {
    if (part.type === 'thinking' || part.type === 'toolGroup') {
      lastCardPartIndex = index;
    }
  });
  return lastCardPartIndex;
}

/**
 * Counts visible plain characters in assistant stream order (text, thinking,
 * and tool bodies) so reveal offsets ignore marker metadata length jumps.
 */
export function assistantStreamPlainCharCount(raw: string): number {
  let count = 0;
  for (const part of tokenizeAssistantContent(raw)) {
    if (part.type === 'text' || part.type === 'thinking') {
      count += part.value.length;
    } else if (part.type === 'tool') {
      count += part.value.body.length;
    }
  }
  return count;
}

/**
 * Returns whether the assistant transcript includes user-visible answer prose or
 * reasoning. Tool-card markers alone do not count, so a thinking loader can stay
 * visible during tool-only preambles until text or thinking content arrives.
 */
export function assistantHasAnswerContent(raw: string): boolean {
  for (const part of tokenizeAssistantContent(raw)) {
    if ((part.type === 'text' || part.type === 'thinking') && part.value.trim() !== '') {
      return true;
    }
  }
  return false;
}

function renderThinkingCardHtml(
  body: string,
  isStreaming: boolean,
  stableCharCount = 0,
  shouldOpen = false,
  animateShell = false,
): string {
  const trimmed = body.trim();
  if (trimmed === '') {
    return '';
  }
  const innerHtml = isStreaming
    ? renderStreamTextHtml(body, stableCharCount)
    : renderTextWithJsonCards(body);
  const openAttr = shouldOpen ? ' open' : '';
  const enterCls = animateShell ? ' ai-chat-stream-enter' : '';
  return `<details class="ai-tool-preview ai-tool-preview--thinking${enterCls}"${openAttr} data-testid="ai-chat-thinking"><summary class="ai-tool-preview__title">Thinking</summary><div class="ai-tool-preview__thinking-md">${innerHtml}</div></details>`;
}

function extractToolNameFromTitle(title: string): string | null {
  const genericMatch = /^\s*Building tool call\s*$/i.exec(title);
  if (genericMatch) {
    // Generic building card — prune when any terminal card exists.
    return '__toolcall__';
  }
  const match = /^\s*Tool\s+(?:running|done|failed|building|updating)\s*:\s*(.+?)\s*$/i.exec(title);
  if (!match) {
    return null;
  }
  const name = match[1]?.trim();
  return name ? name : null;
}

/**
 * Hide stale "running"/"building"/"update" cards when the same tool already
 * emitted a terminal success/failure card in the same visual group. This
 * keeps only actively running tools visible while preserving completed
 * outcomes.
 */
function pruneSettledRunningCards(values: ToolToken[]): ToolToken[] {
  const completedByTool = new Map<string, number>();
  for (const token of values) {
    if (token.state !== 'ok' && token.state !== 'err') {
      continue;
    }
    const toolName = extractToolNameFromTitle(token.title);
    if (!toolName) {
      continue;
    }
    completedByTool.set(toolName, (completedByTool.get(toolName) ?? 0) + 1);
  }

  if (completedByTool.size === 0) {
    return values;
  }

  const remainingCompletions = new Map(completedByTool);
  const kept: ToolToken[] = [];
  for (const token of values) {
    if (token.state === 'ok' || token.state === 'err') {
      kept.push(token);
      continue;
    }
    const toolName = extractToolNameFromTitle(token.title);
    if (!toolName) {
      kept.push(token);
      continue;
    }
    // Generic building card (no specific tool) — prune when any terminal card exists.
    if (toolName === '__toolcall__') {
      continue;
    }
    // Prune this non-terminal card when a terminal card for the same tool exists.
    if (remainingCompletions.has(toolName)) {
      continue;
    }
    kept.push(token);
  }
  return kept;
}

function renderToolCardHtml(
  token: ToolToken,
  bodyStableCharCount = 0,
  animateStreamBody = false,
  animateShell = false,
): string {
  const enterCls = animateShell ? ' ai-chat-stream-enter' : '';
  const cls =
    (token.state === 'err'
      ? 'ai-tool-preview is-error'
      : token.state === 'ok'
        ? 'ai-tool-preview is-success'
        : token.state === 'building'
          ? 'ai-tool-preview is-building'
          : token.state === 'update'
            ? 'ai-tool-preview is-update'
            : 'ai-tool-preview is-running') + enterCls;

  const streamBody = animateStreamBody
    ? renderStreamPreHtml(token.body, bodyStableCharCount, escapeHtml)
    : escapeHtml(token.body);

  if (token.state === 'building') {
    return `<div class="${cls}"><div class="ai-tool-preview__title">${escapeHtml(token.title)}</div><div class="ai-tool-preview__scroll-body"><pre class="ai-tool-preview__body ai-tool-preview__body--compact">${streamBody}</pre></div></div>`;
  }

  if (token.state === 'update') {
    return `<div class="${cls}"><pre class="ai-tool-preview__body ai-tool-preview__body--compact">${streamBody}</pre></div>`;
  }

  return `<div class="${cls}"><div class="ai-tool-preview__title">${escapeHtml(token.title)}</div><pre class="ai-tool-preview__body">${streamBody}</pre></div>`;
}

function renderToolCardGroupHtml(
  values: ToolToken[],
  streamReveal?: { budget: number },
  animateStreamBody = false,
): string {
  const visibleValues = pruneSettledRunningCards(values);
  if (visibleValues.length === 0) {
    return '';
  }
  const renderOne = (token: ToolToken): string => {
    let bodyStable = 0;
    let animateShell = false;
    if (animateStreamBody && streamReveal) {
      const reveal = consumeStreamReveal(streamReveal, token.body.length);
      bodyStable = reveal.stableChars;
      animateShell = reveal.animateShell;
    }
    return renderToolCardHtml(token, bodyStable, animateStreamBody, animateShell);
  };
  if (visibleValues.length === 1) {
    return renderOne(visibleValues[0]);
  }
  return `<div class="ai-tool-stack">${visibleValues.map((token) => renderOne(token)).join('')}</div>`;
}

type JsonSegment =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown };

function findJsonSegmentAt(raw: string, start: number): { end: number; value: unknown } | null {
  for (let end = raw.length; end > start; end--) {
    const candidate = raw.slice(start, end);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return { end, value: parsed };
    } catch {
      // continue searching for a shorter valid json candidate
    }
  }
  return null;
}

function extractJsonSegments(raw: string): JsonSegment[] {
  const out: JsonSegment[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    let jsonStart = -1;
    for (let i = cursor; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '{' || ch === '[') {
        jsonStart = i;
        break;
      }
    }
    if (jsonStart === -1) {
      out.push({ type: 'text', value: raw.slice(cursor) });
      break;
    }
    const segment = findJsonSegmentAt(raw, jsonStart);
    if (segment === null) {
      out.push({ type: 'text', value: raw.slice(cursor) });
      break;
    }
    if (jsonStart > cursor) {
      out.push({ type: 'text', value: raw.slice(cursor, jsonStart) });
    }
    out.push({ type: 'json', value: segment.value });
    cursor = segment.end;
  }
  return out;
}

function previewValue(value: unknown, max = 52): string {
  const raw =
    typeof value === 'string'
      ? value
      : value === null
        ? 'null'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  const normalized = raw.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function renderBadge(key: string, value: unknown): string {
  return `<span class="ai-json-badge"><span class="ai-json-badge__key">${escapeHtml(key)}</span><span class="ai-json-badge__value">${escapeHtml(previewValue(value))}</span></span>`;
}

function renderJsonCardHtml(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.edits)) {
      const editBadges: string[] = [];
      const edits = obj.edits.slice(0, 6);
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        if (edit !== null && typeof edit === 'object' && !Array.isArray(edit)) {
          const e = edit as Record<string, unknown>;
          if (e.newText !== undefined) {
            editBadges.push(renderBadge(`newText ${i + 1}`, e.newText));
          }
          if (e.oldText !== undefined) {
            editBadges.push(renderBadge(`oldText ${i + 1}`, e.oldText));
          }
        }
      }
      if (obj.path !== undefined) {
        editBadges.push(renderBadge('path', obj.path));
      }
      return `<div class="ai-json-card"><div class="ai-json-card__title">Edits</div><div class="ai-json-card__badges">${editBadges.join('')}</div></div>`;
    }

    const entries = Object.entries(obj).slice(0, 8);
    const badges = entries.map(([k, v]) => renderBadge(k, v)).join('');
    return `<div class="ai-json-card"><div class="ai-json-card__title">JSON</div><div class="ai-json-card__badges">${badges}</div></div>`;
  }

  if (Array.isArray(value)) {
    const badges = value.slice(0, 8).map((v, i) => renderBadge(`#${i + 1}`, v)).join('');
    return `<div class="ai-json-card"><div class="ai-json-card__title">JSON Array</div><div class="ai-json-card__badges">${badges}</div></div>`;
  }

  return `<div class="ai-json-card"><div class="ai-json-card__title">JSON</div><div class="ai-json-card__badges">${renderBadge('value', value)}</div></div>`;
}

function renderTextWithJsonCards(raw: string): string {
  const segments = extractJsonSegments(raw);
  return segments
    .map((segment) => {
      if (segment.type === 'json') {
        return renderJsonCardHtml(segment.value);
      }
      if (segment.value.trim() === '') {
        return '';
      }
      return marked.parse(ansiToHtml(segment.value), { async: false }) as string;
    })
    .join('');
}

function toRenderedMarkdownInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return raw;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    return raw;
  }
}

function renderStreamingContent(raw: string, streamStableCharCount = 0): string {
  const streamReveal: StreamRevealState = { budget: Math.max(0, streamStableCharCount) };
  const parts = groupAssistantContentParts(tokenizeAssistantContent(raw));
  const lastCardPartIndex = findLastCardPartIndex(parts);
  const chunks = parts
    .map((part, index) => {
      if (part.type === 'toolGroup') {
        return renderToolCardGroupHtml(part.values, streamReveal, true);
      }
      if (part.type === 'thinking') {
        const { stableChars, animateShell } = consumeStreamReveal(streamReveal, part.value.length);
        const shouldOpen = index === lastCardPartIndex;
        return renderThinkingCardHtml(part.value, true, stableChars, shouldOpen, animateShell);
      }
      if (part.value.trim() === '') {
        return '';
      }
      const { stableChars } = consumeStreamReveal(streamReveal, part.value.length);
      return renderStreamTextHtml(part.value, stableChars);
    })
    .join('');
  return DOMPurify.sanitize(chunks, {
    ALLOWED_TAGS: ['div', 'span', 'pre', 'details', 'summary'],
    ALLOWED_ATTR: ['class', 'data-testid', 'open'],
  });
}

export type RenderAssistantContentOptions = {
  /** Plain-text character offset already shown for the active stream (fade only the tail). */
  streamStableCharCount?: number;
};

/** Final assistant message: Markdown + ANSI. */
export function renderAssistantContent(
  raw: string,
  isStreaming: boolean,
  options: RenderAssistantContentOptions = {},
): string {
  if (isStreaming) {
    return renderStreamingContent(raw, options.streamStableCharCount ?? 0);
  }
  try {
    const dirty = groupAssistantContentParts(tokenizeAssistantContent(raw))
      .map((part) => {
        if (part.type === 'toolGroup') {
          return renderToolCardGroupHtml(part.values);
        }
        if (part.type === 'thinking') {
          return renderThinkingCardHtml(part.value, false);
        }
        const markdownInput = toRenderedMarkdownInput(part.value);
        if (markdownInput !== part.value) {
          return marked.parse(markdownInput, { async: false }) as string;
        }
        return renderTextWithJsonCards(part.value);
      })
      .join('');
    return DOMPurify.sanitize(dirty, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ['img', 'h1', 'h2', 'h3', 'pre', 'code', 'span', 'details', 'summary'],
      ADD_ATTR: ['href', 'name', 'target', 'rel', 'src', 'alt', 'title', 'class', 'data-testid', 'open'],
    });
  } catch {
    return renderStreamingContent(raw);
  }
}
