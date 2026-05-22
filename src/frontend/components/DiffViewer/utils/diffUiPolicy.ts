/**
 * Diff UI Policy Factory
 * =======================
 *
 * Centralises all feature-flag / label decisions that differ between a normal git
 * diff session and an AI-proposed-edits review session.  Keeping these in one place
 * means the rest of the component tree can be oblivious to the session type — it
 * simply reads from the resolved `DiffUiPolicy` object.
 *
 * ### Default policies
 *
 * | Field                  | Normal git diff        | AI-proposed edits       |
 * |------------------------|------------------------|-------------------------|
 * | `defaultViewMode`      | `'split'`              | `'split'`               |
 * | `showBulkActions`      | `true`                 | `true`                  |
 * | `showSplitInlineActions` | `false`              | `false`                 |
 * | `showRibbonGutter`     | `true`                 | `true`                  |
 * | `labels.acceptAllTitle`| "Accept all changes"   | "Accept all AI changes" |
 * | `labels.rejectAllTitle`| "Reject all changes"   | "Reject all AI changes" |
 * | `labels.acceptRowLeft` | "Accept left"          | "Accept AI"             |
 * | `labels.acceptRowRight`| "Accept right"         | "Reject AI"             |
 *
 * ### Customisation
 *
 * Pass a `preset` to override individual fields without touching the rest.
 * Nested `labels` are merged shallowly — supply only the keys you want to change.
 */

import { DiffUiPolicy } from '../types';

/**
 * Builds the effective {@link DiffUiPolicy} for a diff viewer session.
 *
 * @param args.aiProposedEdits - `true` for AI review sessions: switches the default
 *   view to inline, updates all button labels to use Accept/Reject AI terminology.
 * @param args.preset - Optional partial overrides merged on top of the base policy.
 *   Top-level fields replace the base; `labels` is merged shallowly so you can
 *   override a single label without specifying the others.
 *
 * @returns A fully resolved `DiffUiPolicy` with no undefined fields.
 */
export function buildDiffUiPolicy(args: {
  aiProposedEdits: boolean;
  preset?: Partial<DiffUiPolicy>;
}): DiffUiPolicy {
  const isAi = args.aiProposedEdits;

  // Canonical defaults for each session type
  const base: DiffUiPolicy = isAi
    ? {
        defaultViewMode:       'split',
        showBulkActions:       true,     // Accept all / Reject all buttons in the toolbar
        showSplitInlineActions: false,   // Per-row inline buttons in split view (disabled for AI)
        showRibbonGutter:      true,
        advancedMergeVisualsEnabled: false,
        mergeDiagnosticsEnabled: false,
        maxDecoratedHunks: 500,
        tripleDiffNavBoundaryMode: 'clamp',
        tripleMergePresentation: 'legacy',
        aiDiffPresentation: 'twoPane',
        labels: {
          acceptAllTitle:  'Accept all AI changes',
          rejectAllTitle:  'Reject all AI changes',
          acceptRowLeft:   'Accept AI',   // left = AI proposal in this polarity
          acceptRowRight:  'Reject AI',
        },
      }
    : {
        defaultViewMode:       'split',  // Normal diffs open in side-by-side view
        showBulkActions:       true,
        showSplitInlineActions: false,
        showRibbonGutter:      true,
        advancedMergeVisualsEnabled: false,
        mergeDiagnosticsEnabled: false,
        maxDecoratedHunks: 500,
        tripleDiffNavBoundaryMode: 'clamp',
        tripleMergePresentation: 'legacy',
        aiDiffPresentation: 'twoPane',
        labels: {
          acceptAllTitle:  'Accept all changes',
          rejectAllTitle:  'Reject all changes',
          acceptRowLeft:   'Accept left',
          acceptRowRight:  'Accept right',
        },
      };

  const preset = args.preset;
  if (!preset) return base; // no overrides — return the canonical defaults as-is

  // Merge: spread top-level fields, then shallow-merge labels separately so that
  // passing `preset.labels = { acceptAllTitle: '...' }` doesn't wipe out the other labels.
  return {
    ...base,
    ...preset,
    labels: {
      ...base.labels,
      ...(preset.labels ?? {}),
    },
  };
}
