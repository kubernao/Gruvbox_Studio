// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { buildPrintableDocumentHtml, printHtmlDocument } from '../../src/frontend/features/editor/printDocument';

describe('printDocument', () => {
  it('renders markdown content to printable html', async () => {
    const html = await buildPrintableDocumentHtml('# Hello world', 'markdown');
    expect(html.toLowerCase()).toContain('<h1');
    expect(html).toContain('Hello world');
  });

  it('falls back to escaped preformatted text for non-markdown', async () => {
    const html = await buildPrintableDocumentHtml('<script>alert(1)</script>', 'plaintext');
    expect(html).toContain('<pre>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('opens a print window and writes html content', () => {
    const write = vi.fn();
    const fakeWindow = {
      document: {
        open: vi.fn(),
        write,
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as never);
    printHtmlDocument('<p>hello</p>', { title: 'Test print' });
    expect(openSpy).toHaveBeenCalled();
    expect(write).toHaveBeenCalled();
    expect(fakeWindow.print).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
