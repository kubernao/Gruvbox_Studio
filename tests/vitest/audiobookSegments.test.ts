import { describe, expect, it } from 'vitest';
import {
  buildAudiobookSegments,
  splitMarkdownByHeadings,
  splitOversizedPlainText,
} from '@/frontend/features/listen/audiobookSegments';

describe('audiobookSegments', () => {
  it('splitMarkdownByHeadings separates sections', () => {
    const md = '# One\n\nalpha\n\n## Two\n\nbeta';
    const blocks = splitMarkdownByHeadings(md);
    expect(blocks.length).toBe(2);
    expect(blocks[0].title).toBe('One');
    expect(blocks[0].bodyRaw).toContain('alpha');
    expect(blocks[1].title).toBe('Two');
  });

  it('buildAudiobookSegments uses chapters for markdown', () => {
    const segs = buildAudiobookSegments({
      rawContent: '# A\n\nHello.\n\n# B\n\nWorld.',
      language: 'markdown',
      splitMode: 'chapters',
      maxChars: 4096,
    });
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0].text).toMatch(/Hello/i);
  });

  it('splitOversizedPlainText splits long prose', () => {
    const long = `${'word '.repeat(3000)}end`;
    const parts = splitOversizedPlainText(long, 4096);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p) => {
      expect(p.length).toBeLessThanOrEqual(4096);
    });
  });
});
