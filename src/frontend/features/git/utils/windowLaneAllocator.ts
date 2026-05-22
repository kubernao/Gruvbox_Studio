import type { CommitGraphCommit } from './gitGraphUtils';

export interface WindowedCommitRow {
  hash: string;
  lane: number;
  row: number;
}

export interface WindowedCommitEdge {
  fromHash: string;
  toHash: string;
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
}

export interface WindowLaneAllocationResult {
  rows: WindowedCommitRow[];
  edges: WindowedCommitEdge[];
  laneIndexByHash: Map<string, number>;
  maxLane: number;
}

export interface WindowLaneAllocatorInput {
  commits: CommitGraphCommit[];
  startRow: number;
  endRow: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Assign lanes for a windowed commit slice, reusing dead lanes aggressively.
 * Rows are expected newest-first (`row = index`).
 */
export function allocateWindowLanes(
  input: WindowLaneAllocatorInput,
): WindowLaneAllocationResult {
  const total = input.commits.length;
  if (total === 0) {
    return { rows: [], edges: [], laneIndexByHash: new Map(), maxLane: -1 };
  }

  const start = clamp(input.startRow, 0, total - 1);
  const end = clamp(input.endRow, start, total - 1);
  const windowCommits = input.commits.slice(start, end + 1);

  const rowByHash = new Map<string, number>();
  for (let i = 0; i < windowCommits.length; i++) {
    rowByHash.set(windowCommits[i].sha, start + i);
  }

  const childrenByHash = new Map<string, string[]>();
  for (const c of windowCommits) {
    for (const p of c.parents) {
      if (!rowByHash.has(p.sha)) continue;
      const list = childrenByHash.get(p.sha);
      if (list !== undefined) {
        list.push(c.sha);
      } else {
        childrenByHash.set(p.sha, [c.sha]);
      }
    }
  }

  const laneIndexByHash = new Map<string, number>();
  const laneBusyUntilRow = new Map<number, number>();
  const freeLanes: number[] = [];
  let nextLane = 0;
  let maxLane = -1;

  const takeFreeLane = (currentRow: number): number => {
    for (let i = 0; i < freeLanes.length; i++) {
      const lane = freeLanes[i];
      const busyUntil = laneBusyUntilRow.get(lane) ?? -1;
      if (busyUntil < currentRow) {
        freeLanes.splice(i, 1);
        return lane;
      }
    }
    const lane = nextLane;
    nextLane += 1;
    return lane;
  };

  // Process newest -> oldest so older commits can keep child lane continuity.
  for (let i = start; i <= end; i++) {
    const c = input.commits[i];
    const children = childrenByHash.get(c.sha) ?? [];

    const firstParentChildrenLanes: number[] = [];
    const otherChildrenLanes: number[] = [];
    for (const childHash of children) {
      const lane = laneIndexByHash.get(childHash);
      if (lane === undefined) continue;
      const child = input.commits[rowByHash.get(childHash)!];
      const childFirstParent = child.parents[0]?.sha;
      if (childFirstParent === c.sha) {
        firstParentChildrenLanes.push(lane);
      } else {
        otherChildrenLanes.push(lane);
      }
    }

    let lane = -1;
    if (firstParentChildrenLanes.length > 0) {
      lane = Math.min(...firstParentChildrenLanes);
    } else if (otherChildrenLanes.length > 0) {
      lane = Math.min(...otherChildrenLanes);
    } else {
      lane = takeFreeLane(i);
    }

    laneIndexByHash.set(c.sha, lane);
    maxLane = Math.max(maxLane, lane);

    const parentRows = c.parents
      .map((p) => rowByHash.get(p.sha))
      .filter((v): v is number => v !== undefined);
    const laneEnd = parentRows.length > 0 ? Math.max(...parentRows) : i;
    laneBusyUntilRow.set(lane, laneEnd);
    if (!freeLanes.includes(lane)) {
      freeLanes.push(lane);
      freeLanes.sort((a, b) => a - b);
    }
  }

  const rows: WindowedCommitRow[] = [];
  const edges: WindowedCommitEdge[] = [];
  for (let i = start; i <= end; i++) {
    const c = input.commits[i];
    const lane = laneIndexByHash.get(c.sha);
    if (lane === undefined) continue;
    rows.push({ hash: c.sha, lane, row: i });
    for (const p of c.parents) {
      const parentRow = rowByHash.get(p.sha);
      if (parentRow === undefined) continue;
      const parentLane = laneIndexByHash.get(p.sha);
      if (parentLane === undefined) continue;
      edges.push({
        fromHash: c.sha,
        toHash: p.sha,
        fromLane: lane,
        toLane: parentLane,
        fromRow: i,
        toRow: parentRow,
      });
    }
  }

  return { rows, edges, laneIndexByHash, maxLane };
}
