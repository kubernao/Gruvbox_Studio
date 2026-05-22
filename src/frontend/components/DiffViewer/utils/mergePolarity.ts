/**
 * Merge polarity helpers: determine which diff side maps to "preferred" (accept)
 * vs "alternate" (reject), and how inline stacked blocks are ordered (top/bottom).
 *
 * For normal git diffs: left = old, right = new; preferred side = right (apply new).
 * For AI-proposed edits: left = AI proposal, right = existing user text; preferred side = left (accept AI).
 */

import { DiffSide } from '../types';

/** Describes how the two diff sides are presented and resolved in the merge UI. */
export interface MergeSideStrategy {
  /** The side rendered on top in the inline stacked-change view. */
  topSide: DiffSide;
  /** The side rendered on the bottom in the inline stacked-change view. */
  bottomSide: DiffSide;
  /** The side selected when the user clicks "Accept all" / "Apply bottom". */
  preferredSide: DiffSide;
  /** The side selected when the user clicks "Reject all" / "Keep top". */
  alternateSide: DiffSide;
}

/**
 * Returns the merge side strategy for the current session polarity.
 * @param prefersLeft - True for AI-proposed-edits sessions where accepting means taking the left (AI) side.
 *                      False for normal git diffs where accepting means taking the right (new) side.
 */
export function getMergeSideStrategy(prefersLeft: boolean): MergeSideStrategy {
  if (prefersLeft) {
    return {
      // Existing/user text on top, proposed text on bottom.
      topSide: 'right',
      bottomSide: 'left',
      preferredSide: 'left',
      alternateSide: 'right',
    };
  }
  return {
    topSide: 'left',
    bottomSide: 'right',
    preferredSide: 'right',
    alternateSide: 'left',
  };
}

/** Backwards-compatible alias kept for existing call sites/tests. */
export const getInlineMergePolarity = getMergeSideStrategy;
