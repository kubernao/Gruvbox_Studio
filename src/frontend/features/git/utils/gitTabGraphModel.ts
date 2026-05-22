/**
 * Commit DAG in a log slice — which parent links we pass into `commit-graph` import data.
 * Ported from archive `git-tab-graph-model.ts` (field names adapted to `parents`).
 */

import type { GitLogEntry } from '../types/git';

export type GraphEdgeConnectivity =
  | 'none'
  | 'nextRowWhenNoGitParents'
  | 'nextRowWhenNoDisplayedParents';

export const DEFAULT_GRAPH_EDGE_CONNECTIVITY: GraphEdgeConnectivity =
  'nextRowWhenNoGitParents';

export type SyntheticEdgeKind = 'threadNextRow';

export interface SyntheticEdge {
  kind: SyntheticEdgeKind;
  toHash: string;
}

export interface CommitGraphVertex {
  hash: string;
  rawParentHashes: readonly string[];
  displayParents: readonly string[];
  syntheticEdges: readonly SyntheticEdge[];
}

export interface CommitGraphModel {
  readonly entriesNewestFirst: readonly GitLogEntry[];
  readonly hashSet: ReadonlySet<string>;
  readonly vertices: ReadonlyMap<string, CommitGraphVertex>;
  readonly connectivity: GraphEdgeConnectivity;
}

export function importParentHashesForGitgraph(vertex: CommitGraphVertex): string[] {
  if (vertex.displayParents.length > 0) {
    return [...vertex.displayParents];
  }
  for (const e of vertex.syntheticEdges) {
    if (e.kind === 'threadNextRow') {
      return [e.toHash];
    }
  }
  return [];
}

export function buildCommitGraphModel(
  entriesNewestFirst: GitLogEntry[],
  connectivity: GraphEdgeConnectivity = DEFAULT_GRAPH_EDGE_CONNECTIVITY,
): CommitGraphModel {
  const hashSet = new Set(entriesNewestFirst.map((e) => e.hash));
  const n = entriesNewestFirst.length;
  const vertices = new Map<string, CommitGraphVertex>();

  for (let index = 0; index < n; index++) {
    const entry = entriesNewestFirst[index];
    const rawParentHashes = [...(entry.parents ?? [])];
    const displayParents = rawParentHashes.filter((p) => hashSet.has(p));
    const syntheticEdges: SyntheticEdge[] = [];

    const canThread = index + 1 < n;
    const nextHash = canThread ? entriesNewestFirst[index + 1].hash : '';

    if (displayParents.length === 0 && canThread) {
      if (connectivity === 'nextRowWhenNoDisplayedParents') {
        syntheticEdges.push({ kind: 'threadNextRow', toHash: nextHash });
      } else if (
        connectivity === 'nextRowWhenNoGitParents' &&
        rawParentHashes.length === 0
      ) {
        syntheticEdges.push({ kind: 'threadNextRow', toHash: nextHash });
      }
    }

    vertices.set(entry.hash, {
      hash: entry.hash,
      rawParentHashes,
      displayParents,
      syntheticEdges,
    });
  }

  return {
    entriesNewestFirst,
    hashSet,
    vertices,
    connectivity,
  };
}
