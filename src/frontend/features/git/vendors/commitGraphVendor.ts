/**
 * Single import boundary for `commit-graph`.
 * If we need to use a fork later, swap this module's imports only.
 */
export { CommitGraph } from 'commit-graph';
export type {
  Branch as CommitGraphBranch,
  Commit as CommitGraphCommit,
  CommitNode as CommitGraphNode,
  GraphStyle as CommitGraphStyle,
} from 'commit-graph';
