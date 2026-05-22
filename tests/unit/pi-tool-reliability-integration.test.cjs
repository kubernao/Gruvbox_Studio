const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeToolArgs,
  validateToolArgs,
} = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/toolContracts');
const {
  classifyError,
  shouldRetry,
} = require('../../src/electron-main/ipc/handlers/pi-tool-reliability/retryPolicy');

/**
 * Integration-style simulation of the runtime decision chain:
 * model args -> normalization -> validation -> error classification -> retry gating.
 */
function simulateWriteReliabilityLoop(rawAttempts) {
  const trace = [];
  const repairsByType = {};
  let exhausted = false;

  for (let i = 0; i < rawAttempts.length; i += 1) {
    const rawArgs = rawAttempts[i];
    const { normalized, normalizationNotes } = normalizeToolArgs('write', rawArgs);
    const validation = validateToolArgs('write', normalized);

    if (validation.ok) {
      trace.push({
        step: i + 1,
        ok: true,
        normalized,
        normalizationNotes,
        errorType: null,
        retryAllowed: false,
      });
      return { success: true, exhausted: false, trace };
    }

    const cls = classifyError({
      validation,
      resultText: 'Validation failed for tool "write": content required',
      isToolError: true,
    });
    const errorType = cls.errorType ?? 'unknown_error';
    const attemptsForType = repairsByType[errorType] ?? 0;
    const retryAllowed = shouldRetry({ errorType, attempts: attemptsForType });

    trace.push({
      step: i + 1,
      ok: false,
      normalized,
      normalizationNotes,
      missing: validation.missing,
      validationErrors: validation.errors,
      errorType,
      attemptsForType,
      retryAllowed,
    });

    if (!retryAllowed) {
      exhausted = true;
      return { success: false, exhausted, trace };
    }
    repairsByType[errorType] = attemptsForType + 1;
  }

  return { success: false, exhausted, trace };
}

function simulateWriteAutoFallbackLoop(rawAttempts) {
  const trace = [];
  let writePathOnlyRepairs = 0;
  for (let i = 0; i < rawAttempts.length; i += 1) {
    const { normalized } = normalizeToolArgs('write', rawAttempts[i]);
    const validation = validateToolArgs('write', normalized);
    if (validation.ok) {
      trace.push({ step: i + 1, ok: true, action: 'write_ok' });
      return { success: true, stopped: false, trace };
    }
    const pathOnly = Boolean(
      typeof normalized.path === 'string' &&
      (!Object.prototype.hasOwnProperty.call(normalized, 'content') || String(normalized.content ?? '') === ''),
    );
    if (pathOnly) {
      writePathOnlyRepairs += 1;
      trace.push({
        step: i + 1,
        ok: false,
        action: 'fallback_read_edit',
        retryAllowed: writePathOnlyRepairs < 2,
      });
      if (writePathOnlyRepairs >= 2) {
        return { success: false, stopped: true, trace };
      }
      continue;
    }
    trace.push({ step: i + 1, ok: false, action: 'validation_error' });
  }
  return { success: false, stopped: false, trace };
}

function simulateMemoryReliabilityLoop(rawAttempts, { warningOnly = false } = {}) {
  const trace = [];
  let consecutiveFailedToolCount = 0;
  for (let i = 0; i < rawAttempts.length; i += 1) {
    const { normalized } = normalizeToolArgs('memory_remember', rawAttempts[i]);
    const validation = validateToolArgs('memory_remember', normalized);
    const isToolError = !validation.ok;
    if (isToolError) {
      consecutiveFailedToolCount += 1;
      const guardHit = !warningOnly && consecutiveFailedToolCount >= 5;
      trace.push({
        step: i + 1,
        ok: false,
        guardHit,
        missing: validation.missing,
        errors: validation.errors,
      });
      if (guardHit) {
        return { success: false, stopped: true, trace };
      }
      continue;
    }
    trace.push({ step: i + 1, ok: true, guardHit: false });
    return { success: true, stopped: false, trace };
  }
  return { success: false, stopped: false, trace };
}

