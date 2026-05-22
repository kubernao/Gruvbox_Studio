// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import MarkdownCodeMirrorEditor from '../../src/frontend/features/editor/MarkdownCodeMirrorEditor';
import { ThemeProvider } from '../../src/frontend/features/theme/lib';
import { createCommentFromSelection } from '../../src/frontend/features/editor/commentsExtension';
import { toggleSuggestMode } from '../../src/frontend/features/editor/suggestChangesExtension';

function getView(container: HTMLElement): EditorView | null {
  const host = container.querySelector('.markdown-codemirror-root') as
    | (HTMLElement & { gruvboxEditorView?: EditorView })
    | null;
  return host?.gruvboxEditorView ?? null;
}

describe('editor review extensions', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const mockStorage: Storage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    };
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      configurable: true,
    });
    window.localStorage.setItem('gruvbox-editor-comments', '1');
    window.localStorage.setItem('gruvbox-editor-suggest', '1');
    window.localStorage.setItem('gruvbox-editor-collab', '0');
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('creates anchored comment decorations from selection', async () => {
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          docId: 'test-comments',
          content: 'Alpha Beta Gamma',
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

    const from = view.state.doc.toString().indexOf('Beta');
    const to = from + 'Beta'.length;
    view.dispatch({ selection: { anchor: from, head: to } });
    expect(createCommentFromSelection(view)).toBe(true);

    await waitFor(() => {
      expect(container.querySelector('.cm-comment-badge')).toBeTruthy();
      expect(container.querySelector('.cm-comment-anchor')).toBeTruthy();
    });
  });

  it('captures typed changes as pending suggestions in suggest mode', async () => {
    const { container } = render(
      React.createElement(
        ThemeProvider,
        { initialTheme: 'dark' },
        React.createElement(MarkdownCodeMirrorEditor, {
          docId: 'test-suggest',
          content: 'Hello world',
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

    expect(toggleSuggestMode(view)).toBe(true);
    const startDoc = view.state.doc.toString();
    const insertAt = startDoc.length;
    view.dispatch({ changes: { from: insertAt, to: insertAt, insert: '!' } });

    expect(view.state.doc.toString()).toBe(startDoc);
    await waitFor(() => {
      const insertPreview = container.querySelector('.cm-suggest-insert');
      expect(insertPreview).toBeTruthy();
      expect(insertPreview?.textContent).toContain('!');
    });
  });
});
