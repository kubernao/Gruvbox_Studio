import { describe, expect, it } from 'vitest';
import { isExpectedMonacoCancellation } from '../../src/frontend/components/DiffViewer/utils/monacoCancellation.js';

describe('isExpectedMonacoCancellation', () => {
  it('accepts diff worker cancellation stacks', () => {
    const err = new Error('Canceled');
    err.stack = [
      'Canceled: Canceled',
      '    at StandaloneEditorWorkerService.computeDiff',
    ].join('\n');
    expect(isExpectedMonacoCancellation(err)).toBe(true);
  });

  it('accepts word highlighter dispose cancellation stacks', () => {
    const err = new Error('Canceled');
    err.stack = [
      'Canceled: Canceled',
      '    at Delayer.cancel (webpack-internal:///86428:282:29)',
      '    at Delayer.dispose (webpack-internal:///86428:291:14)',
      '    at WordHighlighter.dispose (webpack-internal:///9470:682:23)',
    ].join('\n');
    expect(isExpectedMonacoCancellation(err)).toBe(true);
  });

  it('rejects unrelated errors even when message mentions cancel', () => {
    const err = new Error('Request was canceled by user action');
    err.stack = '    at fetchData (app.js:10:5)';
    expect(isExpectedMonacoCancellation(err)).toBe(false);
  });

  it('accepts stackless Canceled payloads from global handlers', () => {
    expect(isExpectedMonacoCancellation({ name: 'Canceled', message: 'Canceled' })).toBe(true);
  });
});
