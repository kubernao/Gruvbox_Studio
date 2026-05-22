/**
 * Unit tests for main-process Pi turn lifecycle helpers: stream flags,
 * overlap guard, per-window mutating-tool tracking, and idempotent finalize.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const lifecyclePath = path.resolve(__dirname, '../../src/electron-main/ipc/handlers/pi-turn-lifecycle.js');

type StreamFlags = { streamStateMachine: boolean };
type StreamSnapshot = { status: string; activeRequestId: string; aborting: boolean };
type CanStartCtx = {
  featureFlags: StreamFlags;
  idleTimeoutMs: number;
  getPiSession: (id: number) => unknown;
  isChildAlive: (child: import('node:child_process').ChildProcess | null | undefined) => boolean;
};

const m = nodeRequire(lifecyclePath) as {
  getStreamState: (wcId: number, featureFlags: StreamFlags) => StreamSnapshot;
  setStreamState: (wcId: number, next: StreamSnapshot, featureFlags: StreamFlags) => void;
  clearStreamState: (wcId: number, featureFlags: StreamFlags) => void;
  setTurnFinalizer: (wcId: number, fn: (args: { reason: string }) => Promise<void>) => void;
  deleteTurnFinalizer: (wcId: number) => void;
  getTurnFinalizer: (wcId: number) => ((args: { reason: string }) => Promise<void>) | undefined;
  canStartPiTurn: (wcId: number, ctx: CanStartCtx) => { ok: boolean; reason?: string; recoveredStale?: boolean };
  getPiTurnLifecycle: (wcId: number) => { anyMutatingToolStarted: boolean; resetForNewTurn: () => void; markMutatingToolStarted: () => void };
  runFinalizeOnce: (args: {
    finalizeRanRef: { current: boolean };
    run: () => Promise<void>;
    onFailure: (err: unknown) => void;
    onFinally: () => void | Promise<void>;
  }) => Promise<void>;
};

const {
  getStreamState,
  setStreamState,
  clearStreamState,
  setTurnFinalizer,
  deleteTurnFinalizer,
  getTurnFinalizer,
  canStartPiTurn,
  getPiTurnLifecycle,
  runFinalizeOnce,
} = m;

const flagsOff = { streamStateMachine: false };
const flagsOn = { streamStateMachine: true };

describe('pi-turn-lifecycle', () => {
  const wcId = 4242;

  afterEach(() => {
    m.deleteTurnFinalizer(wcId);
    clearStreamState(wcId, flagsOn);
    vi.restoreAllMocks();
  });

  it('getStreamState is idle when the stream state machine is disabled', () => {
    setStreamState(wcId, { status: 'streaming', activeRequestId: 'r1', aborting: false }, flagsOn);
    const s = getStreamState(wcId, flagsOff);
    expect(s.status).toBe('idle');
    expect(s.activeRequestId).toBe('');
  });

  it('persists stream state when the state machine flag is on', () => {
    setStreamState(wcId, { status: 'streaming', activeRequestId: 'r1', aborting: false }, flagsOn);
    expect(getStreamState(wcId, flagsOn).status).toBe('streaming');
    clearStreamState(wcId, flagsOn);
    expect(getStreamState(wcId, flagsOn).status).toBe('idle');
  });

  it('canStartPiTurn allows start when not streaming', () => {
    const res = canStartPiTurn(wcId, {
      featureFlags: flagsOn,
      idleTimeoutMs: 60_000,
      getPiSession: () => undefined,
      isChildAlive: () => false,
    });
    expect(res).toEqual({ ok: true });
  });

  it('canStartPiTurn blocks when streaming with a live child and finalizer', () => {
    setStreamState(wcId, { status: 'streaming', activeRequestId: 'r1', aborting: false }, flagsOn);
    setTurnFinalizer(wcId, async () => {});
    const fakeChild = {} as import('node:child_process').ChildProcess;
    const res = canStartPiTurn(wcId, {
      featureFlags: flagsOn,
      idleTimeoutMs: 60_000,
      getPiSession: () => ({
        detachStdout: true,
        child: fakeChild,
        lastTouchedAtMs: Date.now(),
      }),
      isChildAlive: () => true,
    });
    expect(res).toEqual({ ok: false, reason: 'A message is already in progress.' });
  });

  it('canStartPiTurn recovers stale streaming when there is no live stdout', () => {
    setStreamState(wcId, { status: 'streaming', activeRequestId: 'r1', aborting: false }, flagsOn);
    setTurnFinalizer(wcId, async () => {});
    const res = canStartPiTurn(wcId, {
      featureFlags: flagsOn,
      idleTimeoutMs: 60_000,
      getPiSession: () => ({ detachStdout: false, child: undefined }),
      isChildAlive: () => false,
    });
    expect(res).toEqual({ ok: true, recoveredStale: true });
  });

  it('getPiTurnLifecycle resets mutating-tool flag per turn', () => {
    const L = getPiTurnLifecycle(wcId);
    L.markMutatingToolStarted();
    expect(L.anyMutatingToolStarted).toBe(true);
    L.resetForNewTurn();
    expect(L.anyMutatingToolStarted).toBe(false);
  });

  it('runFinalizeOnce runs the body once, always runs onFinally, reports failure', async () => {
    const finalizeRanRef = { current: false };
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const onFailure = vi.fn();
    const onFinally = vi.fn().mockResolvedValue(undefined);
    await runFinalizeOnce({ finalizeRanRef, run, onFailure, onFinally });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(expect.any(Error));
    expect(onFinally).toHaveBeenCalledTimes(1);
    await runFinalizeOnce({ finalizeRanRef, run, onFailure, onFinally });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onFinally).toHaveBeenCalledTimes(1);
  });

  it('getTurnFinalizer returns registered finalizer', () => {
    const fn = async () => {};
    setTurnFinalizer(wcId, fn);
    expect(getTurnFinalizer(wcId)).toBe(fn);
    deleteTurnFinalizer(wcId);
    expect(getTurnFinalizer(wcId)).toBeUndefined();
  });
});
