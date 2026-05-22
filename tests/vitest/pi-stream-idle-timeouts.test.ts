/**
 * Unit tests for Pi stream idle timeout env parsing and error message formatting.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const timeoutsPath = path.resolve(
  __dirname,
  '../../src/electron-main/ipc/handlers/pi-stream-idle-timeouts.js',
);

const m = nodeRequire(timeoutsPath) as {
  DEFAULT_MODEL_IDLE_MS: number;
  DEFAULT_TOOL_IDLE_MS: number;
  resolveModelStreamIdleTimeoutMs: () => number;
  resolveToolStreamIdleTimeoutMs: () => number;
  resolveWatchdogTimeoutMsForPhase: (phase: 'model' | 'tool' | 'finalize' | 'pre_prompt') => number;
  resolvePiChildStreamChunkIdleTimeoutMs: () => number;
  formatStreamIdleTimeoutMessage: (
    phase: 'model' | 'tool',
    activeToolName: string,
    timeoutMs: number,
    diagnostics?: { lastEventType?: string; lastEventAgeSec?: number | null; piChildAlive?: boolean },
  ) => string;
};

const {
  DEFAULT_MODEL_IDLE_MS,
  DEFAULT_TOOL_IDLE_MS,
  resolveModelStreamIdleTimeoutMs,
  resolveToolStreamIdleTimeoutMs,
  resolveWatchdogTimeoutMsForPhase,
  resolvePiChildStreamChunkIdleTimeoutMs,
  formatStreamIdleTimeoutMessage,
} = m;

const envKeys = [
  'GRUVBOX_PI_STREAM_IDLE_TIMEOUT_MS',
  'GRUVBOX_PI_TOOL_STREAM_IDLE_TIMEOUT_MS',
  'GRUVBOX_PI_OPENAI_STREAM_CHUNK_IDLE_MS',
] as const;

describe('pi-stream-idle-timeouts', () => {
  afterEach(() => {
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  it('uses default model idle 600s and tool idle 600s', () => {
    expect(DEFAULT_MODEL_IDLE_MS).toBe(600_000);
    expect(DEFAULT_TOOL_IDLE_MS).toBe(600_000);
    expect(resolveModelStreamIdleTimeoutMs()).toBe(600_000);
    expect(resolveToolStreamIdleTimeoutMs()).toBe(600_000);
    expect(resolvePiChildStreamChunkIdleTimeoutMs()).toBe(600_000);
  });

  it('respects env overrides within clamp bounds', () => {
    process.env.GRUVBOX_PI_STREAM_IDLE_TIMEOUT_MS = '240000';
    process.env.GRUVBOX_PI_TOOL_STREAM_IDLE_TIMEOUT_MS = '900000';
    expect(resolveModelStreamIdleTimeoutMs()).toBe(240_000);
    expect(resolveToolStreamIdleTimeoutMs()).toBe(900_000);
  });

  it('clamps model idle below minimum to 30s', () => {
    process.env.GRUVBOX_PI_STREAM_IDLE_TIMEOUT_MS = '1000';
    expect(resolveModelStreamIdleTimeoutMs()).toBe(30_000);
  });

  it('clamps tool idle above maximum', () => {
    process.env.GRUVBOX_PI_TOOL_STREAM_IDLE_TIMEOUT_MS = '99999999';
    expect(resolveToolStreamIdleTimeoutMs()).toBe(3_600_000);
  });

  it('falls back on invalid env values', () => {
    process.env.GRUVBOX_PI_STREAM_IDLE_TIMEOUT_MS = 'not-a-number';
    expect(resolveModelStreamIdleTimeoutMs()).toBe(600_000);
  });

  it('resolvePiChildStreamChunkIdleTimeoutMs follows tool idle unless overridden', () => {
    process.env.GRUVBOX_PI_TOOL_STREAM_IDLE_TIMEOUT_MS = '450000';
    expect(resolvePiChildStreamChunkIdleTimeoutMs()).toBe(450_000);
    process.env.GRUVBOX_PI_OPENAI_STREAM_CHUNK_IDLE_MS = '240000';
    expect(resolvePiChildStreamChunkIdleTimeoutMs()).toBe(240_000);
  });

  it('resolveWatchdogTimeoutMsForPhase uses tool limit for tool, waiting, and compaction', () => {
    process.env.GRUVBOX_PI_STREAM_IDLE_TIMEOUT_MS = '120000';
    process.env.GRUVBOX_PI_TOOL_STREAM_IDLE_TIMEOUT_MS = '300000';
    expect(resolveWatchdogTimeoutMsForPhase('model')).toBe(120_000);
    expect(resolveWatchdogTimeoutMsForPhase('finalize')).toBe(120_000);
    expect(resolveWatchdogTimeoutMsForPhase('tool')).toBe(300_000);
    expect(resolveWatchdogTimeoutMsForPhase('waiting')).toBe(300_000);
    expect(resolveWatchdogTimeoutMsForPhase('compaction')).toBe(300_000);
  });

  it('formatStreamIdleTimeoutMessage includes seconds, phase, tool name, and diagnostics', () => {
    const msg = formatStreamIdleTimeoutMessage('tool', 'bash', 600_000, {
      lastEventType: 'tool_execution_update',
      lastEventAgeSec: 620,
      piChildAlive: true,
    });
    expect(msg).toContain('600s');
    expect(msg).toContain('phase: tool:bash');
    expect(msg).toContain('Last Pi event: tool_execution_update');
    expect(msg).toContain('Please retry');
  });
});
