import * as monaco from 'monaco-editor';

/**
 * A minimal synchronization contract shared by Monaco text models and test doubles.
 */
interface SyncableTextModel {
  getValue(): string;
  setValue(value: string): void;
  onDidChangeContent(listener: () => void): { dispose(): void };
}

/**
 * Keeps a read-only mirror model in sync with one authoritative model.
 *
 * The authoritative model remains the only writable source of truth. The mirror
 * updates from authoritative change events and never writes back, so merge logic
 * can safely patch one model while two diff editors stay visually aligned.
 */
export function createMonacoMirrorModelSync(params: {
  authoritativeModel: SyncableTextModel;
  mirrorModel: SyncableTextModel;
  languageId: string;
  setModelLanguage?: (model: SyncableTextModel, languageId: string) => void;
}): {
  syncNow: () => void;
  setLanguage: (languageId: string) => void;
  dispose: () => void;
} {
  const { authoritativeModel, mirrorModel } = params;
  const setModelLanguage =
    params.setModelLanguage ??
    ((model: SyncableTextModel, languageId: string) => {
      monaco.editor.setModelLanguage(model as monaco.editor.ITextModel, languageId);
    });

  let suppress = false;

  const syncNow = (): void => {
    const nextValue = authoritativeModel.getValue();
    if (mirrorModel.getValue() === nextValue) {
      return;
    }
    suppress = true;
    try {
      mirrorModel.setValue(nextValue);
    } finally {
      suppress = false;
    }
  };

  const subscription = authoritativeModel.onDidChangeContent(() => {
    if (suppress) {
      return;
    }
    syncNow();
  });

  const setLanguage = (languageId: string): void => {
    setModelLanguage(authoritativeModel, languageId);
    setModelLanguage(mirrorModel, languageId);
  };

  syncNow();
  setLanguage(params.languageId);

  return {
    syncNow,
    setLanguage,
    dispose: () => subscription.dispose(),
  };
}

