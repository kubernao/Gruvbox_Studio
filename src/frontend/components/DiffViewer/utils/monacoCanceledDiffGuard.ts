import { isExpectedMonacoCancellation } from './monacoCancellation.js';

/**
 * Monaco cancels in-flight work whenever models are swapped or editors are disposed during quick UI
 * transitions (diff workers, word highlighters, delayers). Those expected cancellations can surface
 * as unhandled rejections or dev-server overlay errors; this module installs a guard that ignores only
 * known Monaco cancellation patterns while letting every other error continue to surface.
 */

type RejectionHandler = (event: PromiseRejectionEvent) => void;
type ErrorHandler = (event: ErrorEvent) => void;

let refCount = 0;
let handler: RejectionHandler | null = null;
let errorHandler: ErrorHandler | null = null;
let previousOnError: OnErrorEventHandler | null = null;
let reportErrorRestore: (() => void) | null = null;

/**
 * Installs a shared window-level rejection guard for Monaco diff cancellation noise and returns a
 * disposer that removes the guard when no active consumers remain.
 */
export function installMonacoCanceledDiffGuard(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  if (refCount === 0) {
    handler = (event: PromiseRejectionEvent) => {
      if (!isExpectedMonacoCancellation(event.reason)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    errorHandler = (event: ErrorEvent) => {
      if (!isExpectedMonacoCancellation(event.error) && !isExpectedMonacoCancellation({ message: event.message, stack: event.error instanceof Error ? event.error.stack : '' })) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('unhandledrejection', handler);
    window.addEventListener('error', errorHandler, { capture: true });

    previousOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      if (isExpectedMonacoCancellation(error) || isExpectedMonacoCancellation({ message: String(message ?? '') })) {
        return true;
      }
      if (typeof previousOnError === 'function') {
        return previousOnError(message, source, lineno, colno, error);
      }
      return false;
    };

    if (typeof globalThis.reportError === 'function') {
      const originalReportError = globalThis.reportError.bind(globalThis);
      globalThis.reportError = ((error: unknown) => {
        if (isExpectedMonacoCancellation(error)) {
          return;
        }
        originalReportError(error);
      }) as typeof globalThis.reportError;
      reportErrorRestore = () => {
        globalThis.reportError = originalReportError;
      };
    } else {
      reportErrorRestore = null;
    }
  }

  refCount += 1;

  return () => {
    if (typeof window === 'undefined') {
      return;
    }
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && handler) {
      window.removeEventListener('unhandledrejection', handler);
      if (errorHandler) {
        window.removeEventListener('error', errorHandler, { capture: true });
      }
      if (window.onerror === null || window.onerror === previousOnError) {
        // no-op
      } else if (window.onerror) {
        window.onerror = previousOnError;
      } else {
        window.onerror = previousOnError;
      }
      if (reportErrorRestore) {
        reportErrorRestore();
      }
      handler = null;
      errorHandler = null;
      previousOnError = null;
      reportErrorRestore = null;
    }
  };
}
