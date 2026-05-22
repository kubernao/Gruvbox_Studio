import { describe, expect, it, vi } from 'vitest';
vi.mock('monaco-editor', () => ({
  editor: {
    setModelLanguage: () => undefined,
  },
}));
import { createMonacoMirrorModelSync } from '../../src/frontend/components/DiffViewer/utils/monacoMirrorModelSync';

class FakeModel {
  private value: string;
  private listeners = new Set<() => void>();

  public constructor(value: string) {
    this.value = value;
  }

  public getValue(): string {
    return this.value;
  }

  public setValue(value: string): void {
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }

  public onDidChangeContent(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }
}

/**
 * This suite verifies authoritative-to-mirror one-way sync behavior so the
 * dual-diff merge flow never diverges or creates write loops.
 */
describe('monacoMirrorModelSync', () => {
  it('syncs initial and subsequent authoritative content into mirror', () => {
    const authoritative = new FakeModel('base');
    const mirror = new FakeModel('stale');
    const sync = createMonacoMirrorModelSync({
      authoritativeModel: authoritative,
      mirrorModel: mirror,
      languageId: 'typescript',
      setModelLanguage: () => undefined,
    });

    expect(mirror.getValue()).toBe('base');
    authoritative.setValue('next');
    expect(mirror.getValue()).toBe('next');

    sync.dispose();
  });

  it('does not write authoritative when mirror is changed directly', () => {
    const authoritative = new FakeModel('authoritative');
    const mirror = new FakeModel('authoritative');
    const sync = createMonacoMirrorModelSync({
      authoritativeModel: authoritative,
      mirrorModel: mirror,
      languageId: 'typescript',
      setModelLanguage: () => undefined,
    });

    mirror.setValue('manual-mirror-change');
    expect(authoritative.getValue()).toBe('authoritative');
    sync.syncNow();
    expect(mirror.getValue()).toBe('authoritative');

    sync.dispose();
  });

  it('keeps syncing after mirror updates and applies setLanguage to both models', () => {
    const authoritative = new FakeModel('a1');
    const mirror = new FakeModel('a1');
    const setLanguage = vi.fn();
    const sync = createMonacoMirrorModelSync({
      authoritativeModel: authoritative,
      mirrorModel: mirror,
      languageId: 'typescript',
      setModelLanguage: setLanguage,
    });

    expect(setLanguage).toHaveBeenCalledTimes(2);
    expect(setLanguage).toHaveBeenNthCalledWith(1, authoritative, 'typescript');
    expect(setLanguage).toHaveBeenNthCalledWith(2, mirror, 'typescript');

    mirror.setValue('manual');
    authoritative.setValue('a2');
    expect(mirror.getValue()).toBe('a2');

    sync.setLanguage('markdown');
    expect(setLanguage).toHaveBeenCalledWith(authoritative, 'markdown');
    expect(setLanguage).toHaveBeenCalledWith(mirror, 'markdown');
    sync.dispose();
  });
});

