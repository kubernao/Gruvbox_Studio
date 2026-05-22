/** Dispatched after a user-initiated write of a workspace file to disk (editor save, diff merge save). */
export const WORKSPACE_FILE_SAVED_EVENT = 'app:workspace-file-saved';

export type WorkspaceFileSavedDetail = { path?: string };

export function dispatchWorkspaceFileSaved(path?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceFileSavedDetail>(WORKSPACE_FILE_SAVED_EVENT, {
      detail: { path },
    }),
  );
}
