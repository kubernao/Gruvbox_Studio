'use strict';

/**
 * Pure turn-end QA gating for the Pi assistant. The main process calls this on
 * every `agent_end` to decide whether to spawn `run-agent-qa.cjs`. Worktree mode
 * uses a per-turn HEAD comparison so a non-empty `git diff target...aiBranch` does
 * not force QA on read-only turns after the AI branch has already diverged.
 */

/**
 * Decide whether turn-end QA should run. Without `useWorktreeHeadGate`, policy
 * matches the legacy rule: any tool-touched paths or any git-derived branch diff
 * paths imply local mutation. With `useWorktreeHeadGate` (AI worktree sessions),
 * git-derived lists are ignored for gating; QA runs only when this turn recorded
 * mutating tool paths or when `rev-parse HEAD` advanced after
 * `commitWorktreeChangesIfAny` relative to the snapshot stored on the session.
 *
 * @param {{ touchedRelativeFiles: string[], gitDerivedTouchedFiles: string[], toolStartCount: number, useWorktreeHeadGate?: boolean, headChangedThisTurn?: boolean }} params
 * @returns {{ runQa: boolean, skipReason: string }}
 */
function resolveTurnQaPolicy(params) {
  const touchedRelativeFiles = Array.isArray(params?.touchedRelativeFiles) ? params.touchedRelativeFiles : [];
  const gitDerivedTouchedFiles = Array.isArray(params?.gitDerivedTouchedFiles) ? params.gitDerivedTouchedFiles : [];
  const toolStartCount = Number(params?.toolStartCount) || 0;
  const useWorktreeHeadGate = params?.useWorktreeHeadGate === true;
  const headChangedThisTurn = params?.headChangedThisTurn === true;

  if (useWorktreeHeadGate) {
    const hasLocalMutationSignals = touchedRelativeFiles.length > 0 || headChangedThisTurn;
    if (!hasLocalMutationSignals) {
      return {
        runQa: false,
        skipReason:
          toolStartCount > 0 ? 'qa_skipped_worktree_no_mutation_this_turn' : 'qa_skipped_read_only_turn',
      };
    }
    return { runQa: true, skipReason: '' };
  }

  const hasLocalMutationSignals = touchedRelativeFiles.length > 0 || gitDerivedTouchedFiles.length > 0;
  if (!hasLocalMutationSignals) {
    return {
      runQa: false,
      skipReason: toolStartCount > 0 ? 'qa_skipped_no_local_mutation' : 'qa_skipped_read_only_turn',
    };
  }
  return { runQa: true, skipReason: '' };
}

module.exports = { resolveTurnQaPolicy };
