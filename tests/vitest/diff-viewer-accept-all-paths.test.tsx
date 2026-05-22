// @vitest-environment jsdom
/**
 * DiffViewer accept-all / reject-all paths
 * ========================================
 *
 * The diff viewer has six rendering paths for the merge editor — chosen by the
 * combination of `hashBase`, `aiProposedEdits`, `dualAiMerge`,
 * `uiPolicy.aiDiffPresentation`, and `uiPolicy.tripleMergePresentation`. Each
 * path resolves "Accept all" and "Reject all" through a different write
 * channel: `setModifiedValue` on the Monaco diff editor for two-pane paths,
 * and a React state mutation that reaches MonacoMergePane / MonacoTripleDiffEditor
 * via the `mergeResultContent` prop for triple-pane paths.
 *
 *   C1 — two-pane non-AI git diff: accept all takes the right (new) side
 *   C2 — two-pane non-AI git diff: reject all takes the left (old) side
 *   C3 — two-pane AI proposal: accept all takes the left (AI) side
 *   C4 — two-pane AI proposal: reject all takes the right (existing) side
 *   C5 — legacy triple AI proposal: accept-all flows through state, not setModifiedValue
 *   C6 — dual-diff triple: accept-all flows through state for the dual-AI merge path
 *
 * The Monaco editor handles are mocked in the same shape as the existing
 * orchestration suite so we cover the same surface but for accept-all polarity
 * specifically. Real Monaco is too heavy to render in JSDOM and would not add
 * coverage anyway — the contract under test is "DiffViewer routes the merge
 * input to the correct downstream sink".
 */
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DiffViewerProps } from '../../src/frontend/components/DiffViewer/types';

const persistMergeResultMock = vi.fn();
const loadDiffBlobSessionMock = vi.fn();
const fetchRepoFileRevisionMock = vi.fn();

/**
 * Shared spy handle for the Monaco diff editor mock. Tests assert against
 * `setModifiedValue` to verify that two-pane paths land the resolved text in
 * the modified buffer rather than going through React state.
 */
const monacoHandle = {
  setModifiedValue: vi.fn(),
  setMergeEditing: vi.fn(),
  getModifiedValue: vi.fn(() => 'MODIFIED_FROM_TWO_PANE'),
  goToDiff: vi.fn(),
};

/**
 * MonacoMergePane mock that exposes the latest `mergeResultContent` prop in a
 * test-id'd `<div>` so triple-mode tests can read the value the parent wrote
 * via state.
 */
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

/** Consistent snapshot bytes so polarity assertions stay readable. */
const SNAPSHOT = {
  left: 'LEFT_SNAPSHOT_BYTES',
  right: 'RIGHT_SNAPSHOT_BYTES',
  base: 'BASE_SNAPSHOT_BYTES',
} as const;

