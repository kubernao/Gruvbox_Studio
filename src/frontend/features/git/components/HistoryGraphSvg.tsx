import React, { useMemo } from 'react';
import type { WindowedCommitEdge, WindowedCommitRow } from '../utils/windowLaneAllocator';

export interface HistoryGraphSvgProps {
  rows: WindowedCommitRow[];
  edges: WindowedCommitEdge[];
  branchColors: string[];
  commitSpacing: number;
  branchSpacing: number;
  nodeRadius: number;
}

function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  if (Math.abs(x1 - x2) < 0.5) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const bendY = y1 + (y2 - y1) * 0.55;
  return `M ${x1} ${y1} C ${x1} ${bendY} ${x2} ${bendY} ${x2} ${y2}`;
}

export const HistoryGraphSvg: React.FC<HistoryGraphSvgProps> = ({
  rows,
  edges,
  branchColors,
  commitSpacing,
  branchSpacing,
  nodeRadius,
}) => {
  const byHash = useMemo(() => new Map(rows.map((r) => [r.hash, r])), [rows]);
  const maxLane = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.lane), 0),
    [rows],
  );
  const maxRenderedRow = useMemo(() => {
    const fromRows = rows.reduce((m, r) => Math.max(m, r.row), 0);
    const fromEdges = edges.reduce(
      (m, e) => Math.max(m, e.fromRow, e.toRow),
      0,
    );
    return Math.max(fromRows, fromEdges);
  }, [rows, edges]);
  const width = Math.max(48, (maxLane + 1) * branchSpacing + nodeRadius * 10);
  // Rows/edges use global row indices; height must match that coordinate space.
  const height = Math.max(
    1,
    (maxRenderedRow + 1) * commitSpacing + nodeRadius * 12,
  );
  const leftPad = nodeRadius * 4;
  const topPad = nodeRadius * 4;
  const xForLane = (lane: number): number => leftPad + lane * branchSpacing;
  const yForRow = (row: number): number => topPad + row * commitSpacing;

  return (
    <svg className="git-history-window-svg" width={width} height={height}>
      <g className="git-history-window-edges" fill="none" strokeLinecap="round">
        {edges.map((edge) => {
          const from = byHash.get(edge.fromHash);
          const to = byHash.get(edge.toHash);
          if (from === undefined || to === undefined) {
            return null;
          }
          const color = branchColors[Math.abs(edge.fromLane) % branchColors.length] ?? 'var(--text-muted)';
          const x1 = xForLane(edge.fromLane);
          const y1 = yForRow(edge.fromRow);
          const x2 = xForLane(edge.toLane);
          const y2 = yForRow(edge.toRow);
          return (
            <path
              key={`${edge.fromHash}-${edge.toHash}`}
              d={edgePath(x1, y1, x2, y2)}
              stroke={color}
              strokeWidth={2}
            />
          );
        })}
      </g>
      <g className="git-history-window-nodes">
        {rows.map((row) => {
          const color = branchColors[Math.abs(row.lane) % branchColors.length] ?? 'var(--text-muted)';
          const cx = xForLane(row.lane);
          const cy = yForRow(row.row);
          return (
            <g key={row.hash}>
              <circle cx={cx} cy={cy} r={nodeRadius + 2} fill="var(--bg_h)" />
              <circle cx={cx} cy={cy} r={nodeRadius + 1} fill={color} />
            </g>
          );
        })}
      </g>
    </svg>
  );
};
