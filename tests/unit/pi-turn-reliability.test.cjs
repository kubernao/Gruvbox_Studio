const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isLikelyJsonToolArgsText,
  computeTurnFailureBucket,
  shouldAppendTurnDiagnosticsLine,
  computeConsecutiveToolFailureState,
} = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/turnReliability');

test('isLikelyJsonToolArgsText: positive for brace-wrapped tool-arg shaped JSON', () => {
  assert.equal(isLikelyJsonToolArgsText('  {"path":"src/a.ts"}  '), true);
  assert.equal(isLikelyJsonToolArgsText('{"command":"npm test"}'), true);
  assert.equal(isLikelyJsonToolArgsText('{"edits":[{"oldText":"a","newText":"b"}]}'), true);
  assert.equal(isLikelyJsonToolArgsText('{"content":"x","file":"y"}'), true);
  assert.equal(isLikelyJsonToolArgsText('{"cwd":"/tmp"}'), true);
});

test('isLikelyJsonToolArgsText: negative for non-JSON or unrelated JSON', () => {
  assert.equal(isLikelyJsonToolArgsText(''), false);
  assert.equal(isLikelyJsonToolArgsText('hello'), false);
  assert.equal(isLikelyJsonToolArgsText('{'), false);
  assert.equal(isLikelyJsonToolArgsText('{"foo":1}'), false);
  assert.equal(isLikelyJsonToolArgsText('[{"path":"x"}]'), false);
});

test('computeTurnFailureBucket: clean turn', () => {
  assert.equal(
    computeTurnFailureBucket({
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 0,
      sentPiChatError: false,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 0,
    }),
    'none',
  );
});

test('computeTurnFailureBucket: skipped QA does not emit QA failure bucket', () => {
  assert.equal(
    computeTurnFailureBucket({
      qaFailed: false,
      qaFailureType: 'infra_failure',
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 0,
      sentPiChatError: false,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 0,
    }),
    'none',
  );
});

test('computeTurnFailureBucket: git checkpoint failure has highest precedence', () => {
  assert.equal(
    computeTurnFailureBucket({
      checkpointFailed: true,
      finalizeFailed: true,
      worktreePrepareFailed: true,
      jsonNoToolGuardrailTriggered: true,
      jsonLikeTextDeltaCount: 1,
      toolStartCount: 0,
      sentPiChatError: true,
      toolValidationFailureCount: 2,
      toolRuntimeFailureCount: 3,
    }),
    'git_checkpoint_failure',
  );
});

test('computeTurnFailureBucket: git finalize failure before tool buckets', () => {
  assert.equal(
    computeTurnFailureBucket({
      checkpointFailed: false,
      finalizeFailed: true,
      worktreePrepareFailed: false,
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 1,
      sentPiChatError: true,
      toolValidationFailureCount: 1,
      toolRuntimeFailureCount: 0,
    }),
    'git_finalize_failure',
  );
});

test('computeTurnFailureBucket: worktree prepare fallback before runtime bucket', () => {
  assert.equal(
    computeTurnFailureBucket({
      checkpointFailed: false,
      finalizeFailed: false,
      worktreePrepareFailed: true,
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 1,
      sentPiChatError: false,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 1,
    }),
    'git_worktree_prepare_fallback',
  );
});

test('computeTurnFailureBucket: QA infra failure is classified before runtime buckets', () => {
  assert.equal(
    computeTurnFailureBucket({
      qaFailed: true,
      qaFailureType: 'infra_failure',
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 1,
      sentPiChatError: true,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 1,
    }),
    'qa_infra_failure',
  );
});

test('computeTurnFailureBucket: QA policy and deterministic classifications', () => {
  assert.equal(
    computeTurnFailureBucket({
      qaFailed: true,
      qaFailureType: 'policy_failure',
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 0,
      sentPiChatError: false,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 0,
    }),
    'qa_policy_failure',
  );
  assert.equal(
    computeTurnFailureBucket({
      qaFailed: true,
      qaFailureType: 'deterministic_test_failure',
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 0,
      sentPiChatError: false,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 0,
    }),
    'qa_deterministic_failure',
  );
});

test('computeTurnFailureBucket: guardrail flag wins over validation counts', () => {
  assert.equal(
    computeTurnFailureBucket({
      jsonNoToolGuardrailTriggered: true,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 0,
      sentPiChatError: false,
      toolValidationFailureCount: 9,
      toolRuntimeFailureCount: 9,
    }),
    'json_text_without_tool_event',
  );
});