describe('DiffViewer accept-all / reject-all paths', () => {
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

    loadDiffBlobSessionMock.mockImplementation(async (args: any) => {
      if (args?.leftVersionHash === 'right-hash' && args?.rightVersionHash === 'left-hash') {
        return {
          leftText: SNAPSHOT.right,
          rightText: SNAPSHOT.left,
        };
      }
      return {
        leftText: SNAPSHOT.left,
        rightText: SNAPSHOT.right,
      };
    });
    fetchRepoFileRevisionMock.mockResolvedValue({ ok: true, content: SNAPSHOT.base });
    persistMergeResultMock.mockResolvedValue({ ok: true, statusMessage: 'ok' });
  });

  /**
   * C1 — Two-pane non-AI git diff. The user is comparing two normal git revisions.
   * `preferredSide` resolves to `'right'`, so accepting-all means taking the right
   * (newer) side. The text must reach Monaco via `setModifiedValue` because there
   * is no `mergeResultContent` prop on the two-pane editor.
   */
  it('two-pane non-AI: Accept all writes the right snapshot to the modified buffer', async () => {
    render(<DiffViewer {...buildProps()} />);
    await waitFor(() => expect(screen.getByTestId('mock-monaco-diff-editor')).toBeTruthy());

    fireEvent.click(screen.getByTitle(/Merge into file/i));
    fireEvent.click(screen.getByText('Accept all'));

    expect(monacoHandle.setModifiedValue).toHaveBeenLastCalledWith(SNAPSHOT.right);
  });

  /**
   * C2 — Two-pane non-AI git diff: reject-all path.
   * Polarity flip of C1: rejecting-all takes the left (older) side.
   */
  it('two-pane non-AI: Reject all writes the left snapshot to the modified buffer', async () => {
    render(<DiffViewer {...buildProps()} />);
    await waitFor(() => expect(screen.getByTestId('mock-monaco-diff-editor')).toBeTruthy());

    fireEvent.click(screen.getByTitle(/Merge into file/i));
    fireEvent.click(screen.getByText('Reject all'));

    expect(monacoHandle.setModifiedValue).toHaveBeenLastCalledWith(SNAPSHOT.left);
  });

  /**
   * C3 — Two-pane AI proposed edits. With `aiProposedEdits=true` the polarity
   * flips: accepting AI = take the left side (AI proposal). The session uses
   * the two-pane Monaco editor because `aiDiffPresentation` defaults to
   * `'twoPane'`, so the write still goes through `setModifiedValue`.
   */
  it('two-pane AI proposal: Accept all writes the LEFT (AI) snapshot to the modified buffer', async () => {
    render(<DiffViewer {...buildProps({ hashBase: 'base-hash', aiProposedEdits: true })} />);
    await waitFor(() => expect(screen.getByTestId('mock-monaco-diff-editor')).toBeTruthy());

    fireEvent.click(screen.getByTitle(/Merge into file/i));
    fireEvent.click(screen.getByText('Accept all'));

    expect(monacoHandle.setModifiedValue).toHaveBeenLastCalledWith(SNAPSHOT.left);
  });

  /**
   * C4 — Two-pane AI proposal: reject-all path. Polarity flip of C3 — rejecting
   * AI takes the right (user's existing) side.
   */
  it('two-pane AI proposal: Reject all writes the RIGHT (existing) snapshot to the modified buffer', async () => {
    render(<DiffViewer {...buildProps({ hashBase: 'base-hash', aiProposedEdits: true })} />);
    await waitFor(() => expect(screen.getByTestId('mock-monaco-diff-editor')).toBeTruthy());

    fireEvent.click(screen.getByTitle(/Merge into file/i));
    fireEvent.click(screen.getByText('Reject all'));

    expect(monacoHandle.setModifiedValue).toHaveBeenLastCalledWith(SNAPSHOT.right);
  });

  it('AI proposal without base loads the current repo and AI worktree contents', async () => {
    fetchRepoFileRevisionMock.mockImplementation(async (args: any) => {
      if (args?.repoPath === '/repo/.wt') {
        return { ok: true, content: 'AI_WORKTREE_TEXT' };
      }
      if (args?.repoPath === '/repo') {
        return { ok: true, content: 'CURRENT_WORKTREE_TEXT' };
      }
      return { ok: false, reason: 'not_found', error: 'missing' };
    });

    render(
      <DiffViewer
        {...buildProps({
          aiProposedEdits: true,
          aiWorktreePath: '/repo/.wt',
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('mock-monaco-diff-editor')).toBeTruthy());
    expect(screen.getByTestId('mock-monaco-diff-editor').textContent).toBe('AI_WORKTREE_TEXT');
    fireEvent.click(screen.getByTitle(/Merge into file/i));
    fireEvent.click(screen.getByText('Accept all'));
    expect(monacoHandle.setModifiedValue).toHaveBeenLastCalledWith('AI_WORKTREE_TEXT');
  });

  it('two-pane AI proposal without base opens with the AI snapshot in the editable buffer', async () => {
    render(<DiffViewer {...buildProps({ aiProposedEdits: true })} />);
    await waitFor(() => expect(screen.getByTestId('mock-monaco-diff-editor')).toBeTruthy());

    expect(screen.getByTestId('mock-monaco-diff-editor').textContent).toBe(SNAPSHOT.left);
    fireEvent.click(screen.getByTitle(/Merge into file/i));
    fireEvent.click(screen.getByText('Accept all'));

    expect(monacoHandle.setModifiedValue).toHaveBeenLastCalledWith(SNAPSHOT.left);
  });

  /**
   * C5 — Legacy triple AI proposal. With `aiDiffPresentation='triple'` and
   * `tripleMergePresentation='legacy'`, the merge editor renders MonacoMergePane.
   * Accept-all routes through React state because the merge pane reads the
   * resolved text via the `mergeResultContent` prop. We must NOT call
   * `setModifiedValue` on the (unmounted) two-pane editor's ref.
   */
  it('legacy triple AI: Accept all flows through state to MonacoMergePane (no setModifiedValue)', async () => {
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

    const setModifiedCallsBefore = monacoHandle.setModifiedValue.mock.calls.length;
    fireEvent.click(screen.getByText('Accept all'));

    await waitFor(() => {
      expect(lastMergePaneProps?.mergeResultContent).toBe(SNAPSHOT.left);
    });
    // No two-pane editor ref calls allowed in this path
    expect(monacoHandle.setModifiedValue.mock.calls.length).toBe(setModifiedCallsBefore);
  });

  /**
   * C6 — Dual-diff triple. Accept-all in `dualAiMerge` mode (without
   * aiProposedEdits) flows through state to MonacoTripleDiffEditor. The
   * polarity differs from C5: dualAiMerge alone leaves `prefersLeft=false`,
   * so accept-all picks the right side. This is intentional: in a
   * branch-vs-branch dual-AI merge, neither side is "the user's existing
   * code", but the right column is the conventional accept target. Tests
   * document the contract; if product wants the polarity inverted, this is
   * where to update.
   */
  it('dual-diff triple: Accept all routes the right snapshot through state to MonacoTripleDiffEditor', async () => {
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

    // Enter merge mode so the bulk Accept all/Reject all buttons render
    fireEvent.click(screen.getByTitle(/Merge into file/i));

    const setModifiedCallsBefore = monacoHandle.setModifiedValue.mock.calls.length;
    fireEvent.click(screen.getByText('Accept all'));

    await waitFor(() => {
      expect(lastTriplePaneProps?.mergeResultContent).toBe(SNAPSHOT.right);
    });
    expect(monacoHandle.setModifiedValue.mock.calls.length).toBe(setModifiedCallsBefore);
  });
});
