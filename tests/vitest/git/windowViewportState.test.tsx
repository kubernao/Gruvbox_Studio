// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWindowViewportState } from '../../../src/frontend/features/git/utils/windowViewportState';

describe('useWindowViewportState', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  beforeEach(() => {
    const scroller = document.createElement('div');
    scroller.id = 'sidebar-git';
    Object.defineProperty(scroller, 'clientHeight', {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });
    document.body.appendChild(scroller);
  });

  it('expands overscan after totalRows goes from 0 to N (regression: single-row graph)', async () => {
    const rowHeight = 36;
    const { result, rerender } = renderHook(
      ({ totalRows }: { totalRows: number }) =>
        useWindowViewportState(rowHeight, totalRows),
      { initialProps: { totalRows: 0 } },
    );

    expect(result.current.overscanEndRow).toBe(0);

    rerender({ totalRows: 8 });

    await waitFor(() => {
      expect(result.current.overscanEndRow).toBeGreaterThanOrEqual(7);
      expect(result.current.overscanStartRow).toBeLessThanOrEqual(
        result.current.overscanEndRow,
      );
    });
  });
});
