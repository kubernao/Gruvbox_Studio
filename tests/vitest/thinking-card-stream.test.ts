/**
 * Unit tests for inline thinking timeline markers.
 *
 *   src/frontend/features/assistant/utils/thinkingCardStream.ts
 */
import { describe, it, expect } from 'vitest';
import {
  appendToThinkingCard,
  buildThinkingMarker,
  migrateLegacyThinkingToContent,
} from '../../src/frontend/features/assistant/utils/thinkingCardStream';
import { renderAssistantContent } from '../../src/frontend/shared/ai/aiChatRender';

function extractThinkingBody(content: string): string {
  const m = content.match(/\[\[GVX_THINK:([^\]]*)\]\]/);
  if (!m) {
    throw new Error('No thinking marker found');
  }
  return decodeURIComponent(m[1]);
}

function countThinkingMarkers(content: string): number {
  return (content.match(/\[\[GVX_THINK:/g) || []).length;
}

describe('appendToThinkingCard', () => {
  it('creates a new thinking segment when none exists', () => {
    const result = appendToThinkingCard('Hello', 'reason');
    expect(countThinkingMarkers(result)).toBe(1);
    expect(extractThinkingBody(result)).toBe('reason');
    expect(result.startsWith('Hello')).toBe(true);
  });

  it('accumulates deltas into the trailing thinking segment', () => {
    let content = appendToThinkingCard('', 'part1');
    content = appendToThinkingCard(content, ' part2');
    expect(countThinkingMarkers(content)).toBe(1);
    expect(extractThinkingBody(content)).toBe('part1 part2');
  });

  it('starts a new segment after intervening text', () => {
    let content = appendToThinkingCard('', 'first');
    content += 'answer text';
    content = appendToThinkingCard(content, 'second');
    expect(countThinkingMarkers(content)).toBe(2);
    const bodies = [...content.matchAll(/\[\[GVX_THINK:([^\]]*)\]\]/g)].map((m) =>
      decodeURIComponent(m[1]),
    );
    expect(bodies).toEqual(['first', 'second']);
  });

  it('starts a new segment after a tool card', () => {
    const tool = '\n\n[[GVX_TOOL:run:Tool%20running%3A%20read:args]]\n\n';
    let content = appendToThinkingCard('', 'before tool');
    content += tool;
    content = appendToThinkingCard(content, 'after tool');
    expect(countThinkingMarkers(content)).toBe(2);
    const lastIdx = content.lastIndexOf('[[GVX_THINK:');
    const toolIdx = content.indexOf('[[GVX_TOOL:');
    expect(lastIdx).toBeGreaterThan(toolIdx);
    expect(extractThinkingBody(content.slice(lastIdx))).toBe('after tool');
  });
});

describe('migrateLegacyThinkingToContent', () => {
  it('prepends a marker when legacy thinking exists', () => {
    const result = migrateLegacyThinkingToContent('answer', 'legacy think');
    expect(extractThinkingBody(result)).toBe('legacy think');
    expect(result).toContain('answer');
  });

  it('does not duplicate when markers already exist', () => {
    const withMarker = buildThinkingMarker('inline') + 'answer';
    const result = migrateLegacyThinkingToContent(withMarker, 'legacy');
    expect(countThinkingMarkers(result)).toBe(1);
  });
});

describe('renderAssistantContent thinking timeline', () => {
  it('opens only the bottom-most thinking card while streaming', () => {
    const think1 = encodeURIComponent('plan A');
    const toolTitle = encodeURIComponent('Tool running: read');
    const toolBody = encodeURIComponent('args');
    const think2 = encodeURIComponent('plan B');
    const raw = `[[GVX_THINK:${think1}]][[GVX_TOOL:run:${toolTitle}:${toolBody}]][[GVX_THINK:${think2}]]`;

    const html = renderAssistantContent(raw, true, { streamStableCharCount: 0 });
    const detailsBlocks = [...html.matchAll(/<details class="[^"]*ai-tool-preview--thinking[^"]*"([^>]*)>/g)];
    expect(detailsBlocks).toHaveLength(2);
    expect(detailsBlocks[0][1]).not.toContain('open');
    expect(detailsBlocks[1][1]).toContain('open');
  });

  it('collapses earlier thinking when a tool card is the bottom-most card', () => {
    const think1 = encodeURIComponent('plan A');
    const toolTitle = encodeURIComponent('Tool running: read');
    const toolBody = encodeURIComponent('args');
    const raw = `[[GVX_THINK:${think1}]][[GVX_TOOL:run:${toolTitle}:${toolBody}]]`;

    const html = renderAssistantContent(raw, true, { streamStableCharCount: 0 });
    expect(html).toContain('ai-tool-preview--thinking');
    expect(html).not.toMatch(/<details class="[^"]*ai-tool-preview--thinking[^"]*"\s+open/);
  });

  it('animates wholly new thinking cards on stream enter', () => {
    const think = encodeURIComponent('fresh reasoning');
    const raw = `[[GVX_THINK:${think}]]`;
    const priorLen = 'prior answer. '.length;
    const html = renderAssistantContent(`prior answer. ${raw}`, true, {
      streamStableCharCount: priorLen,
    });
    expect(html).toContain('ai-chat-stream-enter');
    expect(html).toContain('fresh reasoning');
  });

  it('renders thinking before and after a tool card in order', () => {
    const think1 = encodeURIComponent('plan A');
    const toolTitle = encodeURIComponent('Tool running: read');
    const toolBody = encodeURIComponent('args');
    const think2 = encodeURIComponent('plan B');
    const raw = `[[GVX_THINK:${think1}]][[GVX_TOOL:run:${toolTitle}:${toolBody}]][[GVX_THINK:${think2}]]done`;

    const html = renderAssistantContent(raw, false);
    const thinkIdx1 = html.indexOf('ai-tool-preview--thinking');
    const toolIdx = html.indexOf('is-running');
    const thinkIdx2 = html.indexOf('plan B');
    expect(thinkIdx1).toBeGreaterThan(-1);
    expect(toolIdx).toBeGreaterThan(thinkIdx1);
    expect(thinkIdx2).toBeGreaterThan(toolIdx);
    expect(html).toContain('plan A');
    expect(html).toContain('done');
  });
});
