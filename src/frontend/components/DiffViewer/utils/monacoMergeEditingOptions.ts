import type * as monaco from 'monaco-editor';

/**
 * Editor options applied while merge-editing so autocomplete and inline AI suggestions
 * do not fight manual conflict resolution in the modified / result pane.
 */
export const MERGE_MODE_NO_AUTOCOMPLETE_OPTIONS = {
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  acceptSuggestionOnEnter: 'off' as const,
  tabCompletion: 'off' as const,
  wordBasedSuggestions: 'off' as const,
  parameterHints: { enabled: false },
  inlineSuggest: { enabled: false },
} as monaco.editor.IEditorOptions;
