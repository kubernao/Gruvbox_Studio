import { describe, expect, it } from 'vitest';
import {
  cancelSmoothTranscriptScroll,
  distanceFromScrollBottom,
  scrollTranscriptToBottom,
  scrollTranscriptToBottomAnimated,
  smoothScrollTranscriptToBottom,
  wasScrolledToBottomBeforeGrowth,
} from '../../src/frontend/features/assistant/hooks/useStickyScrollBottom';

describe('distanceFromScrollBottom', () => {
  it('returns zero when scrolled to the bottom', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: 200, writable: true });
    expect(distanceFromScrollBottom(el)).toBe(0);
  });

  it('returns positive distance when scrolled up', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: 50, writable: true });
    expect(distanceFromScrollBottom(el)).toBe(150);
  });
});

describe('wasScrolledToBottomBeforeGrowth', () => {
  it('returns true when the viewport was flush with the previous scroll height', () => {
    expect(wasScrolledToBottomBeforeGrowth(200, 200, 400)).toBe(true);
  });

  it('returns false when the user had scrolled up before new content arrived', () => {
    expect(wasScrolledToBottomBeforeGrowth(50, 200, 400)).toBe(false);
  });
});

describe('scrollTranscriptToBottomAnimated', () => {
  it('uses eased scroll when behavior is smooth and reduced motion is off', async () => {
    cancelSmoothTranscriptScroll();
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      }) as MediaQueryList) as typeof window.matchMedia;

    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
    let scrollTop = 0;
    Object.defineProperty(el, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true,
    });

    scrollTranscriptToBottomAnimated(el, false, 'smooth');
    await new Promise<void>((resolve) => {
      const wait = (): void => {
        if (scrollTop >= 299) {
          resolve();
          return;
        }
        requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    });

    expect(scrollTop).toBeGreaterThan(0);
    expect(scrollTop).toBeLessThanOrEqual(300);
    cancelSmoothTranscriptScroll();
    window.matchMedia = matchMedia;
  });

  it('snaps instantly when behavior is instant', () => {
    cancelSmoothTranscriptScroll();
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
    let scrollTop = 0;
    Object.defineProperty(el, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true,
    });

    scrollTranscriptToBottomAnimated(el, false, 'instant');
    expect(scrollTop).toBe(300);
  });
});

describe('smoothScrollTranscriptToBottom', () => {
  it('eases scrollTop toward the bottom across animation frames', async () => {
    cancelSmoothTranscriptScroll();
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
    let scrollTop = 0;
    Object.defineProperty(el, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true,
    });

    smoothScrollTranscriptToBottom(el, false);
    await new Promise<void>((resolve) => {
      const wait = (): void => {
        if (scrollTop >= 299) {
          resolve();
          return;
        }
        requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    });

    expect(scrollTop).toBeGreaterThan(0);
    expect(scrollTop).toBeLessThanOrEqual(300);
    cancelSmoothTranscriptScroll();
    scrollTranscriptToBottom(el, false);
    expect(scrollTop).toBe(300);
  });
});
