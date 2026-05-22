import { describe, expect, it } from 'vitest';
import { validateToolArgs } from '../../src/electron-main/ipc/handlers/pi-tool-reliability/toolContracts';

describe('toolContracts doc tools', () => {
  it('validates append_to_file required fields', () => {
    const bad = validateToolArgs('append_to_file', { path: 'x.md', content: '' });
    expect(bad.ok).toBe(false);
    const ok = validateToolArgs('append_to_file', { path: 'x.md', content: 'hi' });
    expect(ok.ok).toBe(true);
  });

  it('validates insert_at anchor shape', () => {
    const missing = validateToolArgs('insert_at', {
      path: 'x.md',
      content: 'z',
      anchor: {},
    });
    expect(missing.ok).toBe(false);

    const dup = validateToolArgs('insert_at', {
      path: 'x.md',
      content: 'z',
      anchor: { line: 1, afterText: 'x' },
    });
    expect(dup.ok).toBe(false);

    const good = validateToolArgs('insert_at', {
      path: 'x.md',
      content: 'z',
      anchor: { line: 2 },
    });
    expect(good.ok).toBe(true);
  });
});
