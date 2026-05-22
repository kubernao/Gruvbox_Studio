import { describe, expect, it } from 'vitest';
import {
  chunkTextForSpeechUtterances,
  extractSpeakableText,
  isMarkdownLikeLanguage,
  markdownToSpeakablePlainText,
} from '@/frontend/features/listen/extractSpeakableText';

describe('extractSpeakableText', () => {
  it('flattens markdown links and skips fenced code', () => {
    const md = '# Hello\n\nSee [docs](https://x.com).\n\n```js\nnoop()\n```\n\nDone.';
    expect(markdownToSpeakablePlainText(md)).toMatch(/Hello/);
    expect(markdownToSpeakablePlainText(md)).toMatch(/docs/);
    expect(markdownToSpeakablePlainText(md)).not.toMatch(/noop/);
  });

  it('recognizes markdown languages', () => {
    expect(isMarkdownLikeLanguage('markdown')).toBe(true);
    expect(isMarkdownLikeLanguage('MDX')).toBe(true);
    expect(isMarkdownLikeLanguage('typescript')).toBe(false);
  });

  it('extractSpeakableText uses markdown path for md', () => {
    const out = extractSpeakableText({
      content: '`code` and **bold**',
      language: 'markdown',
    });
    expect(out).toContain('code');
    expect(out).toContain('bold');
    expect(out).not.toContain('**');
  });

  it('chunks paragraphs without dropping short sections', () => {
    const chunks = chunkTextForSpeechUtterances('A\n\nB\n\nC', 8000);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join(' ')).toMatch(/A/);
  });
});
