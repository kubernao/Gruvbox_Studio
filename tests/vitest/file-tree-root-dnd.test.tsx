// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import FileTree from '../../src/frontend/features/explorer/components/FileTree';
import {
  clearCurrentExplorerDragSource,
  setCurrentExplorerDragSource,
} from '../../src/frontend/features/explorer/explorerDragState';

const movePath = vi.fn(async () => '/repo/a.ts');

vi.mock('../../src/frontend/features/explorer/useFileExplorer', () => ({
  useFileExplorer: () => ({
    fileTree: {
      name: 'repo',
      path: '/repo',
      isDirectory: true,
      isExpanded: true,
      children: [],
    },
    rootPath: '/repo',
    isLoading: false,
    error: null,
    createFile: vi.fn(),
    createFolder: vi.fn(),
    movePath,
  }),
}));

vi.mock('../../src/frontend/shared/hooks/useToast', () => ({
  useToast: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
  }),
}));

describe('FileTree root drag and drop', () => {
  beforeEach(() => {
    clearCurrentExplorerDragSource();
    movePath.mockClear();
  });

  it('accepts root drag over using shared drag source state', () => {
    setCurrentExplorerDragSource({ path: '/repo/src/a.ts', isDirectory: false });
    render(<FileTree />);
    const treeRoot = screen.getByText('repo').closest('.file-tree') as HTMLElement;
    const dragOverEvent = createEvent.dragOver(treeRoot);
    Object.defineProperty(dragOverEvent, 'dataTransfer', {
      value: { dropEffect: 'none' },
    });
    const preventDefaultSpy = vi.spyOn(dragOverEvent, 'preventDefault');
    fireEvent(treeRoot, dragOverEvent);
    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
  });

  it('moves item when dropped onto root using shared drag source state', async () => {
    setCurrentExplorerDragSource({ path: '/repo/src/a.ts', isDirectory: false });
    render(<FileTree />);
    const treeRoot = screen.getByText('repo').closest('.file-tree') as HTMLElement;
    const dropEvent = createEvent.drop(treeRoot);
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { getData: () => '' },
    });
    fireEvent(treeRoot, dropEvent);
    await Promise.resolve();
    expect(movePath).toHaveBeenCalledTimes(1);
    expect(movePath).toHaveBeenCalledWith('/repo/src/a.ts', '/repo');
  });
});

