/**
 * Lets the always-mounted file-ops controller invoke editor handlers that live
 * inside EditorPane without duplicating save/close/new logic or relying on a
 * fragile palette round-trip when the editor tree is mounted.
 */

export type EditorFileActionHandlers = {
  save: () => void;
  saveAs: () => void;
  closeTab: () => void;
  newMarkdown: () => void;
};

let activeHandlers: EditorFileActionHandlers | null = null;

/**
 * Registers the active editor pane handlers; returns an unregister function.
 */
export function registerEditorFileActionHandlers(handlers: EditorFileActionHandlers): () => void {
  activeHandlers = handlers;
  return () => {
    if (activeHandlers === handlers) {
      activeHandlers = null;
    }
  };
}

/**
 * Invokes a registered editor file action when EditorPane is mounted.
 */
export function invokeEditorFileAction(action: keyof EditorFileActionHandlers): void {
  activeHandlers?.[action]?.();
}
