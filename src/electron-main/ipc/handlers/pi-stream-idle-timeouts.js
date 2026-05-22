/**
 * Pi stream idle timeout configuration for Gruvbox Studio's main-process AI
 * assistant. The Pi RPC child can go silent for long stretches during model
 * reasoning (time-to-first-token), compaction, or while running tools; these
 * helpers supply clamped millisecond limits so the UI watchdog does not abort
 * work the Gruvbox API still considers in-flight.
 *
 * Environment variables:
 *   GRUVBOX_PI_STREAM_IDLE_TIMEOUT_MS — text/thinking token gaps (default 600000, min 30000, max 3600000)
 *   GRUVBOX_PI_TOOL_STREAM_IDLE_TIMEOUT_MS — tools, waiting-for-model, compaction, toolcall assembly (default 600000, min 90000, max 3600000)
 *   GRUVBOX_PI_OPENAI_STREAM_CHUNK_IDLE_MS — forwarded to Pi as PI_OPENAI_STREAM_CHUNK_IDLE_MS (default: tool idle)
 *
 * Related (pi-mono / OpenRouter): PI_OPENAI_STREAM_CHUNK_IDLE_MS detects hung SSE when Pi stdout is silent (pi default 120s).
 */

'use strict';

/** Default idle limit while text/thinking tokens stream (long-form writing can gap for minutes). */
const DEFAULT_MODEL_IDLE_MS = 600_000;

/** Default idle limit for tools, post-tool LLM waits, and compaction. */
const DEFAULT_TOOL_IDLE_MS = 600_000;

/** Phases that use the longer tool/wait timeout. */
const LONG_IDLE_PHASES = new Set(['tool', 'waiting', 'compaction']);

/**
 * Parse an integer millisecond value from `process.env[name]`, clamp to bounds,
 * and fall back when unset or invalid.
 *
 * @param {string} name
 * @param {number} fallback
 * @param {{ min: number, max: number }} bounds
 * @returns {number}
 */
function parseEnvMs(name, fallback, bounds) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(bounds.max, Math.max(bounds.min, n));
}

/**
 * Resolve the stream-idle timeout used while tokens are actively streaming.
 *
 * @returns {number}
 */
function resolveModelStreamIdleTimeoutMs() {
  return parseEnvMs('GRUVBOX_PI_STREAM_IDLE_TIMEOUT_MS', DEFAULT_MODEL_IDLE_MS, {
    min: 30_000,
    max: 3_600_000,
  });
}

/**
 * Resolve the stream-idle timeout used for tools and long silent agent work
 * (waiting for the next model response, compaction, quiet bash).
 *
 * @returns {number}
 */
function resolveToolStreamIdleTimeoutMs() {
  return parseEnvMs('GRUVBOX_PI_TOOL_STREAM_IDLE_TIMEOUT_MS', DEFAULT_TOOL_IDLE_MS, {
    min: 90_000,
    max: 3_600_000,
  });
}

/**
 * Pick the watchdog duration for a given phase label.
 *
 * @param {'model' | 'tool' | 'waiting' | 'compaction' | 'finalize'} phase
 * @returns {number}
 */
function resolveWatchdogTimeoutMsForPhase(phase) {
  if (LONG_IDLE_PHASES.has(phase)) {
    return resolveToolStreamIdleTimeoutMs();
  }
  return resolveModelStreamIdleTimeoutMs();
}

/**
 * Resolve the OpenAI/OpenRouter SSE chunk-idle limit injected into the Pi RPC child.
 * Pi's built-in default is 120s, which aborts long reasoning before Studio's watchdog.
 *
 * @returns {number}
 */
function resolvePiChildStreamChunkIdleTimeoutMs() {
  return parseEnvMs(
    'GRUVBOX_PI_OPENAI_STREAM_CHUNK_IDLE_MS',
    resolveToolStreamIdleTimeoutMs(),
    { min: 30_000, max: 3_600_000 },
  );
}

/**
 * Build the user-visible timeout error including phase context, limit, and
 * optional diagnostics (last stdout event, Pi child liveness, stderr hint).
 *
 * @param {'model' | 'tool' | 'waiting' | 'compaction' | 'finalize'} phase
 * @param {string} activeToolName
 * @param {number} timeoutMs
 * @param {{
 *   lastEventType?: string,
 *   lastEventAgeSec?: number | null,
 *   piChildAlive?: boolean,
 *   stderrTail?: string,
 * }} [diagnostics]
 * @returns {string}
 */
function formatStreamIdleTimeoutMessage(phase, activeToolName, timeoutMs, diagnostics = {}) {
  const secs = Math.round(timeoutMs / 1000);
  let phaseLabel = phase;
  if (phase === 'tool' && typeof activeToolName === 'string' && activeToolName.trim() !== '') {
    phaseLabel = `tool:${activeToolName.trim()}`;
  }
  const parts = [
    `AI request timed out after ${secs}s with no Pi stream activity (phase: ${phaseLabel}).`,
  ];
  const lastType = typeof diagnostics.lastEventType === 'string' ? diagnostics.lastEventType.trim() : '';
  if (lastType !== '') {
    const age =
      typeof diagnostics.lastEventAgeSec === 'number' && Number.isFinite(diagnostics.lastEventAgeSec)
        ? `${diagnostics.lastEventAgeSec}s ago`
        : 'unknown age';
    parts.push(`Last Pi event: ${lastType} (${age}).`);
  } else {
    parts.push('No Pi JSONL events were received on stdout for this turn.');
  }
  if (diagnostics.piChildAlive === false) {
    parts.push('The Pi RPC process is no longer running (possible crash or kill).');
  } else if (phase === 'waiting' || phase === 'compaction') {
    parts.push(
      'The Pi process is still alive; this often means a hung OpenRouter/API stream or work inside Pi with no stdout (compaction, retry sleep, or a stuck tool).',
    );
  } else if (phase === 'tool') {
    parts.push('The Pi process is still alive; the tool may be blocked or not streaming progress.');
  }
  const stderrTail = typeof diagnostics.stderrTail === 'string' ? diagnostics.stderrTail.trim() : '';
  if (stderrTail !== '') {
    parts.push(`Pi stderr (tail): ${stderrTail.slice(-280)}`);
  }
  parts.push('Set GRUVBOX_PI_DEBUG=1 and retry to log phase transitions. Please retry.');
  return parts.join(' ');
}

module.exports = {
  DEFAULT_MODEL_IDLE_MS,
  DEFAULT_TOOL_IDLE_MS,
  LONG_IDLE_PHASES,
  parseEnvMs,
  resolveModelStreamIdleTimeoutMs,
  resolveToolStreamIdleTimeoutMs,
  resolveWatchdogTimeoutMsForPhase,
  resolvePiChildStreamChunkIdleTimeoutMs,
  formatStreamIdleTimeoutMessage,
};
