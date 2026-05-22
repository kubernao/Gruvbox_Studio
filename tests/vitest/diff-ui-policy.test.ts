import { describe, expect, it } from 'vitest';
import { buildDiffUiPolicy } from '../../src/frontend/components/DiffViewer/utils/diffUiPolicy';

describe('diff ui policy', () => {
  it('builds AI policy defaults', () => {
    const policy = buildDiffUiPolicy({ aiProposedEdits: true });
    expect(policy.defaultViewMode).toBe('split');
    expect(policy.showBulkActions).toBe(true);
    expect(policy.showRibbonGutter).toBe(true);
    expect(policy.tripleMergePresentation).toBe('legacy');
    expect(policy.aiDiffPresentation).toBe('twoPane');
    expect(policy.labels.acceptRowLeft).toBe('Accept AI');
  });

  it('builds VC policy defaults', () => {
    const policy = buildDiffUiPolicy({ aiProposedEdits: false });
    expect(policy.defaultViewMode).toBe('split');
    expect(policy.showBulkActions).toBe(true);
    expect(policy.showRibbonGutter).toBe(true);
    expect(policy.tripleMergePresentation).toBe('legacy');
    expect(policy.aiDiffPresentation).toBe('twoPane');
  });

  it('applies policy presets without losing base labels', () => {
    const policy = buildDiffUiPolicy({
      aiProposedEdits: true,
      preset: {
        showBulkActions: false,
        labels: {
          acceptAllTitle: 'Use all suggested edits',
          rejectAllTitle: 'Drop all suggested edits',
          acceptRowLeft: 'Use suggestion',
          acceptRowRight: 'Keep current',
        },
      },
    });
    expect(policy.showBulkActions).toBe(false);
    expect(policy.labels.acceptAllTitle).toBe('Use all suggested edits');
    expect(policy.labels.acceptRowRight).toBe('Keep current');
  });
});
