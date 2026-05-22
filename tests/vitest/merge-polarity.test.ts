import { describe, expect, it } from 'vitest';
import { getMergeSideStrategy } from '../../src/frontend/components/DiffViewer/utils/mergePolarity';

describe('mergePolarity', () => {
  it('uses right side as preferred for normal git diffs', () => {
    const strategy = getMergeSideStrategy(false);
    expect(strategy).toEqual({
      topSide: 'left',
      bottomSide: 'right',
      preferredSide: 'right',
      alternateSide: 'left',
    });
  });

  it('uses left side as preferred for AI-proposed edits', () => {
    const strategy = getMergeSideStrategy(true);
    expect(strategy).toEqual({
      topSide: 'right',
      bottomSide: 'left',
      preferredSide: 'left',
      alternateSide: 'right',
    });
  });
});
