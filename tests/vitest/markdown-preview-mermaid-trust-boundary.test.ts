import { beforeEach, describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import { createMermaidRenderId, markdownToSafeHtml } from '../../src/frontend/features/editor/markdownPreviewHtml';

describe('Mermaid export trust boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls mermaid.render with an id that includes a 32-hex nonce and diagram index', async () => {
    vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
    const renderSpy = vi.spyOn(mermaid, 'render').mockImplementation(async (id: string) => ({
      svg: `<svg id="${id}"><g></g></svg>`,
      bindFunctions: () => undefined,
    }) as never);

    await markdownToSafeHtml(['```mermaid', 'flowchart LR', 'A --> B', '```'].join('\n'));

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const id = renderSpy.mock.calls[0][0] as string;
    expect(id).toMatch(/^gruvbox-docs-mermaid-[0-9a-f]{32}-\d+$/);
  });

  it('createMermaidRenderId matches main-process raster id contract', () => {
    const nonce = '0'.repeat(32);
    expect(createMermaidRenderId(nonce, 3)).toBe(`gruvbox-docs-mermaid-${nonce}-3`);
  });

  it('still renders diagram when markdown also contains a legacy-looking svg id string', async () => {
    vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
    vi.spyOn(mermaid, 'render').mockImplementation(async (id: string) => ({
      svg: `<svg id="${id}"><g class="real"></g></svg>`,
      bindFunctions: () => undefined,
    }) as never);

    const html = await markdownToSafeHtml(
      [
        'Text mentioning gruvbox-docs-mermaid-0 in prose.',
        '',
        '```mermaid',
        'flowchart LR',
        'A --> B',
        '```',
      ].join('\n')
    );
    expect(html).toContain('class="real"');
    expect(html).toMatch(/\bid="gruvbox-docs-mermaid-[0-9a-f]{32}-0"/);
  });
});
