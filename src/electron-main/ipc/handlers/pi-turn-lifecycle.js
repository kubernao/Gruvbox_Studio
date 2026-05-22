/**
 * Pi turn lifecycle — central ownership of per-renderer stream state, turn
 * finalizer hooks, and lightweight turn-scoped flags for the Pi assistant IPC
 * layer. This module exists so `pi-gui.js` can delegate overlapping concerns
 * (in-flight guards, finalize policy inputs, idempotent finalize) to one
 * place instead of scattering maps and ad-hoc transitions across dozens of
 * branches. Main process only; keep renderer-safe types out of this file.
 */

'use strict';

/** @type {Map<number, { status: string, activeRequestId: string, aborting: boolean, lastToolCallId?: string }>} */
const streamStateByWcId = new Map();

/**
 * Registered finalizer closures keyed by `webContents.id`. Each finalizer
 * performs post-turn work (stream-end, worktree commit, QA,
 * pi-chat-done) and must be idempotent when invoked more than once.
 *
 * @type {Map<number, (args: { reason: string }) => Promise<void>>}
 */
const turnFinalizersByWcId = new Map();

/**
 * Return the current stream-state record for renderer `wcId`, or a safe idle
 * default when the state-machine flag is disabled or no entry exists yet.
 *
 * @param {number} wcId
 * @param {{ streamStateMachine: boolean }} featureFlags
 * @returns {{ status: string, activeRequestId: string, aborting: boolean, lastToolCallId?: string }}
 */
function getStreamState(wcId, featureFlags) {
  if (!featureFlags.streamStateMachine) {
    return { status: 'idle', activeRequestId: '', aborting: false };
  }
  return streamStateByWcId.get(wcId) ?? { status: 'idle', activeRequestId: '', aborting: false };
}

/**
 * Persist the next stream-state snapshot for `wcId`. No-op when the state
 * machine feature flag is off.
 *
 * @param {number} wcId
 * @param {{ status: string, activeRequestId: string, aborting: boolean }} next
 * @param {{ streamStateMachine: boolean }} featureFlags
 */
function setStreamState(wcId, next, featureFlags) {
  if (!featureFlags.streamStateMachine) {
    return;
  }
  streamStateByWcId.set(wcId, next);
}

/**
 * Remove stream state for `wcId` (session reset / terminal transitions).
 *
 * @param {number} wcId
 * @param {{ streamStateMachine: boolean }} featureFlags
 */
function clearStreamState(wcId, featureFlags) {
  if (!featureFlags.streamStateMachine) {
    return;
  }
  streamStateByWcId.delete(wcId);
}

/**
 * Read the registered turn finalizer for a window, if any.
 *
 * @param {number} wcId
 * @returns {((args: { reason: string }) => Promise<void>) | undefined}
 */
function getTurnFinalizer(wcId) {
  return turnFinalizersByWcId.get(wcId);
}

/**
 * Register or replace the active turn finalizer for `wcId`.
 *
 * @param {number} wcId
 * @param {(args: { reason: string }) => Promise<void>} fn
 */
function setTurnFinalizer(wcId, fn) {
  turnFinalizersByWcId.set(wcId, fn);
}

/**
 * Drop the finalizer hook for `wcId` after a successful terminal transition.
 *
 * @param {number} wcId
 */
function deleteTurnFinalizer(wcId) {
  turnFinalizersByWcId.delete(wcId);
}

/**
 * Decide whether a new send-message may start. Encapsulates stale recovery:
 * when the UI thinks a turn is still streaming but there is no live stdout
 * pipe, active abort, or the idle timeout fired without a finalizer, the
 * caller may reset and proceed.
 *
 * @param {number} wcId
 * @param {{
 *   featureFlags: { streamStateMachine: boolean },
 *   idleTimeoutMs: number,
 *   getPiSession: (id: number) => import('node:child_process').ChildProcess | { detachStdout?: unknown, child?: import('node:child_process').ChildProcess, lastTouchedAtMs?: number } | undefined,
 *   isChildAlive: (child: import('node:child_process').ChildProcess | null | undefined) => boolean,
 * }} ctx
 * @returns {{ ok: true, recoveredStale?: boolean } | { ok: false, reason: string }}
 */
