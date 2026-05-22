import { describe, expect, it } from 'vitest';
import { sanitizePreviewHtml } from '../../src/frontend/features/editor/markdownPreviewHtml';

describe('sanitizePreviewHtml Mermaid foreignObject', () => {
  it('preserves xmlns on div inside foreignObject so XHTML labels can render', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject x="0" y="0" width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml" class="nodeLabel">Hi</div></foreignObject></svg>`;
    const out = sanitizePreviewHtml(dirty);
    expect(out).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(out).toContain('Hi');
  });
});
