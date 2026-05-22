// @vitest-environment jsdom
/**
 * DiffViewer exit-merge-editor behaviour
 * ======================================
 *
 * Exiting the merge editor (✕ button or "Exit merge editor") must:
 *   1. Reset the modified buffer to the right snapshot — through different sinks
 *      depending on the rendering path.
 *   2. Disengage the Monaco merge-editing flag so the buffer stops behaving as
 *      the merge result.
 *   3. Switch the toolbar back to "Merge into file" and hide the bulk
 *      Accept all / Reject all + Save / Abort cluster.
 *
 *   C7 — two-pane non-AI: setModifiedValue(rightSnapshot) + setMergeEditing(false)
 *   C8 — legacy triple AI: state-driven reset of `mergeResultContent` on MonacoMergePane
 *   C9 — dual-diff triple: state-driven reset on MonacoTripleDiffEditor + toolbar toggles back
 *
 * The Monaco editor handles are mocked the same way as the accept-all suite so
 * the assertions read the routing decisions cleanly.
 */
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DiffViewerProps } from '../../src/frontend/components/DiffViewer/types';

const persistMergeResultMock = vi.fn();
const loadDiffBlobSessionMock = vi.fn();
const fetchRepoFileRevisionMock = vi.fn();

const monacoHandle = {
  setModifiedValue: vi.fn(),
  setMergeEditing: vi.fn(),
  getModifiedValue: vi.fn(() => 'MODIFIED_FROM_TWO_PANE'),
  goToDiff: vi.fn(),
};

let lastMergePaneProps: any = null;
let lastTriplePaneProps: any = null;

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
    lastMergePaneProps = props;
    useEffect(() => {
      props.onResultChange?.('MERGE_PANE_RESULT');
      props.onDiffNavigationMeta?.({ total: 2, activeIndex: 0 });
    }, []);
    return (
      <div data-testid="mock-monaco-merge-pane" data-merge-result={props.mergeResultContent}>
        {props.mergeResultContent}
      </div>
    );
  },
}));

