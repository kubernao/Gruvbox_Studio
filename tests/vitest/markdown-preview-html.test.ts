import { beforeEach, describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import { markdownToSafeHtml } from '../../src/frontend/features/editor/markdownPreviewHtml';

describe('markdownToSafeHtml', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders headings and strips script tags', async () => {
    const html = await markdownToSafeHtml('# Hi\n\n<script>alert(1)</script>\n');
    expect(html).toContain('<h1');
    expect(html.toLowerCase()).not.toContain('<script>');
  });

  it('allows basic inline formatting', async () => {
    const html = await markdownToSafeHtml('**bold** and `code`');
    expect(html).toContain('<strong>');
    expect(html).toContain('<code>');
  });

  it('renders Mermaid fences as diagram svg blocks', async () => {
    vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
    vi.spyOn(mermaid, 'render').mockImplementation(async (id: string) => ({
      svg: `<svg id="${id}" role="img"><g class="node"></g></svg>`,
      bindFunctions: () => undefined,
    }) as never);

    const html = await markdownToSafeHtml(
      ['```mermaid', 'flowchart LR', 'A[Start] --> B[Done]', '```'].join('\n'),
      { mermaidTheme: 'default' }
    );
    expect(html).toContain('<svg');
    expect(html).toContain('class="node"');
    expect(html).toMatch(/\bid="gruvbox-docs-mermaid-[0-9a-f]{32}-\d+"/);
  });

  it('shows a non-breaking fallback message for invalid mermaid', async () => {
    vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
    vi.spyOn(mermaid, 'render').mockRejectedValue(new Error('Parse error'));

    const html = await markdownToSafeHtml(
      ['```mermaid', 'flowchart LR', 'A -->', '```'].join('\n'),
      { mermaidTheme: 'default' }
    );
    expect(html).toContain('Mermaid render error');
  });

  it('renders inline and block latex expressions as katex html', async () => {
    const html = await markdownToSafeHtml(
      ['Inline math: $x^2 + y^2 = z^2$', '', '$$\\int_0^1 x^2 dx$$'].join('\n')
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
  });

  it('preserves safe inline html while stripping script tags', async () => {
    const html = await markdownToSafeHtml(
      '<span style="color: #fabd2f">highlight</span><script>alert("bad")</script>'
    );
    expect(html).toContain('<span');
    expect(html.toLowerCase()).not.toContain('<script>');
  });

  it('preserves toolbar-style text-align inline span in preview html', async () => {
    const snippet =
      '<span style="display:block;text-align:left;width:100%">aligned text</span>';
    const html = await markdownToSafeHtml(snippet);
    expect(html.toLowerCase()).toContain('text-align');
    expect(html).toContain('aligned text');
  });

  it('renders rich markdown fixture with table, image, mermaid, and strips iframe', async () => {
    vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
    vi.spyOn(mermaid, 'render').mockImplementation(async (id: string) => ({
      svg: `<svg id="${id}" role="img"><g class="node"></g></svg>`,
      bindFunctions: () => undefined,
    }) as never);

    const markdown = [
      '# Fixture',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '![chart](https://example.com/chart.png)',
      '',
      '```mermaid',
      'flowchart LR',
      'A --> B',
      '```',
      '',
      '<iframe src="https://example.com/embed"></iframe>',
    ].join('\n');
    const html = await markdownToSafeHtml(markdown);
    expect(html).toContain('<table>');
    expect(html).toContain('<img');
    expect(html).toContain('<svg');
    expect(html.toLowerCase()).not.toContain('<iframe');
  });
});
