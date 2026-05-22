type UxSignalSnapshot = {
  totalClicks: number;
  deadClicks: number;
  rageClicks: number;
  lastUpdatedAt: number | null;
};

type ClickPoint = {
  x: number;
  y: number;
  ts: number;
};

declare global {
  interface Window {
    __gruvboxUxSignals?: UxSignalSnapshot;
  }
}

const CLICK_WINDOW_MS = 1_000;
const RAGE_RADIUS_PX = 24;
const RAGE_CLICK_THRESHOLD = 3;

function isInteractiveElement(target: Element | null): boolean {
  if (!target) {
    return false;
  }
  return Boolean(
    target.closest(
      'button,a,input,select,textarea,[role="button"],[role="link"],[contenteditable="true"],[data-e2e-file-name]'
    )
  );
}

function shouldEnableUxSignals(): boolean {
  try {
    if (window.localStorage.getItem('gruvbox-ux-signals') === '1') {
      return true;
    }
  } catch {
    // localStorage might be unavailable in some contexts.
  }

  return typeof (window as unknown as { electronAPI?: { e2eGetFixtureRoot?: unknown } }).electronAPI
    ?.e2eGetFixtureRoot === 'function';
}

export function installUxSignalTracker(): void {
  if (typeof window === 'undefined' || !shouldEnableUxSignals()) {
    return;
  }

  if (window.__gruvboxUxSignals) {
    return;
  }

  const clickHistory: ClickPoint[] = [];
  const snapshot: UxSignalSnapshot = {
    totalClicks: 0,
    deadClicks: 0,
    rageClicks: 0,
    lastUpdatedAt: null,
  };

  const pruneHistory = (now: number) => {
    while (clickHistory.length > 0 && now - clickHistory[0].ts > CLICK_WINDOW_MS) {
      clickHistory.shift();
    }
  };

  const onClick = (event: MouseEvent) => {
    const now = Date.now();
    snapshot.totalClicks += 1;
    snapshot.lastUpdatedAt = now;

    if (!isInteractiveElement(event.target as Element | null)) {
      snapshot.deadClicks += 1;
    }

    clickHistory.push({ x: event.clientX, y: event.clientY, ts: now });
    pruneHistory(now);

    const nearbyClicks = clickHistory.filter((point) => {
      return Math.abs(point.x - event.clientX) <= RAGE_RADIUS_PX && Math.abs(point.y - event.clientY) <= RAGE_RADIUS_PX;
    });
    if (nearbyClicks.length >= RAGE_CLICK_THRESHOLD) {
      snapshot.rageClicks += 1;
      clickHistory.length = 0;
    }

    window.__gruvboxUxSignals = { ...snapshot };
  };

  window.__gruvboxUxSignals = { ...snapshot };
  window.addEventListener('click', onClick, { capture: true });
}

