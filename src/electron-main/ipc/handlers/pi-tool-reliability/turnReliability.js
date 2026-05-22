/**
 * Pure helpers for Pi turn-level reliability (failure buckets, JSON-in-text guard).
 * Used by pi-gui stdout handling; covered by unit tests.
 */

/**
 * @param {string} text
 * @returns {boolean}
 */
function isLikelyJsonToolArgsText(text) {
  const s = String(text ?? '').trim();
  if (!s.startsWith('{') || !s.endsWith('}')) {
    return false;
  }
  return /"(path|command|edits|oldText|newText|content|file|cwd|glob|pattern)"\s*:/.test(s);
}

/**
 * @typedef {{
 *   jsonNoToolGuardrailTriggered: boolean,
 *   jsonLikeTextDeltaCount: number,
 *   toolStartCount: number,
 *   sentPiChatError: boolean,
 *   toolValidationFailureCount: number,
 *   toolRuntimeFailureCount: number,
 *   worktreePrepareFailed?: boolean,
 *   checkpointFailed?: boolean,
 *   finalizeFailed?: boolean,
 *   qaFailed?: boolean,
 *   qaFailureType?: string,
 * }} TurnFailureSignals
 */

/**
 * Mirrors agent_end classification in pi-gui.js (order matters).
 * @param {TurnFailureSignals} s
 * @returns {'git_checkpoint_failure'|'git_finalize_failure'|'git_worktree_prepare_fallback'|'qa_infra_failure'|'qa_policy_failure'|'qa_flaky_retry_pass'|'qa_deterministic_failure'|'json_text_without_tool_event'|'tool_event_then_validation_failure'|'tool_event_then_runtime_failure'|'other_failure'|'none'}
 */
function computeTurnFailureBucket(s) {
  const jsonNoToolGuardrailTriggered = Boolean(s.jsonNoToolGuardrailTriggered);
  const jsonLikeTextDeltaCount = Number(s.jsonLikeTextDeltaCount) || 0;
  const toolStartCount = Number(s.toolStartCount) || 0;
  const sentPiChatError = Boolean(s.sentPiChatError);
  const toolValidationFailureCount = Number(s.toolValidationFailureCount) || 0;
  const toolRuntimeFailureCount = Number(s.toolRuntimeFailureCount) || 0;
  const worktreePrepareFailed = Boolean(s.worktreePrepareFailed);
  const checkpointFailed = Boolean(s.checkpointFailed);
  const finalizeFailed = Boolean(s.finalizeFailed);
  const qaFailed = Boolean(s.qaFailed);
  const qaFailureType = typeof s.qaFailureType === 'string' ? s.qaFailureType : '';

  if (checkpointFailed) {
    return 'git_checkpoint_failure';
  }
  if (finalizeFailed) {
    return 'git_finalize_failure';
  }
  if (worktreePrepareFailed) {
    return 'git_worktree_prepare_fallback';
  }
  if (qaFailed) {
    if (qaFailureType === 'infra_failure') {
      return 'qa_infra_failure';
    }
    if (qaFailureType === 'policy_failure') {
      return 'qa_policy_failure';
    }
    if (qaFailureType === 'flaky_retry_pass') {
      return 'qa_flaky_retry_pass';
    }
    return 'qa_deterministic_failure';
  }

  if (jsonNoToolGuardrailTriggered || (jsonLikeTextDeltaCount > 0 && toolStartCount === 0 && sentPiChatError)) {
    return 'json_text_without_tool_event';
  }
  if (toolValidationFailureCount > 0) {
    return 'tool_event_then_validation_failure';
  }
  if (toolRuntimeFailureCount > 0) {
    return 'tool_event_then_runtime_failure';
  }
  if (sentPiChatError) {
    return 'other_failure';
  }
  return 'none';
}

/**
 * Whether the renderer should append the "Turn diagnostics:" line after `pi-chat-done`.
 * Kept in sync with `usePiSession` (renderer cannot import this module).
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
function shouldAppendTurnDiagnosticsLine(payload) {
  const p = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : {};
  const bucket = typeof p.failureBucket === 'string' ? p.failureBucket : '';
  if (!bucket || bucket === 'none') {
    return false;
  }
  if (p.code === -1 && bucket === 'json_text_without_tool_event') {
    return false;
  }
  return true;
}

/**
 * Tracks consecutive failures for the same tool.
 *
 * @param {{ toolName: string, isToolError: boolean, lastFailedToolName?: string, lastFailedToolCount?: number }} params
 * @returns {{ failedToolName: string, failedToolCount: number }}
 */
function computeConsecutiveToolFailureState(params) {
  const toolName = typeof params.toolName === 'string' ? params.toolName : '';
  const isToolError = Boolean(params.isToolError);
  const prevTool = typeof params.lastFailedToolName === 'string' ? params.lastFailedToolName : '';
  const prevCount = Number.isFinite(params.lastFailedToolCount) ? Number(params.lastFailedToolCount) : 0;
  if (!isToolError) {
    return { failedToolName: '', failedToolCount: 0 };
  }
  if (toolName !== '' && toolName === prevTool) {
    return { failedToolName: toolName, failedToolCount: prevCount + 1 };
  }
  return { failedToolName: toolName, failedToolCount: 1 };
}

module.exports = {
  isLikelyJsonToolArgsText,
  computeTurnFailureBucket,
  shouldAppendTurnDiagnosticsLine,
  computeConsecutiveToolFailureState,
};
