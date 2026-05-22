// @vitest-environment jsdom
/**
 * BranchMergeDialog component tests
 * =================================
 *
 * BranchMergeDialog is the modal users see when they click "Merge into branch"
 * on a diff session that does not already have source/target branches set. The
 * dialog fetches the local branch list, populates two selectors, and gates the
 * Apply button until the user picks two distinct branches.
 *
 * The component had no test coverage prior to this file; the C10-C14 rows in
 * the merge editor accept-changes test matrix codify the contract:
 *
 *   C10 — Smart defaults: current branch → target, first other branch → source
 *   C11 — Apply forwards trimmed branch names exactly once
 *   C12 — Apply is disabled when only one branch exists
 *   C13 — Branch list IPC error surfaces in the alert region; Apply stays disabled
 *   C14 — Closing then reopening the dialog refetches the branch list
 *
 * The IPC surface is mocked via `window.electronAPI.invoke` so the tests stay
 * hermetic and do not depend on a real git repository.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BranchMergeDialog } from '../../src/frontend/components/DiffViewer/BranchMergeDialog';

/** Build a branch-list response for the `git-branch-list` IPC. */
function branchListResponse(rows: Array<{ name: string; isCurrent?: boolean }>) {
  return {
    branches: rows.map((row) => ({ name: row.name, isCurrent: row.isCurrent === true })),
  };
}

afterEach(() => {
  delete (window as any).electronAPI;
  vi.restoreAllMocks();
});

describe('BranchMergeDialog branch loading and defaults', () => {
  /**
   * C10 — Smart defaults. Pre-selecting the current branch as the merge target
   * and the first non-current branch as the source matches the common
   * "I'm on main, merging in a feature branch" flow. A regression that
   * pre-selects the same branch on both sides would let the user click Apply
   * and immediately fail the same-branch validation.
   */
  it('pre-selects current branch as target and the first other branch as source', async () => {
    const invoke = vi.fn(async () => branchListResponse([
      { name: 'feature/x' },
      { name: 'main', isCurrent: true },
      { name: 'feature/y' },
    ]));
    (window as any).electronAPI = { invoke };

    render(
      <BranchMergeDialog open repoPath="/repo" onApply={vi.fn()} onCancel={vi.fn()} />,
    );

    const target = await screen.findByLabelText('Target branch') as HTMLSelectElement;
    const source = await screen.findByLabelText('Source branch') as HTMLSelectElement;

    // Wait until the component has finished its async branch load + state update.
    await waitFor(() => {
      expect(target.value).toBe('main');
    });
    expect(source.value).toBe('feature/x');

    // The "Apply" button must be enabled because two distinct branches are selected.
    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
  });

  /**
   * C11 — Clicking Apply forwards the selected branch names to `onApply` exactly
   * once. The branch names should be trimmed (the dialog never re-trims after
   * `onApply`), and the order is `(targetBranch, sourceBranch)` because the
   * caller wires those positionally to `completeBranchMergeSave`.
   */
  it('forwards target and source branches to onApply when clicked', async () => {
    const onApply = vi.fn();
    const invoke = vi.fn(async () => branchListResponse([
      { name: 'main', isCurrent: true },
      { name: 'feature/x' },
    ]));
    (window as any).electronAPI = { invoke };

    render(
      <BranchMergeDialog open repoPath="/repo" onApply={onApply} onCancel={vi.fn()} />,
    );

    await screen.findByLabelText('Target branch');
    await waitFor(() => {
      expect((screen.getByLabelText('Source branch') as HTMLSelectElement).value).toBe('feature/x');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('main', 'feature/x');
  });
});

describe('BranchMergeDialog gating', () => {
  /**
   * C12 — Apply must stay disabled when fewer than two branches exist. The
   * underlying branch-merge save flow rejects same-branch operations, but the
   * UI should surface the issue immediately rather than letting the user click
   * a button that will fail.
   */
  it('disables Apply and shows an error when fewer than two branches exist', async () => {
    const invoke = vi.fn(async () => branchListResponse([{ name: 'main', isCurrent: true }]));
    (window as any).electronAPI = { invoke };

    render(
      <BranchMergeDialog open repoPath="/repo" onApply={vi.fn()} onCancel={vi.fn()} />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/at least two local branches/i);

    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  /**
   * C13 — A git-provider error in the IPC response must surface in the alert
   * region and keep Apply disabled. The error string from the main process is
   * shown verbatim because it already has actionable context (e.g.
   * "Not a git repository").
   */
  it('surfaces IPC errors in the alert region and keeps Apply disabled', async () => {
    const invoke = vi.fn(async () => ({ error: 'Not a git repository' }));
    (window as any).electronAPI = { invoke };

    render(
      <BranchMergeDialog open repoPath="/repo" onApply={vi.fn()} onCancel={vi.fn()} />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Not a git repository');

    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  /**
   * Cancel must call `onCancel` exactly once and never `onApply`. Tested via
   * the explicit Cancel button rather than the overlay click, because pointer
   * coordinates are unreliable in JSDOM.
   */
  it('calls onCancel when the Cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const onApply = vi.fn();
    const invoke = vi.fn(async () => branchListResponse([
      { name: 'main', isCurrent: true },
      { name: 'feature/x' },
    ]));
    (window as any).electronAPI = { invoke };

    render(
      <BranchMergeDialog open repoPath="/repo" onApply={onApply} onCancel={onCancel} />,
    );

    await screen.findByLabelText('Target branch');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('BranchMergeDialog open/close lifecycle', () => {
  /**
   * C14 — Reopening the dialog must trigger a fresh branch-list fetch. Without
   * this guarantee, the user would see a stale branch list after creating or
   * deleting a branch in the meantime. The component achieves this by depending
   * on `open` in its load effect; this test verifies the contract holds.
   */
  it('refetches the branch list each time the dialog reopens', async () => {
    const invoke = vi.fn(async () => branchListResponse([
      { name: 'main', isCurrent: true },
      { name: 'feature/x' },
    ]));
    (window as any).electronAPI = { invoke };

    const { rerender } = render(
      <BranchMergeDialog open repoPath="/repo" onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    await screen.findByLabelText('Target branch');
    expect(invoke).toHaveBeenCalledTimes(1);

    rerender(
      <BranchMergeDialog open={false} repoPath="/repo" onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByLabelText('Target branch')).toBeNull();

    rerender(
      <BranchMergeDialog open repoPath="/repo" onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2);
    });
  });

  it('does not invoke the IPC when repoPath is empty', async () => {
    const invoke = vi.fn(async () => branchListResponse([]));
    (window as any).electronAPI = { invoke };

    render(
      <BranchMergeDialog open repoPath="" onApply={vi.fn()} onCancel={vi.fn()} />,
    );

    // Allow microtasks to drain in case the effect was scheduled.
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });
});
