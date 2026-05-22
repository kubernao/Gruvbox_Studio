import { describe, expect, it } from 'vitest';
import { extractAiChangedLinesFromUnifiedDiff } from '../../src/frontend/shared/ai/extractAiChangedLinesFromUnifiedDiff';

describe('extractAiChangedLinesFromUnifiedDiff', () => {
  it('collects 1-based new-side line numbers for insertions', () => {
    const diff = `diff --git a/foo.txt b/foo.txt
index 1111111..2222222 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2changed
 line3
+added
`;
    expect(extractAiChangedLinesFromUnifiedDiff(diff)).toEqual([2, 4]);
  });

  it('returns empty array when there are no hunks', () => {
    expect(extractAiChangedLinesFromUnifiedDiff('')).toEqual([]);
  });
});
