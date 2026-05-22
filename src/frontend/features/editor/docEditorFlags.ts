export type DocEditorFlags = {
  collab: boolean;
  comments: boolean;
  suggest: boolean;
  diagnostics: boolean;
  slashCommands: boolean;
};

function readLocalFlag(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function readDocEditorFlags(): DocEditorFlags {
  return {
    collab: readLocalFlag('gruvbox-editor-collab'),
    comments: readLocalFlag('gruvbox-editor-comments'),
    suggest: readLocalFlag('gruvbox-editor-suggest'),
    diagnostics: readLocalFlag('gruvbox-editor-diagnostics'),
    slashCommands: readLocalFlag('gruvbox-editor-slash'),
  };
}
