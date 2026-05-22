import type * as monaco from 'monaco-editor';

/**
 * Synchronizes scroll position between two Monaco editors with reentrancy guards.
 */
export function createMonacoDiffScrollCoordinator(params: {
  primary: monaco.editor.ICodeEditor;
  secondary: monaco.editor.ICodeEditor;
  epsilon?: number;
}): { dispose: () => void } {
  const { primary, secondary } = params;
  const epsilon = params.epsilon ?? 1;
  let syncing = false;

  const syncToPeer = (source: monaco.editor.ICodeEditor, target: monaco.editor.ICodeEditor): void => {
    if (syncing) {
      return;
    }
    const sourceTop = source.getScrollTop();
    const sourceLeft = source.getScrollLeft();
    const topDelta = Math.abs(target.getScrollTop() - sourceTop);
    const leftDelta = Math.abs(target.getScrollLeft() - sourceLeft);
    if (topDelta <= epsilon && leftDelta <= epsilon) {
      return;
    }
    syncing = true;
    try {
      target.setScrollTop(sourceTop);
      target.setScrollLeft(sourceLeft);
    } finally {
      syncing = false;
    }
  };

  const leftSubscription = primary.onDidScrollChange(() => syncToPeer(primary, secondary));
  const rightSubscription = secondary.onDidScrollChange(() => syncToPeer(secondary, primary));

  return {
    dispose: () => {
      leftSubscription.dispose();
      rightSubscription.dispose();
    },
  };
}

