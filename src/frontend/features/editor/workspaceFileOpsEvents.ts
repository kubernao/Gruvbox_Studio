/**
 * Cross-feature events when explorer rename/move changes an on-disk path that may
 * already be open in the editor tab strip.
 */

export const DOCUMENT_REPOINT_EVENT = 'app:document-repoint';

export type DocumentRepointDetail = {
  fromPath: string;
  toPath: string;
};

/**
 * Notifies listeners that a file or folder path changed on disk so open editor
 * tabs can retarget their in-memory keys to the new absolute path.
 */
export function dispatchDocumentRepoint(fromPath: string, toPath: string): void {
  if (typeof window === 'undefined' || fromPath === toPath) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<DocumentRepointDetail>(DOCUMENT_REPOINT_EVENT, {
      detail: { fromPath, toPath },
    }),
  );
}

export const FILE_DELETED_EVENT = 'app:file-deleted';

export type FileDeletedDetail = {
  path: string;
};

/**
 * Notifies listeners that a workspace file was deleted from disk so editor tabs
 * and explorer selection can close or retarget without wiping unrelated buffers.
 */
export function dispatchFileDeleted(path: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<FileDeletedDetail>(FILE_DELETED_EVENT, {
      detail: { path },
    }),
  );
}