vi.mock('../../src/frontend/components/DiffViewer/MonacoTripleDiffEditor', () => ({
  MonacoTripleDiffEditor: (props: any) => {
    lastTriplePaneProps = props;
    useEffect(() => {
      props.onResultChange?.('TRIPLE_PANE_RESULT');
      props.onDiffNavigationMeta?.({ total: 3, activeIndex: 1 });
    }, []);
    return (
      <div data-testid="mock-monaco-triple-diff" data-merge-result={props.mergeResultContent}>
        {props.mergeResultContent}
      </div>
    );
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

const SNAPSHOT = {
  left: 'LEFT_SNAPSHOT_BYTES',
  right: 'RIGHT_SNAPSHOT_BYTES',
  base: 'BASE_SNAPSHOT_BYTES',
} as const;

describe('DiffViewer exit-merge-editor behaviour', () => {
  beforeAll(async () => {
    const mod = await import('../../src/frontend/components/DiffViewer/DiffViewer');
    DiffViewer = mod.default;
  });

  beforeEach(() => {
    persistMergeResultMock.mockReset();
    loadDiffBlobSessionMock.mockReset();
    fetchRepoFileRevisionMock.mockReset();
    monacoHandle.setModifiedValue.mockClear();
    monacoHandle.setMergeEditing.mockClear();
    lastMergePaneProps = null;
    lastTriplePaneProps = null;

    loadDiffBlobSessionMock.mockResolvedValue({
      leftText: SNAPSHOT.left,
      rightText: SNAPSHOT.right,
    });
    fetchRepoFileRevisionMock.mockResolvedValue({ ok: true, content: SNAPSHOT.base });
    persistMergeResultMock.mockResolvedValue({ ok: true, statusMessage: 'ok' });
  });

  /**
   * C7 — Two-pane non-AI path. Exiting must restore the right snapshot directly
   * into the modified buffer (no React state involved) and turn off the
   * merge-editing flag so the editor stops styling diffs as merge conflicts.
   */
  it('two-pane non-AI: Exit merge editor restores right snapshot through Monaco ref and clears merge-editing', async () => {
    render(<DiffViewer {...buildProps()} />);
    await waitFor(() => expect(screen.getByTestId('mock-monaco-diff-editor')).toBeTruthy());

    fireEvent.click(screen.getByTitle(/Merge into file/i));

    // Inside merge mode, save and abort buttons are present
    expect(screen.getByTitle('Exit merge editor')).toBeTruthy();
    expect(screen.queryByTitle(/Merge into file/i)).toBeNull();

    monacoHandle.setModifiedValue.mockClear();
    monacoHandle.setMergeEditing.mockClear();

    fireEvent.click(screen.getByTitle('Exit merge editor'));

    // The right snapshot is the polarity-correct "rejected merge" state
    expect(monacoHandle.setModifiedValue).toHaveBeenCalledWith(SNAPSHOT.right);
    expect(monacoHandle.setMergeEditing).toHaveBeenCalledWith(false);

    // Toolbar transitions back: Merge into file is visible, Exit merge editor is gone
    await waitFor(() => {
      expect(screen.queryByTitle('Exit merge editor')).toBeNull();
      expect(screen.getByTitle(/Merge into file/i)).toBeTruthy();
    });

    // Bulk Accept all / Reject all only render in merge mode — verify they vanish
    expect(screen.queryByText('Accept all')).toBeNull();
    expect(screen.queryByText('Reject all')).toBeNull();
  });

  /**
   * C8 — Legacy triple AI path. Exit must reset `mergeResultContent` (state-
   * driven) to the right snapshot. Monaco ref is NOT used here because the
   * triple-pane editor reads from props, not from a setter on the ref.
   */
  it('legacy triple AI: Exit merge editor resets mergeResultContent state and leaves Monaco ref untouched', async () => {
    render(
      <DiffViewer
        {...buildProps({
          hashBase: 'base-hash',
          aiProposedEdits: true,
          uiPolicyPreset: { aiDiffPresentation: 'triple', tripleMergePresentation: 'legacy' },
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('mock-monaco-merge-pane')).toBeTruthy());

    fireEvent.click(screen.getByTitle(/Merge into file/i));

    monacoHandle.setModifiedValue.mockClear();
    monacoHandle.setMergeEditing.mockClear();

    fireEvent.click(screen.getByTitle('Exit merge editor'));

    await waitFor(() => {
      expect(lastMergePaneProps?.mergeResultContent).toBe(SNAPSHOT.right);
    });

    // Triple-pane path doesn't go through the two-pane Monaco ref
    expect(monacoHandle.setModifiedValue).not.toHaveBeenCalled();
    expect(monacoHandle.setMergeEditing).not.toHaveBeenCalled();

    // Toolbar transitioned out of merge mode
    await waitFor(() => {
      expect(screen.queryByTitle('Exit merge editor')).toBeNull();
      expect(screen.getByTitle(/Merge into file/i)).toBeTruthy();
    });
  });

  /**
   * C9 — Dual-diff triple. Exit resets the dual-AI merge result back to the
   * right snapshot through the same state path as C8, but the editor in scope
   * is MonacoTripleDiffEditor (not MonacoMergePane). Toolbar transitions are
   * verified again to catch regressions where merge-mode-only buttons leak.
   */
  it('dual-diff triple: Exit merge editor resets MonacoTripleDiffEditor mergeResultContent and toolbar', async () => {
    render(
      <DiffViewer
        {...buildProps({
          hashBase: 'base-hash',
          dualAiMerge: true,
          uiPolicyPreset: { aiDiffPresentation: 'triple', tripleMergePresentation: 'dual-diff' },
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('mock-monaco-triple-diff')).toBeTruthy());

    fireEvent.click(screen.getByTitle(/Merge into file/i));

    // Bulk actions present in merge mode
    expect(screen.getByText('Accept all')).toBeTruthy();
    expect(screen.getByText('Reject all')).toBeTruthy();

    monacoHandle.setModifiedValue.mockClear();
    monacoHandle.setMergeEditing.mockClear();

    fireEvent.click(screen.getByTitle('Exit merge editor'));

    await waitFor(() => {
      expect(lastTriplePaneProps?.mergeResultContent).toBe(SNAPSHOT.right);
    });

    expect(monacoHandle.setModifiedValue).not.toHaveBeenCalled();
    expect(monacoHandle.setMergeEditing).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByTitle('Exit merge editor')).toBeNull();
      expect(screen.getByTitle(/Merge into file/i)).toBeTruthy();
      expect(screen.queryByText('Accept all')).toBeNull();
      expect(screen.queryByText('Reject all')).toBeNull();
    });
  });
});
