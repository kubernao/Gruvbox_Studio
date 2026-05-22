/**
 * Shared detection for expected Monaco / VS Code editor cancellation errors. Monaco uses
 * thrown "Canceled" errors as control flow when disposing editors, canceling diff workers, or
 * tearing down word-highlight timers; those must not surface as user-visible runtime failures.
 */

/** Stack substrings that indicate an intentional Monaco cancellation, not a real bug. */
const EXPECTED_CANCEL_STACK_MARKERS = [
  'StandaloneEditorWorkerService.computeDiff',
  'WorkerBasedDocumentDiffProvider.computeDiff',
  'EditorWorkerClient.workerWithSyncedResources',
  'WordHighlighter.dispose',
  'Delayer.cancel',
  'Delayer.dispose',
];

/**
 * Extracts a human-readable message from an unknown rejection/error value.
 *
 * @param {unknown} reason
 * @returns {string}
 */
function cancellationMessageFromReason(reason) {
  if (reason instanceof Error) {
    return reason.message;
  }
  if (typeof reason === 'string') {
    return reason;
  }
  if (typeof reason === 'object' && reason !== null && 'message' in reason) {
    return String(/** @type {{ message?: unknown }} */ (reason).message ?? '');
  }
  return '';
}

/**
 * Extracts stack text from an unknown rejection/error value.
 *
 * @param {unknown} reason
 * @returns {string}
 */
function cancellationStackFromReason(reason) {
  if (reason instanceof Error) {
    return reason.stack ?? '';
  }
  if (typeof reason === 'object' && reason !== null && 'stack' in reason) {
    return String(/** @type {{ stack?: unknown }} */ (reason).stack ?? '');
  }
  return '';
}

/**
 * Returns true when a stack trace matches known Monaco cancellation disposal paths.
 *
 * @param {string} stack
 * @returns {boolean}
 */
function stackIndicatesExpectedMonacoCancellation(stack) {
  if (!stack) {
    return false;
  }
  return EXPECTED_CANCEL_STACK_MARKERS.some((marker) => stack.includes(marker));
}

/**
 * Returns true for Monaco "Canceled" errors that are expected during editor lifecycle transitions
 * (diff worker abort, word-highlighter dispose, delayer cancel, etc.).
 *
 * @param {unknown} reason
 * @returns {boolean}
 */
function isExpectedMonacoCancellation(reason) {
  const message = cancellationMessageFromReason(reason);
  if (!/Canceled/i.test(message)) {
    return false;
  }

  const stack = cancellationStackFromReason(reason);
  if (stackIndicatesExpectedMonacoCancellation(stack)) {
    return true;
  }

  if (stack === '') {
    const name =
      typeof reason === 'object' && reason !== null && 'name' in reason
        ? String(/** @type {{ name?: unknown }} */ (reason).name ?? '')
        : '';
    if (/Canceled/i.test(name) && /^Canceled$/i.test(message.trim())) {
      return true;
    }
    if (/^Canceled$/i.test(message.trim())) {
      return true;
    }
  }

  return false;
}

module.exports = {
  EXPECTED_CANCEL_STACK_MARKERS,
  isExpectedMonacoCancellation,
  stackIndicatesExpectedMonacoCancellation,
};
