// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import { render, waitFor } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import MarkdownCodeMirrorEditor, {
  resolveMarkdownFenceLanguage,
} from '../../src/frontend/features/editor/MarkdownCodeMirrorEditor';
import { markdownMermaidWidget } from '../../src/frontend/features/editor/markdownMermaidWidget';
import MiddleContentHost from '../../src/frontend/features/editor/MiddleContentHost';
import { ThemeProvider } from '../../src/frontend/features/theme/lib';

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

describe('MarkdownCodeMirrorEditor WYSIWYG mask', () => {
  it('uses single-surface markdown editor with no preview button', () => {
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MiddleContentHost, {
          activeDocument: {
            path: 'note.md',
            content: '# Hello',
            language: 'markdown',
            isReadOnly: false,
            pinned: false,
            originalContent: '# Hello',
          },
          onChange: () => {},
        })
      )
    );
    expect(container.querySelector('.markdown-codemirror-root')).toBeTruthy();
    expect(container.textContent ?? '').not.toContain('Preview');
    expect(container.textContent ?? '').not.toContain('Edit');
  });

  it('mounts CodeMirror with the wysiwyg mask class for inactive-line formatting hide', () => {
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: '# Hello',
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    expect(container.querySelector('.markdown-wysiwyg-mask')).toBeTruthy();
    expect(container.querySelector('.markdown-codemirror-root.markdown-wysiwyg-mask')).toBeTruthy();
  });

  it('renders markdown tables with table widgets', () => {
    const tableDoc = [
      '| Name | Role |',
      '| --- | --- |',
      '| Ada | Engineer |',
    ].join('\n');

    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: tableDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    expect(container.querySelector('.cm-table-widget')).toBeTruthy();
    expect(container.querySelector('.cm-table-widget-table')).toBeTruthy();
  });

  it('preserves markdown table source edits through onChange', () => {
    const onChange = vi.fn();
    const tableDoc = [
      '| Name | Role |',
      '| --- | --- |',
      '| Ada | Engineer |',
    ].join('\n');

    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: tableDoc,
          isEditable: true,
          onChange,
        })
      )
    );

    const host = container.querySelector('.markdown-codemirror-root') as
      | (HTMLElement & { gruvboxEditorView?: EditorView })
      | null;
    const view = host?.gruvboxEditorView;
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }

    const current = view.state.doc.toString();
    const updated = current.replace('Engineer', 'Architect');

    view.dispatch({
      changes: { from: 0, to: current.length, insert: updated },
    });

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(updated);
  });

  it('maps mermaid fence language to a CodeMirror language', () => {
    const language = resolveMarkdownFenceLanguage('mermaid');
    expect(language).toBeTruthy();
    expect(language?.name).toBe('mermaid');
  });

  it('maps latex-style fence languages to the latex CodeMirror language', () => {
    const latexLanguage = resolveMarkdownFenceLanguage('latex');
    const texLanguage = resolveMarkdownFenceLanguage('tex');
    const katexLanguage = resolveMarkdownFenceLanguage('katex');

    expect(latexLanguage).toBeTruthy();
    expect(texLanguage).toBeTruthy();
    expect(katexLanguage).toBeTruthy();
  });

  it('does not override unsupported fenced code languages', () => {
    expect(resolveMarkdownFenceLanguage('python')).toBeNull();
  });

  it('renders mermaid blocks inline when their lines are not active', async () => {
    vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
    vi.spyOn(mermaid, 'render').mockResolvedValue({
      svg: '<svg role="img"><g class="node"></g></svg>',
      bindFunctions: () => undefined,
    } as never);

    const mermaidDoc = ['Intro line', '', '```mermaid', 'flowchart LR', 'A --> B', '```'].join('\n');
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: mermaidDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    await waitFor(() => {
      expect(container.querySelector('.cm-mermaid-widget svg')).toBeTruthy();
    });
  });

  it('reveals raw mermaid source when cursor is on the mermaid block', async () => {
    vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
    vi.spyOn(mermaid, 'render').mockResolvedValue({
      svg: '<svg role="img"><g class="node"></g></svg>',
      bindFunctions: () => undefined,
    } as never);

    const mermaidDoc = ['Intro line', '', '```mermaid', 'flowchart LR', 'A --> B', '```'].join('\n');
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: mermaidDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    const host = container.querySelector('.markdown-codemirror-root') as
      | (HTMLElement & { gruvboxEditorView?: EditorView })
      | null;
    const view = host?.gruvboxEditorView;
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }

    await waitFor(() => {
      expect(container.querySelector('.cm-mermaid-widget')).toBeTruthy();
    });

    const blockPos = view.state.doc.toString().indexOf('flowchart LR');
    view.dispatch({
      selection: { anchor: blockPos, head: blockPos },
    });
    view.focus();

    await waitFor(() => {
      expect(container.querySelector('.cm-mermaid-widget')).toBeFalsy();
    });
  });

  it('does not rebuild mermaid decorations when selection moves outside mermaid blocks', async () => {
    vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
    vi.spyOn(mermaid, 'render').mockResolvedValue({
      svg: '<svg role="img"><g class="node"></g></svg>',
      bindFunctions: () => undefined,
    } as never);

    const mermaidDoc = ['Intro line', '', '```mermaid', 'flowchart LR', 'A --> B', '```'].join('\n');
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: mermaidDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    const host = container.querySelector('.markdown-codemirror-root') as
      | (HTMLElement & { gruvboxEditorView?: EditorView })
      | null;
    const view = host?.gruvboxEditorView;
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }

    await waitFor(() => {
      expect(container.querySelector('.cm-mermaid-widget svg')).toBeTruthy();
    });

    const mermaidPlugin = view.plugin(markdownMermaidWidget('dark'));
    expect(mermaidPlugin).toBeTruthy();
    if (!mermaidPlugin) {
      return;
    }

    const dec0 = mermaidPlugin.decorations;
    const line1 = view.state.doc.line(1);
    view.dispatch({ selection: { anchor: line1.from, head: line1.from } });
    const dec1 = mermaidPlugin.decorations;
    view.dispatch({ selection: { anchor: line1.to, head: line1.to } });
    const dec2 = mermaidPlugin.decorations;

    expect(dec0).toBe(dec1);
    expect(dec1).toBe(dec2);
  });

  it('preserves scrollTop when toggling into a mermaid block', async () => {
    vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
    vi.spyOn(mermaid, 'render').mockResolvedValue({
      svg: '<svg role="img"><g class="node"></g></svg>',
      bindFunctions: () => undefined,
    } as never);

    const pad = '\n'.repeat(40);
    const mermaidDoc = ['Intro', pad, '```mermaid', 'flowchart LR', 'A --> B', '```', '', 'Tail'].join('\n');
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: mermaidDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    const host = container.querySelector('.markdown-codemirror-root') as
      | (HTMLElement & { gruvboxEditorView?: EditorView })
      | null;
    const view = host?.gruvboxEditorView;
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }

    await waitFor(() => {
      expect(container.querySelector('.cm-mermaid-widget svg')).toBeTruthy();
    });

    const docStr = view.state.doc.toString();
    const blockPos = docStr.indexOf('flowchart LR');
    const introPos = docStr.indexOf('Intro') + 'Intro'.length;
    expect(blockPos).toBeGreaterThan(0);

    view.dispatch({ selection: { anchor: introPos, head: introPos } });
    await waitFor(() => {
      expect(container.querySelector('.cm-mermaid-widget')).toBeTruthy();
    });

    view.scrollDOM.scrollTop = 120;
    const scrollBefore = view.scrollDOM.scrollTop;

    view.dispatch({ selection: { anchor: blockPos, head: blockPos } });
    await flushMicrotasks();

    expect(view.scrollDOM.scrollTop).toBe(scrollBefore);
  });

  it('renders latex blocks inline when their lines are not active', async () => {
    const latexDoc = ['Intro line', '', '```latex', '\\\\frac{a}{b}', '```'].join('\n');
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: latexDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    await waitFor(() => {
      expect(container.querySelector('.cm-latex-widget .katex')).toBeTruthy();
    });
  });

  it('reveals raw latex source when cursor is on the latex block', async () => {
    const latexDoc = ['Intro line', '', '```latex', '\\\\frac{a}{b}', '```'].join('\n');
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: latexDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    const host = container.querySelector('.markdown-codemirror-root') as
      | (HTMLElement & { gruvboxEditorView?: EditorView })
      | null;
    const view = host?.gruvboxEditorView;
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }

    await waitFor(() => {
      expect(container.querySelector('.cm-latex-widget')).toBeTruthy();
    });

    const blockPos = view.state.doc.toString().indexOf('\\frac{a}{b}');
    view.dispatch({
      selection: { anchor: blockPos, head: blockPos },
    });
    view.focus();

    await waitFor(() => {
      expect(container.querySelector('.cm-latex-widget')).toBeFalsy();
    });
  });

  it('renders inline html snippets as inline widgets on inactive lines', async () => {
    const inlineHtmlDoc = 'This is <mark>highlighted</mark> text.';
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: inlineHtmlDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    await waitFor(() => {
      const widget = container.querySelector('.cm-inline-html-widget mark');
      expect(widget).toBeTruthy();
      expect(widget?.textContent).toBe('highlighted');
    });
  });

  it('renders toolbar-style text-align span as inline html widget with text-align', async () => {
    const alignDoc =
      'Line <span style="display:block;text-align:left;width:100%">aligned text</span> tail.';
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: alignDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    await waitFor(() => {
      const widget = container.querySelector('.cm-inline-html-widget');
      expect(widget).toBeTruthy();
      const inner = widget?.querySelector('span[style*="text-align"]') as HTMLElement | null;
      expect(inner).toBeTruthy();
      expect(inner?.textContent).toBe('aligned text');
      expect(getComputedStyle(inner!).textAlign).toBe('left');
    });
  });

  it('keeps inline html rendered when cursor is on the same line', async () => {
    const inlineHtmlDoc = 'This is <mark>highlighted</mark> text.';
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: inlineHtmlDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    const host = container.querySelector('.markdown-codemirror-root') as
      | (HTMLElement & { gruvboxEditorView?: EditorView })
      | null;
    const view = host?.gruvboxEditorView;
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }

    await waitFor(() => {
      expect(container.querySelector('.cm-inline-html-widget')).toBeTruthy();
    });

    const line = view.state.doc.line(1);
    view.dispatch({ selection: { anchor: line.from, head: line.from } });
    view.focus();

    await waitFor(() => {
      expect(container.querySelector('.cm-inline-html-widget')).toBeTruthy();
    });
  });

  it('blocks executable inline html surfaces in trusted mode', async () => {
    const inlineHtmlDoc = 'Unsafe: <script>alert(1)</script> safe';
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: inlineHtmlDoc,
          isEditable: true,
          onChange: () => {},
        })
      )
    );

    await waitFor(() => {
      expect(container.querySelector('.cm-inline-html-widget')).toBeFalsy();
    });
  });
});
