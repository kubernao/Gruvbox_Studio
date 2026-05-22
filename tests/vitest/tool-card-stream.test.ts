/**
 * Unit tests for streaming tool-card marker helpers and the renderer.
 *
 *   src/frontend/features/assistant/utils/toolCardStream.ts
 *   src/frontend/shared/ai/aiChatRender.ts
 */
import { describe, it, expect } from 'vitest';
import {
  appendToToolCard,
  replaceOrAppendToolCard,
} from '../../src/frontend/features/assistant/utils/toolCardStream';
import {
  assistantHasAnswerContent,
  assistantStreamPlainCharCount,
  renderAssistantContent,
} from '../../src/frontend/shared/ai/aiChatRender';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the body portion from the first (or only) card marker in content. */
function extractCardBody(content: string): string {
  const m = content.match(/\[\[GVX_TOOL:[a-z]+:[^:]*:([^\]]*)\]\]/);
  if (!m) throw new Error('No card marker found');
  return decodeURIComponent(m[1]);
}

function countCards(content: string): number {
  return (content.match(/\[\[GVX_TOOL:/g) || []).length;
}

// ---------------------------------------------------------------------------
// appendToToolCard
// ---------------------------------------------------------------------------

describe('appendToToolCard', () => {
  it('creates a new building card when none exists', () => {
    const result = appendToToolCard(
      'some text',
      'read',
      'building',
      'Building tool call',
      '{"path":',
    );
    expect(countCards(result)).toBe(1);
    expect(result).toContain('Building%20tool%20call');
    expect(result).toContain('%7B%22path%22%3A'); // encoded {"path":
    // Card should appear after existing content.
    expect(result).toMatch(/^some text\n\n/);
  });

  it('accumulates deltas in the same building card', () => {
    let content = appendToToolCard('', 'read', 'building', 'Building tool call', '{"path":');
    content = appendToToolCard(content, 'read', 'building', 'Building tool call', '"/foo"');
    content = appendToToolCard(content, 'read', 'building', 'Building tool call', ', "limit"');

    // Single card.
    expect(countCards(content)).toBe(1);

    // Body accumulates all fragments.
    const body = extractCardBody(content);
    expect(body).toBe('{"path":"/foo", "limit"');
  });

  it('converts literal \\n to real newlines inside the body', () => {
    let content = appendToToolCard('', 'bash', 'building', 'Building tool call', 'line1\\nline2');

    const body = extractCardBody(content);
    expect(body).toContain('\n');
    expect(body).toBe('line1\nline2');
  });

  it('converts literal \\t to real tabs inside the body', () => {
    let content = appendToToolCard('', 'bash', 'building', 'Building tool call', 'col1\\tcol2');

    const body = extractCardBody(content);
    expect(body).toBe('col1\tcol2');
  });

  it('normalises \\n that was already accumulated from a prior card', () => {
    // Simulate a card whose body contains literal \n
    const encoded = encodeURIComponent('old\\nbody');
    let content = `text\n\n[[GVX_TOOL:building:Building%20tool%20call:${encoded}]]\n\ntext2`;

    content = appendToToolCard(content, 'read', 'building', 'Building tool call', '\\nmore');

    const body = extractCardBody(content);
    expect(body).toBe('old\nbody\nmore');
  });

  it('re-appends the card at the end of content for timeline ordering', () => {
    // Existing building card + another tool card after it.
    const encoded = encodeURIComponent('old');
    const content = `start\n\n[[GVX_TOOL:building:Building%20tool%20call:${encoded}]]\n\n[[GVX_TOOL:ok:Tool%20done:Baz]]\n\nend`;

    const result = appendToToolCard(content, 'read', 'building', 'Building tool call', 'new');

    // The building card should now be at the very end, after "end" and the ok card.
    const idx = result.lastIndexOf('[[GVX_TOOL:building:');
    const okIdx = result.lastIndexOf('[[GVX_TOOL:ok:');
    expect(idx).toBeGreaterThan(okIdx);
    expect(result).toMatch(/end\n\n\[\[GVX_TOOL:building:/);
  });

  it('handles multiple old cards of the same state (accumulates all)', () => {
    const enc1 = encodeURIComponent('body1');
    const enc2 = encodeURIComponent('body2');
    const content = `\n\n[[GVX_TOOL:building:Building%20tool%20call:${enc1}]]\n\n\n\n[[GVX_TOOL:building:Building%20tool%20call:${enc2}]]\n\n`;

    const result = appendToToolCard(content, 'x', 'building', 'Building tool call', 'body3');

    expect(countCards(result)).toBe(1);
    const body = extractCardBody(result);
    expect(body).toBe('body1body2body3');
  });

  it('works with update state', () => {
    const result = appendToToolCard('', 'bash', 'update', 'Tool updating: bash', 'partial\noutput');

    const body = extractCardBody(result);
    expect(body).toBe('partial\noutput'); // real newline after encode/decode round-trip
  });
});

// ---------------------------------------------------------------------------
// replaceOrAppendToolCard
// ---------------------------------------------------------------------------

describe('replaceOrAppendToolCard', () => {
  it('creates a new card when none exists', () => {
    const result = replaceOrAppendToolCard('text', 'bash', 'update', 'Tool updating: bash', 'out');
    expect(countCards(result)).toBe(1);
    expect(result.startsWith('text\n\n')).toBe(true);
  });

  it('replaces the last matching card, keeping only one', () => {
    const enc = encodeURIComponent('old');
    const content = `text\n\n[[GVX_TOOL:update:Tool%20updating%3A%20bash:${enc}]]\n\ntext2`;

    const result = replaceOrAppendToolCard(content, 'bash', 'update', 'Tool updating: bash', 'fresh');

    expect(countCards(result)).toBe(1);
    const body = extractCardBody(result);
    expect(body).toBe('fresh');
    // The card should still be at the original position.
    expect(result).toContain('text2');
    expect(result.indexOf('fresh') < result.indexOf('text2')).toBe(true);
  });

  it('replaces only the last match when multiple same-state cards exist', () => {
    const enc1 = encodeURIComponent('first');
    const enc2 = encodeURIComponent('second');
    const content = `\n\n[[GVX_TOOL:update:X:${enc1}]]\n\nmiddle\n\n[[GVX_TOOL:update:X:${enc2}]]\n\n`;

    const result = replaceOrAppendToolCard(content, 'bash', 'update', 'X', 'third');

    // Last card replaced, earlier cards remain.
    expect(countCards(result)).toBe(2);
    // Extract bodies — format is [[GVX_TOOL:state:title:body]]
    const allMarkers = result.match(/\[\[GVX_TOOL:update:[^:]*:([^\]]*)\]\]/g)!;
    const body1 = decodeURIComponent(allMarkers[0].replace(/^\[\[GVX_TOOL:update:[^:]*:/, '').replace(/\]\]$/, ''));
    const body2 = decodeURIComponent(allMarkers[1].replace(/^\[\[GVX_TOOL:update:[^:]*:/, '').replace(/\]\]$/, ''));
    expect(body1).toBe('first');
    expect(body2).toBe('third');
  });
});

// ---------------------------------------------------------------------------
// assistantHasAnswerContent
// ---------------------------------------------------------------------------

describe('assistantHasAnswerContent', () => {
  it('returns false for empty content', () => {
    expect(assistantHasAnswerContent('')).toBe(false);
    expect(assistantHasAnswerContent('   \n  ')).toBe(false);
  });

  it('returns true for non-empty text', () => {
    expect(assistantHasAnswerContent('Hello')).toBe(true);
    expect(assistantHasAnswerContent('  hi  ')).toBe(true);
  });

  it('returns true for non-empty thinking markers', () => {
    expect(assistantHasAnswerContent('[[GVX_THINK:reasoning%20here]]')).toBe(true);
    expect(assistantHasAnswerContent('[[GVX_THINK:]]')).toBe(false);
  });

  it('returns false for tool-only content', () => {
    const body = encodeURIComponent('preview');
    const title = encodeURIComponent('Tool running: write');
    const raw = `[[GVX_TOOL:run:${title}:${body}]]`;
    expect(assistantHasAnswerContent(raw)).toBe(false);
    expect(assistantStreamPlainCharCount(raw)).toBeGreaterThan(0);
  });

  it('returns true when text follows tool markers', () => {
    const body = encodeURIComponent('preview');
    const title = encodeURIComponent('Tool running: write');
    const raw = `[[GVX_TOOL:run:${title}:${body}]]\n\nDone.`;
    expect(assistantHasAnswerContent(raw)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderAssistantContent – tool card HTML
// ---------------------------------------------------------------------------

describe('renderAssistantContent', () => {
  it('wraps only the streaming tail in a fade-in chunk span', () => {
    const raw = 'Hello world';
    const html = renderAssistantContent(raw, true, { streamStableCharCount: 5 });
    expect(html).toContain('ai-chat-stream-chunk');
    expect(html).toContain('world');
    expect(html).not.toMatch(/ai-chat-stream-chunk[^<]*Hello/);
  });

  it('counts plain stream characters without tool marker metadata', () => {
    const body = encodeURIComponent('tool output');
    const raw = `Answer.\n\n[[GVX_TOOL:building:${encodeURIComponent('Building tool call')}:${body}]]\n\n`;
    expect(assistantStreamPlainCharCount(raw)).toBeLessThan(raw.length);
    expect(assistantStreamPlainCharCount(raw)).toBe(
      'Answer.\n\n'.length + '\n\n'.length + 'tool output'.length,
    );
  });

  it('fades newly appended tool building body text', () => {
    const body = encodeURIComponent('alpha');
    const title = encodeURIComponent('Building tool call');
    const raw = `[[GVX_TOOL:building:${title}:${body}]]`;
    const html = renderAssistantContent(raw, true, { streamStableCharCount: 0 });
    expect(html).toContain('ai-chat-stream-chunk');
    expect(html).toContain('alpha');
  });

  it('animates wholly new tool card shells on stream enter', () => {
    const body = encodeURIComponent('args');
    const title = encodeURIComponent('Tool running: read');
    const raw = `[[GVX_TOOL:run:${title}:${body}]]`;
    const priorLen = 'Answer. '.length;
    const html = renderAssistantContent(`Answer. ${raw}`, true, { streamStableCharCount: priorLen });
    expect(html).toContain('ai-chat-stream-enter');
    expect(html).toContain('is-running');
  });

  it('animates wholly new building tool cards on stream enter', () => {
    const body = encodeURIComponent('alpha');
    const title = encodeURIComponent('Building tool call');
    const raw = `[[GVX_TOOL:building:${title}:${body}]]`;
    const html = renderAssistantContent(raw, true, { streamStableCharCount: 0 });
    expect(html).toContain('ai-chat-stream-enter');
    expect(html).toContain('ai-chat-stream-chunk');
  });

  it('renders a building card with title and body', () => {
    const body = encodeURIComponent('building…');
    const title = encodeURIComponent('Building tool call');
    const raw = `[[GVX_TOOL:building:${title}:${body}]]`;

    const html = renderAssistantContent(raw, true);
    expect(html).toContain('is-building');
    expect(html).toContain('Building tool call');
    expect(html).toContain('building…');
    // Scroll wrapper.
    expect(html).toContain('ai-tool-preview__scroll-body');
  });

  it('renders an update card with compact body', () => {
    const body = encodeURIComponent('chunk of output');
    const title = encodeURIComponent('Tool updating: bash');
    const raw = `[[GVX_TOOL:update:${title}:${body}]]`;

    const html = renderAssistantContent(raw, true);
    expect(html).toContain('is-update');
    expect(html).toContain('chunk of output');
    expect(html).toContain('ai-tool-preview__body--compact');
  });

  it('renders a run card', () => {
    const body = encodeURIComponent('args');
    const title = encodeURIComponent('Tool running: read');
    const raw = `[[GVX_TOOL:run:${title}:${body}]]`;

    const html = renderAssistantContent(raw, true);
    expect(html).toContain('is-running');
    expect(html).toContain('args');
  });

  it('renders an ok card', () => {
    const body = encodeURIComponent('result');
    const title = encodeURIComponent('Tool done: read');
    const raw = `[[GVX_TOOL:ok:${title}:${body}]]`;

    const html = renderAssistantContent(raw, false);
    expect(html).toContain('is-success');
    expect(html).toContain('result');
  });

  it('renders an err card', () => {
    const body = encodeURIComponent('fail');
    const title = encodeURIComponent('Tool failed: bash');
    const raw = `[[GVX_TOOL:err:${title}:${body}]]`;

    const html = renderAssistantContent(raw, false);
    expect(html).toContain('is-error');
    expect(html).toContain('fail');
  });

  it('prunes building/running cards when an ok card exists for the same tool', () => {
    const bBody = encodeURIComponent('building…');
    const rBody = encodeURIComponent('args');
    const oBody = encodeURIComponent('done');
    // The building/running titles must include the tool name so
    // pruneSettledRunningCards can match them against the ok card.
    const bTitle = encodeURIComponent('Tool building: read');
    const rTitle = encodeURIComponent('Tool running: read');
    const oTitle = encodeURIComponent('Tool done: read');
    const raw = `[[GVX_TOOL:building:${bTitle}:${bBody}]][[GVX_TOOL:run:${rTitle}:${rBody}]][[GVX_TOOL:ok:${oTitle}:${oBody}]]`;

    const html = renderAssistantContent(raw, false);
    expect(html).toContain('is-success');
    expect(html).not.toContain('is-building');
    expect(html).not.toContain('is-running');
  });

  it('preserves building card when no terminal card exists', () => {
    const bBody = encodeURIComponent('building…');
    const raw = `[[GVX_TOOL:building:Building%20tool%20call:${bBody}]]`;

    const html = renderAssistantContent(raw, true);
    expect(html).toContain('is-building');
  });

  it('renders real newlines in the body of a building card', () => {
    const body = encodeURIComponent('line1\nline2');
    const title = encodeURIComponent('Building tool call');
    const raw = `[[GVX_TOOL:building:${title}:${body}]]`;

    const html = renderAssistantContent(raw, true);
    expect(html).toContain('line1');
    expect(html).toContain('line2');
  });

  it('renders mixed content: text + building card + ok card', () => {
    const bBody = encodeURIComponent('args…');
    const oBody = encodeURIComponent('output');
    const bTitle = encodeURIComponent('Tool building: read');
    const oTitle = encodeURIComponent('Tool done: read');
    const raw = `Hello\n\n[[GVX_TOOL:building:${bTitle}:${bBody}]][[GVX_TOOL:ok:${oTitle}:${oBody}]]\n\nWorld`;

    const html = renderAssistantContent(raw, false);
    expect(html).toContain('is-success');
    // The building card should be pruned.
    expect(html).not.toContain('is-building');
    // Surrounding text preserved.
    expect(html).toContain('Hello');
    expect(html).toContain('World');
  });

  it('escapes HTML special characters in card title and body', () => {
    const body = encodeURIComponent('<script>alert(1)</script>');
    const title = encodeURIComponent('<img onerror=alert(1)>');
    const raw = `[[GVX_TOOL:building:${title}:${body}]]`;

    const html = renderAssistantContent(raw, true);
    // Escaped text is safe: real HTML tags would appear un-escaped.
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    // No raw dangerous tags.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });
});
