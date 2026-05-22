// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DiffViewerProps } from '../../src/frontend/components/DiffViewer/types';

const persistMergeResultMock = vi.fn();
const loadDiffBlobSessionMock = vi.fn();
const fetchRepoFileRevisionMock = vi.fn();

const monacoHandle = {
  modifiedValue: 'MODIFIED_FROM_TWO_PANE',
  setModifiedValue: vi.fn(),
  setMergeEditing: vi.fn(),
  getModifiedValue: vi.fn(() => monacoHandle.modifiedValue),
  goToDiff: vi.fn(),
};

const mergePaneState = {
  latestResult: 'MERGE_PANE_RESULT',
};

const triplePaneState = {
  latestResult: 'TRIPLE_PANE_RESULT',
};
let DiffViewer: React.ComponentType<DiffViewerProps>;

vi.mock('../../src/frontend/components/DiffViewer/utils/diffMergePersistence', () => ({
  persistMergeResult: (...args: unknown[]) => persistMergeResultMock(...args),
}));

vi.mock('../../src/frontend/components/DiffViewer/utils/loadDiffBlobSession', () => ({
  loadDiffBlobSession: (...args: unknown[]) => loadDiffBlobSessionMock(...args),
}));

vi.mock('../../src/frontend/components/DiffViewer/utils/fetchRepoFileRevision', () => ({
  fetchRepoFileRevision: (...args: unknown[]) => fetchRepoFileRevisionMock(...args),
}));

vi.mock('../../src/frontend/components/DiffViewer/MonacoDiffEditor', () => ({
  MonacoDiffEditor: forwardRef((props: any, ref) => {
    useImperativeHandle(ref, () => monacoHandle);
    return <div data-testid="mock-monaco-diff-editor">{props.modifiedText}</div>;
  }),
}));

vi.mock('../../src/frontend/components/DiffViewer/MonacoMergePane', () => ({
  MonacoMergePane: (props: any) => {
    useEffect(() => {
      props.onResultChange?.(mergePaneState.latestResult);
      props.onDiffNavigationMeta?.({ total: 2, activeIndex: 0 });
    }, []);
    return <div data-testid="mock-monaco-merge-pane">{props.mergeResultContent}</div>;
  },
}));

vi.mock('../../src/frontend/components/DiffViewer/MonacoTripleDiffEditor', () => ({
  MonacoTripleDiffEditor: (props: any) => {
    useEffect(() => {
      props.onResultChange?.(triplePaneState.latestResult);
      props.onDiffNavigationMeta?.({ total: 3, activeIndex: 1 });
    }, []);
    return <div data-testid="mock-monaco-triple-diff">{props.mergeResultContent}</div>;
  },
}));

function buildProps(overrides: Partial<DiffViewerProps> = {}): DiffViewerProps {
  return {
    repoPath: '/repo',
    filePath: 'src/app.ts',
    hash1: 'left-hash',
    hash2: 'right-hash',
    onClose: vi.fn(),
    ...overrides,
  };
}

/**
 * This suite verifies DiffViewer save orchestration contracts: each rendering
 * path must route save content from the authoritative buffer and preserve merge
 * reset and polarity behavior across policy transitions.
 */
describe('DiffViewer orchestration', () => {
  beforeAll(async () => {
    const module = await import('../../src/frontend/components/DiffViewer/DiffViewer');
    DiffViewer = module.default;
  });

  beforeEach(() => {
    persistMergeResultMock.mockReset();
    loadDiffBlobSessionMock.mockReset();
    fetchRepoFileRevisionMock.mockReset();
    monacoHandle.modifiedValue = 'MODIFIED_FROM_TWO_PANE';
    monacoHandle.setModifiedValue.mockClear();
    monacoHandle.setMergeEditing.mockClear();
    monacoHandle.getModifiedValue.mockClear();
    loadDiffBlobSessionMock.mockResolvedValue({
      leftText: 'LEFT_SNAPSHOT',
      rightText: 'RIGHT_SNAPSHOT',
    });
    fetchRepoFileRevisionMock.mockResolvedValue({
      ok: true,
      content: 'BASE_SNAPSHOT',
    });
    persistMergeResultMock.mockResolvedValue({
      ok: true,
      statusMessage: 'ok',
    });
  });

  it('saves from modified model in two-pane paths (A/B)', async () => {
    render(<DiffViewer {...buildProps({ hashBase: 'base-hash', aiProposedEdits: true })} />);
    await waitFor(() => expect(screen.getByTestId('mock-monaco-diff-editor')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only'));
    fireEvent.click(document.querySelector('.diff-save-result-btn--merge-mode') as Element);

    await waitFor(() => expect(persistMergeResultMock).toHaveBeenCalledTimes(1));
    expect(persistMergeResultMock.mock.calls[0][0].mergedContent).toBe('MODIFIED_FROM_TWO_PANE');
  });

  it('saves from merge-result state in legacy and dual-diff triple paths (C/D)', async () => {
    const { rerender } = render(
      <DiffViewer
        {...buildProps({
          hashBase: 'base-hash',
          aiProposedEdits: true,
          uiPolicyPreset: { aiDiffPresentation: 'triple', tripleMergePresentation: 'legacy' },
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('mock-monaco-merge-pane')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only'));
    fireEvent.click(document.querySelector('.diff-save-result-btn--merge-mode') as Element);
    await waitFor(() => expect(persistMergeResultMock).toHaveBeenCalledTimes(1));
    expect(persistMergeResultMock.mock.calls[0][0].mergedContent).toBe('MERGE_PANE_RESULT');

    persistMergeResultMock.mockClear();
    rerender(
      <DiffViewer
        {...buildProps({
          hashBase: 'base-hash',
          dualAiMerge: true,
          uiPolicyPreset: { aiDiffPresentation: 'triple', tripleMergePresentation: 'dual-diff' },
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('mock-monaco-triple-diff').textContent).toBe('TRIPLE_PANE_RESULT'),
    );
    fireEvent.click(document.querySelector('.diff-save-result-btn--merge-mode') as Element);
    await waitFor(() => expect(persistMergeResultMock).toHaveBeenCalledTimes(1));
    expect(persistMergeResultMock.mock.calls[0][0].mergedContent).toBe('TRIPLE_PANE_RESULT');
  });

  it('resets merge buffer on exit and enforces polarity for accept/reject all', async () => {
    render(<DiffViewer {...buildProps({ aiProposedEdits: true })} />);
    await waitFor(() => expect(screen.getByTestId('mock-monaco-diff-editor')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Merge into file — Resolve in the editor and save the merged text to the working tree file only'));
    fireEvent.click(screen.getByText('Accept all'));
    expect(monacoHandle.setModifiedValue).toHaveBeenLastCalledWith('RIGHT_SNAPSHOT');

    fireEvent.click(screen.getByText('Reject all'));
    expect(monacoHandle.setModifiedValue).toHaveBeenLastCalledWith('LEFT_SNAPSHOT');

    fireEvent.click(screen.getByTitle('Exit merge editor'));
    expect(monacoHandle.setModifiedValue).toHaveBeenLastCalledWith('RIGHT_SNAPSHOT');
    expect(monacoHandle.setMergeEditing).toHaveBeenCalledWith(false);
  });
});
