import { ChangeDesc, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view';

export interface CommentThread {
  id: string;
  from: number;
  to: number;
  createdAt: number;
  updatedAt: number;
  status: 'open' | 'resolved';
  authorId: string;
  snippet: string;
}

type CommentState = {
  threads: CommentThread[];
  activeThreadId: string | null;
};

const updateCommentsEffect = StateEffect.define<CommentState>();

function nextCommentId(): string {
  return `comment_${Math.random().toString(36).slice(2, 10)}`;
}

function mapThread(thread: CommentThread, changes: ChangeDesc): CommentThread {
  const from = changes.mapPos(thread.from, -1);
  const to = changes.mapPos(thread.to, 1);
  return { ...thread, from: Math.max(0, from), to: Math.max(from, to) };
}

function commentBadge(thread: CommentThread): Decoration {
  return Decoration.widget({
    side: 1,
    widget: new (class extends WidgetType {
      toDOM(): HTMLElement {
        const el = document.createElement('span');
        el.className = `cm-comment-badge cm-comment-${thread.status}`;
        el.textContent = thread.status === 'resolved' ? 'Resolved' : 'Comment';
        el.setAttribute('aria-label', `Comment ${thread.id}`);
        return el;
      }
    })(),
  });
}

const commentField = StateField.define<CommentState>({
  create: () => ({ threads: [], activeThreadId: null }),
  update(value, tr) {
    let next: CommentState = value;
    if (tr.docChanged) {
      next = {
        ...next,
        threads: next.threads.map((thread) => mapThread(thread, tr.changes)),
      };
    }
    for (const effect of tr.effects) {
      if (effect.is(updateCommentsEffect)) {
        next = effect.value;
      }
    }
    return next;
  },
});

const commentDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_value, tr) {
    const state = tr.state.field(commentField);
    const builder = new RangeSetBuilder<Decoration>();
    for (const thread of state.threads) {
      if (thread.status !== 'open') {
        continue;
      }
      if (thread.from < thread.to) {
        builder.add(thread.from, thread.to, Decoration.mark({ class: 'cm-comment-anchor' }));
      }
      builder.add(thread.to, thread.to, commentBadge(thread));
    }
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f),
});

function emitCommentState(state: EditorState): void {
  if (typeof window === 'undefined') {
    return;
  }
  const payload = state.field(commentField);
  window.dispatchEvent(new CustomEvent('gruvbox:editor-comments-updated', { detail: payload }));
}

function updateCommentState(view: EditorView, mutator: (state: CommentState) => CommentState): boolean {
  const curr = view.state.field(commentField);
  const next = mutator(curr);
  view.dispatch({ effects: [updateCommentsEffect.of(next)] });
  emitCommentState(view.state);
  return true;
}

export function createCommentFromSelection(view: EditorView): boolean {
  const main = view.state.selection.main;
  if (main.empty) {
    return false;
  }
  const from = Math.min(main.from, main.to);
  const to = Math.max(main.from, main.to);
  const snippet = view.state.sliceDoc(from, to).slice(0, 240);
  return updateCommentState(view, (state) => {
    const thread: CommentThread = {
      id: nextCommentId(),
      from,
      to,
      snippet,
      authorId: 'local-user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'open',
    };
    return { threads: [...state.threads, thread], activeThreadId: thread.id };
  });
}

function moveToRelativeComment(view: EditorView, direction: 1 | -1): boolean {
  const state = view.state.field(commentField);
  const openThreads = state.threads.filter((thread) => thread.status === 'open');
  if (openThreads.length === 0) {
    return false;
  }
  const currentIndex = Math.max(
    0,
    openThreads.findIndex((thread) => thread.id === state.activeThreadId)
  );
  const offset = direction > 0 ? 1 : -1;
  const nextIndex = (currentIndex + offset + openThreads.length) % openThreads.length;
  const target = openThreads[nextIndex];
  view.dispatch({
    selection: { anchor: target.from, head: target.to },
    effects: [updateCommentsEffect.of({ ...state, activeThreadId: target.id })],
    scrollIntoView: true,
  });
  emitCommentState(view.state);
  return true;
}

export function resolveActiveComment(view: EditorView): boolean {
  const state = view.state.field(commentField);
  if (!state.activeThreadId) {
    return false;
  }
  return updateCommentState(view, (curr) => ({
    ...curr,
    threads: curr.threads.map((thread) =>
      thread.id === curr.activeThreadId ? { ...thread, status: 'resolved', updatedAt: Date.now() } : thread
    ),
  }));
}

export function reopenActiveComment(view: EditorView): boolean {
  const state = view.state.field(commentField);
  if (!state.activeThreadId) {
    return false;
  }
  return updateCommentState(view, (curr) => ({
    ...curr,
    threads: curr.threads.map((thread) =>
      thread.id === curr.activeThreadId ? { ...thread, status: 'open', updatedAt: Date.now() } : thread
    ),
  }));
}

export const commentsKeymap = keymap.of([
  { key: 'Mod-Alt-m', run: createCommentFromSelection },
  { key: 'Alt-]', run: (view) => moveToRelativeComment(view, 1) },
  { key: 'Alt-[', run: (view) => moveToRelativeComment(view, -1) },
  { key: 'Mod-Alt-]', run: resolveActiveComment },
  { key: 'Mod-Alt-[', run: reopenActiveComment },
]);

export function commentsExtension(): Extension {
  return [commentField, commentDecorations, commentsKeymap];
}
