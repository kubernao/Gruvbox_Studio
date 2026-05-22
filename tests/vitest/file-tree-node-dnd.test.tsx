// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FileTreeNode from '../../src/frontend/features/explorer/components/FileTreeNode';
import {
  clearCurrentExplorerDragSource,
  setCurrentExplorerDragSource,
} from '../../src/frontend/features/explorer/explorerDragState';

const movePath = vi.fn(async (sourcePath: string, targetDirectoryPath: string) =>
  `${targetDirectoryPath}/${sourcePath.split('/').pop() ?? ''}`,
);
const selectFile = vi.fn();
const toggleExpanded = vi.fn();

vi.mock('../../src/frontend/features/explorer/useFileExplorer', () => ({
  useFileExplorer: () => ({
    selectedFile: null,
    selectFile,
    toggleExpanded,
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renameViaSaveDialog: vi.fn(),
    movePath,
    deletePath: vi.fn(),
  }),
}));

vi.mock('../../src/frontend/shared/hooks/useToast', () => ({
  useToast: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

describe('FileTreeNode drag and drop', () => {
  beforeEach(() => {
    clearCurrentExplorerDragSource();
    movePath.mockClear();
    selectFile.mockClear();
    toggleExpanded.mockClear();
  });

  it('accepts drag over using shared drag source state', async () => {
    setCurrentExplorerDragSource({ path: '/repo/src/a.ts', isDirectory: false });
    render(
      <FileTreeNode
        node={{ name: 'dest', path: '/repo/dest', isDirectory: true, isExpanded: true, children: [] }}
        level={0}
      />,
    );

    const row = screen.getByText('dest').closest('.file-tree-node') as HTMLElement;
    const dragOverEvent = createEvent.dragOver(row);
    Object.defineProperty(dragOverEvent, 'dataTransfer', {
      value: { dropEffect: 'none' },
    });
    const preventDefaultSpy = vi.spyOn(dragOverEvent, 'preventDefault');
    fireEvent(row, dragOverEvent);

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(row.className).toContain('drag-over');
    });
  });

  it('moves file on drop when shared drag source is valid', async () => {
    setCurrentExplorerDragSource({ path: '/repo/src/a.ts', isDirectory: false });
    render(
      <FileTreeNode
        node={{ name: 'dest', path: '/repo/dest', isDirectory: true, isExpanded: false, children: [] }}
        level={0}
      />,
    );

    const row = screen.getByText('dest').closest('.file-tree-node') as HTMLElement;
    const dropEvent = createEvent.drop(row);
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { getData: () => '' },
    });

    fireEvent(row, dropEvent);
    await Promise.resolve();

    expect(movePath).toHaveBeenCalledTimes(1);
    expect(movePath).toHaveBeenCalledWith('/repo/src/a.ts', '/repo/dest');
  });
});

