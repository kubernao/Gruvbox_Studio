import {
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  Annotation,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view';

export interface SuggestedChange {
  id: string;
  from: number;
  to: number;
  originalText: string;
  suggestedText: string;
  authorId: string;
  createdAt: number;
  updatedAt: number;
  status: 'pending' | 'accepted' | 'rejected';
}

type SuggestState = {
  enabled: boolean;
  suggestions: SuggestedChange[];
  activeSuggestionId: string | null;
};

const setSuggestStateEffect = StateEffect.define<SuggestState>();
const bypassSuggestFilter = Annotation.define<boolean>();

function nextSuggestionId(): string {
  return `suggest_${Math.random().toString(36).slice(2, 10)}`;
}

const suggestField = StateField.define<SuggestState>({
  create: () => ({ enabled: false, suggestions: [], activeSuggestionId: null }),
  update(value, tr) {
    let next: SuggestState = value;
    if (tr.docChanged) {
      next = {
        ...next,
        suggestions: next.suggestions.map((suggestion) => ({
          ...suggestion,
          from: tr.changes.mapPos(suggestion.from, -1),
          to: tr.changes.mapPos(suggestion.to, 1),
        })),
      };
    }
    for (const effect of tr.effects) {
      if (effect.is(setSuggestStateEffect)) {
        next = effect.value;
      }
    }
    return next;
  },
});

const suggestDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_value, tr) {
    const state = tr.state.field(suggestField);
    const builder = new RangeSetBuilder<Decoration>();
    for (const suggestion of state.suggestions) {
      if (suggestion.status !== 'pending') {
        continue;
      }
      if (suggestion.from < suggestion.to) {
        builder.add(
          suggestion.from,
          suggestion.to,
          Decoration.mark({
            class: 'cm-suggest-delete',
            attributes: { 'data-suggestion-id': suggestion.id },
          })
        );
      }
      if (suggestion.suggestedText.length > 0) {
        builder.add(
          suggestion.from,
          suggestion.from,
          Decoration.widget({
            side: 1,
            widget: new (class extends WidgetType {
              toDOM(): HTMLElement {
                const el = document.createElement('span');
                el.className = 'cm-suggest-insert';
                el.textContent = suggestion.suggestedText;
                el.setAttribute('data-suggestion-id', suggestion.id);
                return el;
              }
            })(),
          })
        );
      }
    }
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f),
});

function emitSuggestState(view: EditorView): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent('gruvbox:editor-suggestions-updated', { detail: view.state.field(suggestField) })
  );
}

function updateSuggestState(view: EditorView, mutator: (state: SuggestState) => SuggestState): boolean {
  const current = view.state.field(suggestField);
  const next = mutator(current);
  view.dispatch({ effects: [setSuggestStateEffect.of(next)] });
  emitSuggestState(view);
  return true;
}

export function toggleSuggestMode(view: EditorView): boolean {
  return updateSuggestState(view, (state) => ({ ...state, enabled: !state.enabled }));
}

function getActiveSuggestion(state: SuggestState): SuggestedChange | null {
  if (!state.activeSuggestionId) {
    return state.suggestions.find((suggestion) => suggestion.status === 'pending') ?? null;
  }
  return state.suggestions.find((suggestion) => suggestion.id === state.activeSuggestionId) ?? null;
}

export function acceptActiveSuggestion(view: EditorView): boolean {
  const state = view.state.field(suggestField);
  const suggestion = getActiveSuggestion(state);
  if (!suggestion || suggestion.status !== 'pending') {
    return false;
  }
  view.dispatch({
    changes: { from: suggestion.from, to: suggestion.to, insert: suggestion.suggestedText },
    selection: EditorSelection.cursor(suggestion.from + suggestion.suggestedText.length),
    annotations: bypassSuggestFilter.of(true),
  });
  return updateSuggestState(view, (curr) => ({
    ...curr,
    suggestions: curr.suggestions.map((item) =>
      item.id === suggestion.id ? { ...item, status: 'accepted', updatedAt: Date.now() } : item
    ),
    activeSuggestionId: null,
  }));
}

export function rejectActiveSuggestion(view: EditorView): boolean {
  const state = view.state.field(suggestField);
  const suggestion = getActiveSuggestion(state);
  if (!suggestion || suggestion.status !== 'pending') {
    return false;
  }
  return updateSuggestState(view, (curr) => ({
    ...curr,
    suggestions: curr.suggestions.map((item) =>
      item.id === suggestion.id ? { ...item, status: 'rejected', updatedAt: Date.now() } : item
    ),
    activeSuggestionId: null,
  }));
}

const suggestFilter = EditorState.transactionFilter.of((tr) => {
  const state = tr.startState.field(suggestField, false);
  if (!state || !state.enabled || !tr.docChanged || tr.annotation(bypassSuggestFilter)) {
    return tr;
  }

  const nextSuggestions = [...state.suggestions];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const originalText = tr.startState.sliceDoc(fromA, toA);
    const suggestedText = inserted.toString();
    if (originalText === suggestedText) {
      return;
    }
    const id = nextSuggestionId();
    nextSuggestions.push({
      id,
      from: fromA,
      to: toA,
      originalText,
      suggestedText,
      authorId: 'local-user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'pending',
    });
  });

  if (nextSuggestions.length === state.suggestions.length) {
    return tr;
  }

  return {
    selection: tr.startState.selection,
    effects: [
      setSuggestStateEffect.of({
        ...state,
        suggestions: nextSuggestions,
        activeSuggestionId: nextSuggestions[nextSuggestions.length - 1]?.id ?? null,
      }),
    ],
  };
});

export const suggestKeymap = keymap.of([
  { key: 'Mod-Shift-s', run: toggleSuggestMode },
  { key: 'Mod-Alt-a', run: acceptActiveSuggestion },
  { key: 'Mod-Alt-r', run: rejectActiveSuggestion },
]);

export function suggestChangesExtension(): Extension {
  return [suggestField, suggestDecorations, suggestFilter, suggestKeymap];
}