test('computeTurnFailureBucket: JSON-like text deltas + no tool + error (no guardrail yet)', () => {
  assert.equal(
    computeTurnFailureBucket({
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 1,
      toolStartCount: 0,
      sentPiChatError: true,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 0,
    }),
    'json_text_without_tool_event',
  );
});

test('computeTurnFailureBucket: JSON-like deltas but tools did start — not JSON bucket', () => {
  assert.equal(
    computeTurnFailureBucket({
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 3,
      toolStartCount: 1,
      sentPiChatError: true,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 0,
    }),
    'other_failure',
  );
});

test('computeTurnFailureBucket: validation failures before runtime', () => {
  assert.equal(
    computeTurnFailureBucket({
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 1,
      sentPiChatError: false,
      toolValidationFailureCount: 1,
      toolRuntimeFailureCount: 2,
    }),
    'tool_event_then_validation_failure',
  );
});

test('computeTurnFailureBucket: runtime only', () => {
  assert.equal(
    computeTurnFailureBucket({
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 1,
      sentPiChatError: false,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 1,
    }),
    'tool_event_then_runtime_failure',
  );
});

test('computeTurnFailureBucket: other_failure when only sentPiChatError', () => {
  assert.equal(
    computeTurnFailureBucket({
      jsonNoToolGuardrailTriggered: false,
      jsonLikeTextDeltaCount: 0,
      toolStartCount: 0,
      sentPiChatError: true,
      toolValidationFailureCount: 0,
      toolRuntimeFailureCount: 0,
    }),
    'other_failure',
  );
});

test('shouldAppendTurnDiagnosticsLine: reference policy for usePiSession onDone (JSON guard + CHANNEL_ERROR)', () => {
  assert.equal(
    shouldAppendTurnDiagnosticsLine({
      code: -1,
      failureBucket: 'json_text_without_tool_event',
      guardrailReason: 'json_text_without_tool_event',
    }),
    false,
  );
  assert.equal(shouldAppendTurnDiagnosticsLine({ code: 0, failureBucket: 'json_text_without_tool_event' }), true);
  assert.equal(
    shouldAppendTurnDiagnosticsLine({
      code: -1,
      failureBucket: 'reliability_guard_stop',
      guardrailReason: 'retry_limit_reached',
    }),
    true,
  );
  assert.equal(shouldAppendTurnDiagnosticsLine({ code: 0, failureBucket: 'none' }), false);
  assert.equal(shouldAppendTurnDiagnosticsLine({ code: 0 }), false);
});

test('computeConsecutiveToolFailureState: increments only for same failing tool', () => {
  let state = { failedToolName: '', failedToolCount: 0 };
  state = computeConsecutiveToolFailureState({
    toolName: 'write',
    isToolError: true,
    lastFailedToolName: state.failedToolName,
    lastFailedToolCount: state.failedToolCount,
  });
  assert.deepEqual(state, { failedToolName: 'write', failedToolCount: 1 });

  state = computeConsecutiveToolFailureState({
    toolName: 'write',
    isToolError: true,
    lastFailedToolName: state.failedToolName,
    lastFailedToolCount: state.failedToolCount,
  });
  assert.deepEqual(state, { failedToolName: 'write', failedToolCount: 2 });

  state = computeConsecutiveToolFailureState({
    toolName: 'read',
    isToolError: true,
    lastFailedToolName: state.failedToolName,
    lastFailedToolCount: state.failedToolCount,
  });
  assert.deepEqual(state, { failedToolName: 'read', failedToolCount: 1 });
});

test('computeConsecutiveToolFailureState: success resets failure streak', () => {
  const state = computeConsecutiveToolFailureState({
    toolName: 'write',
    isToolError: false,
    lastFailedToolName: 'write',
    lastFailedToolCount: 4,
  });
  assert.deepEqual(state, { failedToolName: '', failedToolCount: 0 });
});

test('computeConsecutiveToolFailureState: core tool reaches five-failure guard threshold deterministically', () => {
  let state = { failedToolName: '', failedToolCount: 0 };
  for (let i = 0; i < 5; i += 1) {
    state = computeConsecutiveToolFailureState({
      toolName: 'write',
      isToolError: true,
      lastFailedToolName: state.failedToolName,
      lastFailedToolCount: state.failedToolCount,
    });
  }
  assert.deepEqual(state, { failedToolName: 'write', failedToolCount: 5 });
});
