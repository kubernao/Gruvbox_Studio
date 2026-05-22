/**
 * Mutable prerequisites for palette item disabled states.
 * Feature panels update via setPalettePrereqs; CommandPalette subscribes with useSyncExternalStore.
 */

export type PalettePrereqs = {
  editorCanSave: boolean;
  /** True when a document tab is open (text or PDF), so “export copy” can run. */
  editorCanExportFile: boolean;
  /** Text buffer non-empty, or PDF tab where extraction can run. */
  editorCanListenDocument: boolean;
  /** Text/Markdown tab only — PDF has no editor selection. */
  editorCanListenSelection: boolean;
  editorActiveIsPdf: boolean;
  gitIsRepo: boolean;
  gitRepoPathEmpty: boolean;
  gitIsBusy: boolean;
  gitSelectedDocument: string;
};

const defaultPrereqs: PalettePrereqs = {
  editorCanSave: false,
  editorCanExportFile: false,
  editorCanListenDocument: false,
  editorCanListenSelection: false,
  editorActiveIsPdf: false,
  gitIsRepo: false,
  gitRepoPathEmpty: true,
  gitIsBusy: false,
  gitSelectedDocument: '',
};

let snapshot: PalettePrereqs = { ...defaultPrereqs };
const listeners = new Set<() => void>();

export function setPalettePrereqs(patch: Partial<PalettePrereqs>): void {
  const next: PalettePrereqs = { ...snapshot, ...patch };
  if (
    next.editorCanSave === snapshot.editorCanSave &&
    next.editorCanExportFile === snapshot.editorCanExportFile &&
    next.editorCanListenDocument === snapshot.editorCanListenDocument &&
    next.editorCanListenSelection === snapshot.editorCanListenSelection &&
    next.editorActiveIsPdf === snapshot.editorActiveIsPdf &&
    next.gitIsRepo === snapshot.gitIsRepo &&
    next.gitRepoPathEmpty === snapshot.gitRepoPathEmpty &&
    next.gitIsBusy === snapshot.gitIsBusy &&
    next.gitSelectedDocument === snapshot.gitSelectedDocument
  ) {
    return;
  }
  snapshot = next;
  for (const cb of listeners) {
    cb();
  }
}

export function resetPalettePrereqs(): void {
  snapshot = { ...defaultPrereqs };
  for (const cb of listeners) {
    cb();
  }
}

export function subscribePalettePrereqs(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getPalettePrereqsSnapshot(): PalettePrereqs {
  return snapshot;
}