function canStartPiTurn(wcId, ctx) {
  const { featureFlags, idleTimeoutMs, getPiSession, isChildAlive } = ctx;
  const streamState = getStreamState(wcId, featureFlags);
  const inFlight = streamState.status === 'streaming';
  if (!inFlight) {
    return { ok: true };
  }
  const sess = getPiSession(wcId);
  const hasLiveStream = Boolean(sess?.detachStdout) && isChildAlive(sess?.child);
  const hasFinalizer = turnFinalizersByWcId.has(wcId);
  const lastTouchedAtMs = Number(sess?.lastTouchedAtMs ?? 0);
  const staleByInactivity = lastTouchedAtMs > 0 && Date.now() - lastTouchedAtMs > idleTimeoutMs;
  const canRecoverStaleState =
    !hasLiveStream || streamState.aborting === true || (!hasFinalizer && staleByInactivity);
  if (canRecoverStaleState) {
    return { ok: true, recoveredStale: true };
  }
  return { ok: false, reason: 'A message is already in progress.' };
}

/**
 * Tracks per-window turn flags that reset at the beginning of each user send
 * (mutating tool detection for fallback behavior). One instance per
 * `webContents.id` is enough for the window lifetime.
 */
class PiTurnLifecycle {
  /**
   * Construct empty turn flags for a renderer. Callers obtain instances via
   * {@link PiTurnLifecycle.forWebContents} so flags stay scoped to the
   * correct `webContents.id`.
   */
  constructor() {
    this.anyMutatingToolStarted = false;
  }

  /**
   * Clear turn-scoped flags when a new send-message turn begins.
   */
  resetForNewTurn() {
    this.anyMutatingToolStarted = false;
  }

  /**
   * Remember that at least one mutating tool (write/edit/mutating bash)
   * started during this turn — used when git cannot infer touched paths but
   * the user still needs a merge review surface.
   */
  markMutatingToolStarted() {
    this.anyMutatingToolStarted = true;
  }
}

/** @type {Map<number, PiTurnLifecycle>} */
const piTurnLifecycleByWcId = new Map();

/**
 * Return the {@link PiTurnLifecycle} bucket for `wcId`, creating it on first use.
 *
 * @param {number} wcId
 * @returns {PiTurnLifecycle}
 */
function getPiTurnLifecycle(wcId) {
  if (!piTurnLifecycleByWcId.has(wcId)) {
    piTurnLifecycleByWcId.set(wcId, new PiTurnLifecycle());
  }
  return piTurnLifecycleByWcId.get(wcId);
}

/**
 * Runs an async finalizer exactly once: executes the user body, records
 * failures, and invokes a `finally` hook so callers can unconditionally emit
 * terminal IPC (pi-chat-done, stream cleanup, idle) even when the body throws
 * mid-QA or mid-git persistence.
 *
 * @param {{
 *   finalizeRanRef: { current: boolean },
 *   run: () => Promise<void>,
 *   onFailure: (err: unknown) => void,
 *   onFinally: () => void | Promise<void>,
 * }} args
 * @returns {Promise<void>}
 */
async function runFinalizeOnce({ finalizeRanRef, run, onFailure, onFinally }) {
  if (finalizeRanRef.current) {
    return;
  }
  finalizeRanRef.current = true;
  try {
    await run();
  } catch (err) {
    onFailure(err);
  } finally {
    await onFinally();
  }
}

module.exports = {
  getStreamState,
  setStreamState,
  clearStreamState,
  getTurnFinalizer,
  setTurnFinalizer,
  deleteTurnFinalizer,
  canStartPiTurn,
  PiTurnLifecycle,
  getPiTurnLifecycle,
  runFinalizeOnce,
};
