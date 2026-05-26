/**
 * Small layout helpers shared between the windowed SVG graph overlay and the
 * full CommitGraph fallback when lane allocation fails.
 */

/**
 * Label for a commit’s row in the rendered graph (row 0 = top / newest in this layout).
 */
export function commitRowRelativeLabel(rowIndex: number): string {
  if (rowIndex <= 0) {
    return 'Current';
  }
  if (rowIndex === 1) {
    return '1 Back';
  }
  return `${rowIndex} Back`;
}

/**
 * Vertical center of a commit dot for hover hit-testing and overlay alignment.
 * Must stay in sync with `graphStyle` spacing in CommitGraphRenderer.
 */
export function commitGraphDotCenterY(
  commitSpacing: number,
  nodeRadius: number,
  rowIndex: number,
): number {
  return commitSpacing * rowIndex + nodeRadius * 4;
}
