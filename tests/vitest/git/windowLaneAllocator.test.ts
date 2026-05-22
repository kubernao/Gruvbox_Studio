import { describe, expect, it } from 'vitest';
import type { CommitGraphCommit } from '../../../src/frontend/features/git/utils/gitGraphUtils';
import { allocateWindowLanes } from '../../../src/frontend/features/git/utils/windowLaneAllocator';

function mk(sha: string, parents: string[]): CommitGraphCommit {
  return {
    sha,
    commit: {
      author: { name: 't', date: new Date(0) },
      message: sha,
    },
    parents: parents.map((p) => ({ sha: p })),
  };
}

describe('allocateWindowLanes', () => {
  it('reuses lanes when branches end inside window', () => {
    const commits: CommitGraphCommit[] = [
      mk('A', ['B', 'C']),
      mk('X', ['C']),
      mk('B', ['D']),
      mk('C', ['D']),
      mk('D', []),
    ];
    const r = allocateWindowLanes({ commits, startRow: 0, endRow: 4 });
    expect(r.maxLane).toBeLessThanOrEqual(2);
    expect(r.rows.length).toBe(5);
    expect(r.edges.length).toBeGreaterThan(0);
  });

  it('is deterministic for same window input', () => {
    const commits: CommitGraphCommit[] = [mk('A', ['B']), mk('B', ['C']), mk('C', [])];
    const a = allocateWindowLanes({ commits, startRow: 0, endRow: 2 });
    const b = allocateWindowLanes({ commits, startRow: 0, endRow: 2 });
    expect([...a.laneIndexByHash.entries()]).toEqual([...b.laneIndexByHash.entries()]);
  });
});