test('integration: repeated path-only write args exhaust retries (root-cause signal)', () => {
  const result = simulateWriteReliabilityLoop([
    { path: 'story.md' },
    { path: 'story.md' },
    { path: 'story.md' },
    { path: 'story.md' },
    { path: 'story.md' },
  ]);

  assert.equal(result.success, false);
  assert.equal(result.exhausted, true);
  assert.deepEqual(
    result.trace.map((t) => t.errorType),
    ['validation_error', 'validation_error'],
  );
  assert.deepEqual(
    result.trace.map((t) => t.retryAllowed),
    [true, false],
  );
});

test('integration: alias-shaped write args recover and pass validation', () => {
  const result = simulateWriteReliabilityLoop([
    { path: 'story.md' }, // initial bad call
    { input: { filepath: 'story.md', body: 'chapter text' } }, // repaired call
  ]);

  assert.equal(result.success, true);
  assert.equal(result.exhausted, false);
  assert.equal(result.trace[0].ok, false);
  assert.equal(result.trace[1].ok, true);
  assert.equal(result.trace[1].normalized.content, 'chapter text');
});

test('integration: malformed JSON args collapse to empty object and trigger validation_error', () => {
  const result = simulateWriteReliabilityLoop([
    '{"arguments":{"path":"story.md","content":"abc"', // malformed JSON
    { path: 'story.md' },
    { path: 'story.md' },
    { path: 'story.md' },
  ]);

  assert.equal(result.success, false);
  assert.equal(result.exhausted, true);
  assert.ok(result.trace[0].missing.includes('path'));
  assert.ok(result.trace[0].missing.includes('content'));
});

test('integration: wrapper string payload with aliases normalizes and succeeds', () => {
  const result = simulateWriteReliabilityLoop([
    JSON.stringify({
      input: {
        filePath: './src//story.md',
        value: 'chapter text',
      },
    }),
  ]);
  assert.equal(result.success, true);
  assert.equal(result.trace[0].normalized.path, 'src/story.md');
  assert.equal(result.trace[0].normalized.content, 'chapter text');
});

test('integration: write(path-only) deterministically transitions to read/edit fallback', () => {
  const result = simulateWriteAutoFallbackLoop([{ path: 'story.md' }, { path: 'story.md' }]);
  assert.equal(result.success, false);
  assert.equal(result.stopped, true);
  assert.deepEqual(
    result.trace.map((t) => t.action),
    ['fallback_read_edit', 'fallback_read_edit'],
  );
  assert.deepEqual(
    result.trace.map((t) => t.retryAllowed),
    [true, false],
  );
});

test('integration: malformed memory_remember kind is normalized to a valid enum', () => {
  const result = simulateMemoryReliabilityLoop([
    {
      kind: ' Person ',
      title: 'Memory title',
      body: 'Memory body',
    },
  ]);
  assert.equal(result.success, true);
  assert.equal(result.stopped, false);
});

test('integration: repeated invalid memory_remember failures remain non-fatal in warning-only mode', () => {
  const result = simulateMemoryReliabilityLoop(
    new Array(6).fill({ kind: 'invalid-kind', title: '', body: '' }),
    { warningOnly: true },
  );
  assert.equal(result.success, false);
  assert.equal(result.stopped, false);
  assert.equal(result.trace.some((entry) => entry.guardHit), false);
});

test('integration: core guard behavior is unchanged when warning-only mode is disabled', () => {
  const result = simulateMemoryReliabilityLoop(
    new Array(6).fill({ kind: 'invalid-kind', title: '', body: '' }),
    { warningOnly: false },
  );
  assert.equal(result.success, false);
  assert.equal(result.stopped, true);
  assert.equal(result.trace[result.trace.length - 1].guardHit, true);
});

