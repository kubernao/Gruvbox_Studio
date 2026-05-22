// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMiddleEditorState } from '../../src/frontend/features/editor/useMiddleEditorState';

describe('useMiddleEditorState', () => {
  it('opens and activates documents while tracking dirty state', () => {
    const { result } = renderHook(() => useMiddleEditorState());

    act(() => {
      result.current.openOrActivateDocument({
        path: 'C:\\notes\\a.md',
        content: '# a',
        language: 'markdown',
        isReadOnly: false,
      });
    });

    expect(result.current.activePath).toBe('C:\\notes\\a.md');
    expect(result.current.openDocuments).toEqual(['C:\\notes\\a.md']);
    expect(result.current.isDirty('C:\\notes\\a.md')).toBe(false);

    act(() => {
      result.current.updateContent('C:\\notes\\a.md', '# a changed');
    });

    expect(result.current.isDirty('C:\\notes\\a.md')).toBe(true);

    act(() => {
      result.current.markSaved('C:\\notes\\a.md', '# a changed');
    });

    expect(result.current.isDirty('C:\\notes\\a.md')).toBe(false);
  });

  it('reorders and closes tabs while preserving valid active tab', () => {
    const { result } = renderHook(() => useMiddleEditorState());

    act(() => {
      result.current.openOrActivateDocument({
        path: 'C:\\notes\\a.md',
        content: 'a',
        language: 'markdown',
        isReadOnly: false,
      });
      result.current.openOrActivateDocument({
        path: 'C:\\notes\\b.md',
        content: 'b',
        language: 'markdown',
        isReadOnly: false,
      });
      result.current.openOrActivateDocument({
        path: 'C:\\notes\\c.md',
        content: 'c',
        language: 'markdown',
        isReadOnly: false,
      });
    });

    act(() => {
      result.current.reorderDocuments([
        'C:\\notes\\c.md',
        'C:\\notes\\a.md',
        'C:\\notes\\b.md',
      ]);
    });

    expect(result.current.openDocuments).toEqual([
      'C:\\notes\\c.md',
      'C:\\notes\\a.md',
      'C:\\notes\\b.md',
    ]);

    act(() => {
      result.current.selectDocument('C:\\notes\\a.md');
      result.current.closeDocument('C:\\notes\\a.md');
    });

    expect(result.current.openDocuments).toEqual([
      'C:\\notes\\c.md',
      'C:\\notes\\b.md',
    ]);
    expect(result.current.activePath).toBe('C:\\notes\\b.md');
  });
});
