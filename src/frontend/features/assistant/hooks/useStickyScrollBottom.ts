import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** Pixels from the bottom edge treated as "at bottom" for re-enabling follow mode. */
const REPIN_THRESHOLD_PX = 10;

/** Pixels from the bottom above which follow mode turns off. */
const UNPIN_DISTANCE_PX = 80;

/** Stop easing when within this many pixels of the live bottom edge. */
const SMOOTH_SCROLL_EPSILON_PX = 1.5;

/** Per-frame lerp toward the transcript bottom while follow mode is active. */
const SMOOTH_SCROLL_LERP = 0.32;

/**
 * Returns how many pixels of content sit below the visible viewport bottom edge.
 * Zero means the user is scrolled flush to the bottom; larger values mean they
 * have scrolled up into older transcript content.
 */
export function distanceFromScrollBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

/**
 * Returns whether the scroll position was at the bottom before new content
 * increased `scrollHeight`, using the previous layout's scroll height snapshot.
 */
export function wasScrolledToBottomBeforeGrowth(
  scrollTop: number,
  clientHeight: number,
  previousScrollHeight: number,
  thresholdPx: number = REPIN_THRESHOLD_PX,
): boolean {
  if (previousScrollHeight <= 0) {
    return true;
  }
  return scrollTop + clientHeight >= previousScrollHeight - thresholdPx;
}

/**
 * Scrolls a transcript container to its bottom edge and, when follow mode is
 * active, also scrolls nested tool-preview bodies so streaming tool output
 * stays visible inside building cards.
 */
function scrollNestedToolCardBodies(element: HTMLElement): void {
  const cards = element.querySelectorAll('.ai-tool-preview__scroll-body');
  for (const card of cards) {
    (card as HTMLElement).scrollTop = (card as HTMLElement).scrollHeight;
  }
}

function maxScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

export function scrollTranscriptToBottom(element: HTMLElement, followNestedToolCards: boolean): void {
  element.scrollTop = maxScrollTop(element);
  if (followNestedToolCards) {
    scrollNestedToolCardBodies(element);
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

let smoothScrollFrameId: number | null = null;

/**
 * Cancels any in-flight eased scroll animation on the transcript container.
 */
export function cancelSmoothTranscriptScroll(): void {
  if (smoothScrollFrameId !== null) {
    cancelAnimationFrame(smoothScrollFrameId);
    smoothScrollFrameId = null;
  }
}

/**
 * Eases the transcript toward its bottom edge across animation frames so
 * streaming line growth does not jump the viewport in whole-line steps.
 */
export function smoothScrollTranscriptToBottom(
  element: HTMLElement,
  followNestedToolCards: boolean,
): void {
  const step = (): void => {
    const targetTop = maxScrollTop(element);
    const distance = targetTop - element.scrollTop;
    if (Math.abs(distance) <= SMOOTH_SCROLL_EPSILON_PX) {
      element.scrollTop = targetTop;
      smoothScrollFrameId = null;
      if (followNestedToolCards) {
        scrollNestedToolCardBodies(element);
      }
      return;
    }
    const nextTop = element.scrollTop + distance * SMOOTH_SCROLL_LERP;
    element.scrollTop = distance > 0 ? Math.min(targetTop, nextTop) : Math.max(targetTop, nextTop);
    smoothScrollFrameId = requestAnimationFrame(step);
  };

  if (smoothScrollFrameId === null) {
    smoothScrollFrameId = requestAnimationFrame(step);
  }
}

/**
 * Scrolls the transcript to the bottom using instant or eased motion depending
 * on user accessibility settings and the requested behavior.
 */
export function scrollTranscriptToBottomAnimated(
  element: HTMLElement,
  followNestedToolCards: boolean,
  behavior: 'instant' | 'smooth',
): void {
  if (behavior === 'smooth' && !prefersReducedMotion()) {
    smoothScrollTranscriptToBottom(element, followNestedToolCards);
    return;
  }
  cancelSmoothTranscriptScroll();
  scrollTranscriptToBottom(element, followNestedToolCards);
}

/**
 * Keeps an AI chat transcript pinned to the bottom while the user remains near
 * the latest messages, and stops forcing scroll when they move up to read history.
 * Call `pinToBottom` when the user sends a message or restores a session so a
 * deliberate jump to the live edge resumes follow mode.
 */
export function useStickyScrollBottom(
  scrollRef: React.RefObject<HTMLElement | null>,
  contentDeps: unknown[],
  scrollContainerMounted: boolean,
): { pinToBottom: () => void } {
  const followBottomRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const lastUserScrollTopRef = useRef(0);

  const scrollToBottomIfFollowing = useCallback(
    (element: HTMLElement): void => {
      isProgrammaticScrollRef.current = true;
      scrollTranscriptToBottom(element, true);
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    },
    [],
  );

  const pinToBottom = useCallback((): void => {
    followBottomRef.current = true;
    const el = scrollRef.current;
    if (el) {
      cancelSmoothTranscriptScroll();
      scrollToBottomIfFollowing(el);
      lastUserScrollTopRef.current = el.scrollTop;
    }
  }, [scrollRef, scrollToBottomIfFollowing]);

  const releaseFollow = useCallback((): void => {
    followBottomRef.current = false;
    cancelSmoothTranscriptScroll();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollContainerMounted) {
      return;
    }

    const onScroll = (): void => {
      if (isProgrammaticScrollRef.current) {
        return;
      }

      const distance = distanceFromScrollBottom(el);
      const currentScrollTop = el.scrollTop;

      if (distance > UNPIN_DISTANCE_PX) {
        releaseFollow();
      } else if (distance <= REPIN_THRESHOLD_PX) {
        followBottomRef.current = true;
      } else if (currentScrollTop < lastUserScrollTopRef.current - 2) {
        releaseFollow();
      }

      lastUserScrollTopRef.current = currentScrollTop;
    };

    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY >= 0) {
        return;
      }
      if (distanceFromScrollBottom(el) > REPIN_THRESHOLD_PX) {
        releaseFollow();
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    lastUserScrollTopRef.current = el.scrollTop;
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      cancelSmoothTranscriptScroll();
    };
  }, [releaseFollow, scrollContainerMounted, scrollRef]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollContainerMounted) {
      return;
    }

    if (followBottomRef.current) {
      scrollToBottomIfFollowing(el);
      lastUserScrollTopRef.current = el.scrollTop;
    }
  }, [scrollContainerMounted, scrollRef, scrollToBottomIfFollowing, ...contentDeps]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollContainerMounted) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!followBottomRef.current) {
        return;
      }
      const distance = distanceFromScrollBottom(el);
      if (distance > UNPIN_DISTANCE_PX) {
        releaseFollow();
        return;
      }
      if (distance <= REPIN_THRESHOLD_PX) {
        scrollToBottomIfFollowing(el);
      }
    });

    for (const child of el.children) {
      resizeObserver.observe(child);
    }
    return () => resizeObserver.disconnect();
  }, [releaseFollow, scrollContainerMounted, scrollRef, scrollToBottomIfFollowing, ...contentDeps]);

  return { pinToBottom };
}
