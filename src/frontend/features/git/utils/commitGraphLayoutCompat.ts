/**
 * Layout logic mirrored from `commit-graph` (MIT) — row order and Y indices for overlay cells.
 * @see https://github.com/liuliu-dev/CommitGraph
 */

import type { CommitGraphCommit } from './gitGraphUtils';

export interface CommitNode {
  hash: string;
  children: string[];
  parents: string[];
  committer: string;
  commitDate: Date;
  message?: string;
  x: number;
  y: number;
  commitColor: string;
  commitLink?: string;
  onCommitNavigate?: () => void;
}

export interface BranchPathType {
  start: number;
  end: number;
  endCommitHash: string;
  endCommit?: CommitNode;
  color?: string;
  branchOrder: number;
}

function formatCommits(commits: CommitGraphCommit[]): CommitNode[] {
  const childrenMap = new Map<string, string[]>();
  commits.forEach((commit) => {
    commit.parents.forEach((parent) => {
      const list = childrenMap.get(parent.sha);
      if (list !== undefined) {
        list.push(commit.sha);
      } else {
        childrenMap.set(parent.sha, [commit.sha]);
      }
    });
  });
  return commits.map((commit) => ({
    hash: commit.sha,
    parents: commit.parents.map((p) => p.sha),
    children: childrenMap.get(commit.sha) ?? [],
    committer: commit.commit.author.name,
    message: commit.commit.message,
    commitDate: new Date(commit.commit.author.date),
    commitLink: undefined,
    onCommitNavigate: undefined,
    commitColor: '',
    x: -1,
    y: -1,
  }));
}

function topologicalOrderCommits(
  commits: CommitNode[],
  commitsMap: Map<string, CommitNode>,
): string[] {
  const commitsSortByCommitterDate = commits.sort(
    (a, b) => b.commitDate.getTime() - a.commitDate.getTime(),
  );

  const sortedCommits: string[] = [];
  const seen = new Map<string, boolean>();

  function dfs(commit: CommitNode): void {
    const commitHash = commit.hash;
    if (seen.get(commitHash)) {
      return;
    }
    seen.set(commitHash, true);
    commit.children.forEach((child) => {
      const node = commitsMap.get(child);
      if (node !== undefined) {
        dfs(node);
      }
    });
    sortedCommits.push(commitHash);
  }

  commitsSortByCommitterDate.forEach((commit) => {
    dfs(commit);
  });

  return sortedCommits;
}

function computeColumns(
  orderedCommitHashes: string[],
  commitsMap: Map<string, CommitNode>,
): { columns: BranchPathType[][]; commitsMapWithPos: Map<string, CommitNode> } {
  const commitsMapWithPos = new Map<string, CommitNode>();
  orderedCommitHashes.forEach((commitHash, index) => {
    commitsMapWithPos.set(commitHash, {
      ...commitsMap.get(commitHash),
      y: index,
    } as CommitNode);
  });

  const columns: BranchPathType[][] = [];
  const commitXs = new Map<string, number>();

  function updateColumnEnd(col: number, end: number, endCommitHash: string): void {
    columns[col][columns[col].length - 1] = {
      ...columns[col][columns[col].length - 1],
      end,
      endCommitHash,
    };
  }

  let branchOrder = 0;

  orderedCommitHashes.forEach((commitHash, index) => {
    const commit = commitsMap.get(commitHash)!;

    const branchChildren = commit.children.filter(
      (child) => commitsMap.get(child)!.parents[0] === commit.hash,
    );

    const isLastCommitOnBranch = commit.children.length === 0;
    const isBranchOutCommit = branchChildren.length > 0;

    let commitX = -1;

    const isFirstCommit = commit.parents.length === 0;
    const end = isFirstCommit ? index : Infinity;

    if (isLastCommitOnBranch) {
      columns.push([
        {
          start: index,
          end,
          endCommitHash: commit.hash,
          branchOrder,
        },
      ]);
      branchOrder++;
      commitX = columns.length - 1;
    } else if (isBranchOutCommit) {
      const branchChildrenXs = branchChildren
        .map((childHash) => commitXs.get(childHash))
        .filter((x): x is number => x !== undefined);

      commitX = Math.min(...branchChildrenXs);

      updateColumnEnd(commitX, end, commit.hash);

      branchChildrenXs
        .filter((childX) => childX !== commitX)
        .forEach((childX) => {
          updateColumnEnd(childX!, index - 1, commit.hash);
        });
    } else {
      let minChildY = Infinity;
      let maxChildX = -1;

      commit.children.forEach((child) => {
        const childY = commitsMapWithPos.get(child)!.y;
        const childX = commitXs.get(child)!;

        if (childY < minChildY) {
          minChildY = childY;
        }

        if (childX > maxChildX) {
          maxChildX = childX;
        }
      });

      const colFitAtEnd = columns.slice(maxChildX + 1).findIndex((column) => {
        return minChildY >= column[column.length - 1].end;
      });

      const col = colFitAtEnd === -1 ? -1 : maxChildX + 1 + colFitAtEnd;

      if (col === -1) {
        columns.push([
          {
            start: minChildY + 1,
            end,
            endCommitHash: commit.hash,
            branchOrder,
          },
        ]);
        branchOrder++;
        commitX = columns.length - 1;
      } else {
        commitX = col;
        columns[col].push({
          start: minChildY + 1,
          end,
          endCommitHash: commit.hash,
          branchOrder,
        });
        branchOrder++;
      }
    }

    commitXs.set(commitHash, commitX);
    commitsMapWithPos.set(commitHash, {
      ...commit,
      y: index,
      x: commitX,
    });
  });

  return { columns, commitsMapWithPos };
}

function computePosition(commits: CommitNode[]): Map<string, CommitNode> {
  const commitsMap = new Map<string, CommitNode>(commits.map((commit) => [commit.hash, commit]));
  const orderedCommitHashes = topologicalOrderCommits(commits, commitsMap);
  const { commitsMapWithPos } = computeColumns(orderedCommitHashes, commitsMap);
  return commitsMapWithPos;
}

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

/** One row per horizontal band in the graph, top → bottom (increasing y index). */
export function getCommitNodesSortedByGraphRow(commits: CommitGraphCommit[]): CommitNode[] {
  const nodes = formatCommits(commits);
  const map = computePosition(nodes);
  return Array.from(map.values()).sort((a, b) => a.y - b.y);
}

export function commitGraphDotCenterY(
  commitSpacing: number,
  nodeRadius: number,
  rowIndex: number,
): number {
  return commitSpacing * rowIndex + nodeRadius * 4;
}
