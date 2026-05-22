import { useEffect, useMemo, useState } from 'react';

export interface WindowViewportRange {
  startRow: number;
  endRow: number;
  overscanStartRow: number;
  overscanEndRow: number;
}

const DEFAULT_OVERSCAN_ROWS = 24;
const DEFAULT_HYSTERESIS_ROWS = 8;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function computeViewportRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscanRows = DEFAULT_OVERSCAN_ROWS,
): WindowViewportRange {
  if (totalRows <= 0 || rowHeight <= 0) {
    return {
      startRow: 0,
      endRow: 0,
      overscanStartRow: 0,
      overscanEndRow: 0,
    };
  }
  const startRow = clamp(Math.floor(scrollTop / rowHeight), 0, totalRows - 1);
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const endRow = clamp(startRow + visibleRows - 1, startRow, totalRows - 1);
  return {
    startRow,
    endRow,
    overscanStartRow: clamp(startRow - overscanRows, 0, totalRows - 1),
    overscanEndRow: clamp(endRow + overscanRows, startRow, totalRows - 1),
  };
}

/**
 * Track scroll window from the main Git sidebar scroller and only update
 * when row movement exceeds hysteresis threshold to reduce allocator churn.
 */
export function useWindowViewportState(
  rowHeight: number,
  totalRows: number,
): WindowViewportRange {
  const [range, setRange] = useState<WindowViewportRange>({
    startRow: 0,
    endRow: Math.max(0, totalRows - 1),
    overscanStartRow: 0,
    overscanEndRow: Math.max(0, totalRows - 1),
  });

  useEffect(() => {
    const scroller = document.getElementById('sidebar-git');
    let pendingRetryFrame: number | null = null;
    if (scroller === null) {
      setRange({
        startRow: 0,
        endRow: Math.max(0, totalRows - 1),
        overscanStartRow: 0,
        overscanEndRow: Math.max(0, totalRows - 1),
      });
      return;
    }

    const update = (): void => {
      // When the tab is hidden/collapsed, clientHeight can transiently be 0.
      // Treat that as "measurement unavailable" so we do not collapse the
      // render window to a single row and desync graph drawing from row cells.
      if (scroller.clientHeight <= 0) {
        if (pendingRetryFrame === null) {
          pendingRetryFrame = window.requestAnimationFrame(() => {
            pendingRetryFrame = null;
            update();
          });
        }
        return;
      }
      const next = computeViewportRange(
        scroller.scrollTop,
        scroller.clientHeight,
        rowHeight,
        totalRows,
      );
      setRange((prev) => {
        // After `totalRows` was 0, internal state stays at degenerate {0,0,0,0}.
        // Hysteresis would then keep prev because |next.endRow - prev.endRow| < threshold
        // even though the overscan window must expand for HistoryGraphSvg.
        if (
          totalRows > 1 &&
          prev.overscanStartRow === prev.overscanEndRow
        ) {
          return next;
        }
        if (
          Math.abs(next.startRow - prev.startRow) < DEFAULT_HYSTERESIS_ROWS &&
          Math.abs(next.endRow - prev.endRow) < DEFAULT_HYSTERESIS_ROWS
        ) {
          return prev;
        }
        return next;
      });
    };

    update();
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      if (pendingRetryFrame !== null) {
        window.cancelAnimationFrame(pendingRetryFrame);
      }
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [rowHeight, totalRows]);

  return useMemo(() => {
    if (totalRows <= 0) {
      return {
        startRow: 0,
        endRow: 0,
        overscanStartRow: 0,
        overscanEndRow: 0,
      };
    }
    return range;
  }, [range, totalRows]);
}
