import { describe, expect, it } from 'vitest';
import { sanitizePreviewHtml } from '../../src/frontend/features/editor/markdownPreviewHtml';

describe('sanitizePreviewHtml Mermaid use/symbol', () => {
  it('preserves defs/symbol and use href so node shapes survive sanitization', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><defs><symbol id="foo" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></symbol></defs><use href="#foo" x="0" y="0" width="20" height="20"/><use xlink:href="#foo" x="30" y="0" width="20" height="20"/></svg>`;
    const out = sanitizePreviewHtml(dirty);
    expect(out).toContain('<symbol');
    expect(out).toContain('id="foo"');
    expect(out).toContain('<use');
    expect(out).toContain('href="#foo"');
    expect(out).toMatch(/xlink:href="#foo"|href="#foo"/);
  });
});
