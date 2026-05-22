// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { deleteCharBackward } from '@codemirror/commands';
import MarkdownCodeMirrorEditor from '../../src/frontend/features/editor/MarkdownCodeMirrorEditor';
import { ThemeProvider } from '../../src/frontend/features/theme/lib';
import { tryStripMarkdownDecoratorPair } from '../../src/frontend/features/editor/markdownDecoratorAtomics';

function getView(container: HTMLElement): EditorView | null {
  const host = container.querySelector('.markdown-codemirror-root') as
    | (HTMLElement & { gruvboxEditorView?: EditorView })
    | null;
  return host?.gruvboxEditorView ?? null;
}

describe('markdownDecoratorAtomics', () => {
  it('deleteCharBackward from end of strong removes closing ** in one step', () => {
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: '**b**',
          isEditable: true,
          onChange: () => {},
        })
      )
    );
    const view = getView(container);
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }
    view.dispatch({ selection: { anchor: 5, head: 5 } });
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe('**b');
  });

  it('cleans up empty link when label is deleted (merged delete transaction)', () => {
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: '[x](u)',
          isEditable: true,
          onChange: () => {},
        })
      )
    );
    const view = getView(container);
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }
    const doc = view.state.doc.toString();
    const x = doc.indexOf('x');
    view.dispatch({
      changes: { from: x, to: x + 1, insert: '' },
      selection: { anchor: x, head: x },
      userEvent: 'delete.selection',
    });
    expect(view.state.doc.toString()).toBe('');
  });

  it('cleans up heading when title text is removed', () => {
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
    const view = getView(container);
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }
    const doc = view.state.doc.toString();
    const h = doc.indexOf('Hello');
    view.dispatch({
      changes: { from: h, to: h + 'Hello'.length, insert: '' },
      selection: { anchor: h, head: h },
      userEvent: 'delete.selection',
    });
    expect(view.state.doc.toString()).toBe('');
  });

  it('rejects point inserts strictly inside a decorator mark', () => {
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: '**bold**',
          isEditable: true,
          onChange: () => {},
        })
      )
    );
    const view = getView(container);
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }
    const before = view.state.doc.toString();
    view.dispatch({
      changes: { from: 1, to: 1, insert: 'X' },
      userEvent: 'input.type',
    });
    expect(view.state.doc.toString()).toBe(before);
  });

  it('strips strong marks via tryStripMarkdownDecoratorPair', () => {
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          content: '**hello**',
          isEditable: true,
          onChange: () => {},
        })
      )
    );
    const view = getView(container);
    expect(view).toBeTruthy();
    if (!view) {
      return;
    }
    const inner = view.state.doc.toString().indexOf('hello') + 2;
    view.dispatch({ selection: { anchor: inner, head: inner } });
    expect(tryStripMarkdownDecoratorPair(view, 'strong')).toBe(true);
    expect(view.state.doc.toString()).toBe('hello');
  });
});
