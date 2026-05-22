import { describe, expect, it } from 'vitest';
import { normalizeForNarration } from '@/frontend/features/listen/normalizeForNarration';

describe('normalizeForNarration', () => {
  it('replaces bare URLs with a spoken placeholder', () => {
    const out = normalizeForNarration('See https://example.com/a?q=1 for more.');
    expect(out).toContain('link');
    expect(out).not.toContain('example.com');
  });
});
