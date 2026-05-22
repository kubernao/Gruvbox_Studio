/**
 * retryPolicy — per-error-type retry budget for AI tool calls.
 *
 * Centralizes the decision of whether a failed tool call should be retried
 * and how many times. {@link RETRY_LIMITS} maps error classification strings
 * (produced by `toolContracts.js`) to attempt counts. {@link shouldRetry}
 * is the sole public entry point consumed by `pi-gui.js`.
 *
 * Stateless pure functions; no IPC or file I/O.
 */

const RETRY_LIMITS = {
  validation_error: 1,
  not_found: 0,
  workspace_drift: 1,
  path_not_in_workspace: 0,
  targeting_error: 0,
  binary_file: 0,
  transient_error: 2,
  unknown_error: 0,
};

const DETERMINISTIC_ERROR_TYPES = new Set([
  'validation_error',
  'not_found',
  'workspace_drift',
  'path_not_in_workspace',
  'targeting_error',
  'binary_file',
  'unknown_error',
]);

function classifyError({ validation, resultText, isToolError, effectiveCwd = '' }) {
  if (!isToolError) return { errorType: null, retriable: false };
  if (validation && validation.ok === false) {
    return { errorType: 'validation_error', retriable: true };
  }
  const text = String(resultText ?? '').toLowerCase();
  const cwdLower = String(effectiveCwd ?? '').toLowerCase();
  const hasEnoent = text.includes('enoent') || text.includes('no such file or directory');
  const hasWorkspaceMissingSignal =
    text.includes('workspace directory is missing')
    || text.includes('cwd_missing')
    || text.includes('working directory')
    || text.includes('spawn')
    || text.includes('chdir');
  if (hasEnoent && hasWorkspaceMissingSignal && (!cwdLower || text.includes(cwdLower))) {
    return { errorType: 'workspace_drift', retriable: true };
  }
  if (text.includes('outside workspace') || text.includes('outside cwd')) {
    return { errorType: 'path_not_in_workspace', retriable: false };
  }
  if (text.includes('not found') || text.includes('no such file') || text.includes('does not exist')) {
    return { errorType: 'not_found', retriable: true };
  }
  if (text.includes('oldtext') || text.includes('ambiguous') || text.includes('multiple matches')) {
    return { errorType: 'targeting_error', retriable: true };
  }
  if (text.includes('binary') || text.includes('non-text') || text.includes('invalid utf-8')) {
    return { errorType: 'binary_file', retriable: false };
  }
  if (text.includes('timeout') || text.includes('temporar') || text.includes('rate limit') || text.includes('unavailable')) {
    return { errorType: 'transient_error', retriable: true };
  }
  return { errorType: 'unknown_error', retriable: true };
}

function shouldRetry({ errorType, attempts }) {
  const limit = RETRY_LIMITS[errorType] ?? RETRY_LIMITS.unknown_error;
  return attempts < limit;
}

function isDeterministicErrorType(errorType) {
  return DETERMINISTIC_ERROR_TYPES.has(String(errorType ?? ''));
}

function backoffMs(errorType, attempts) {
  if (errorType !== 'transient_error') return 0;
  const base = 150;
  const jitter = Math.floor(Math.random() * 75);
  return base * Math.max(1, attempts) + jitter;
}

module.exports = {
  classifyError,
  shouldRetry,
  isDeterministicErrorType,
  backoffMs,
  RETRY_LIMITS,
};
