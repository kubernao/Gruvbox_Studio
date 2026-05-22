import type { Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from '@codemirror/view';
import { forEachMarkdownDecorMarkInRanges } from './markdownDecoratorAtomics';

/**
 * Zero-width inline replace so concealed punctuation does not capture pointer events.
 * Bare `Decoration.replace({})` breaks click-drag selection; widgets must use
 * `ignoreEvent() { return false }` like CM's special-char widgets.
 */
class MarkdownConcealWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-md-conceal-widget';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  ignoreEvent() {
    return false;
  }

  get estimatedHeight() {
    return -1;
  }
}

/** Renders list markers in WYSIWYG mode instead of hiding them. */
class MarkdownListMarkWidget extends WidgetType {
  constructor(private readonly displayText: string) {
    super();
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-md-list-mark-widget';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = this.displayText;
    return el;
  }

  ignoreEvent() {
    return false;
  }

  get estimatedHeight() {
    return -1;
  }
}

function listMarkDisplayText(rawMark: string): string {
  const marker = rawMark.trim();
  if (marker === '-' || marker === '+' || marker === '*') {
    return '• ';
  }
  return `${marker} `;
}

function buildConcealSet(view: EditorView): DecorationSet {
  const state = view.state;
  const decos: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    forEachMarkdownDecorMarkInRanges(state, [{ from, to }], (markFrom, markTo, nodeName) => {
      if (nodeName === 'ListMark') {
        const rawMark = state.doc.sliceString(markFrom, markTo);
        decos.push(
          Decoration.replace({ widget: new MarkdownListMarkWidget(listMarkDisplayText(rawMark)) }).range(markFrom, markTo)
        );
        return;
      }
      decos.push(Decoration.replace({ widget: new MarkdownConcealWidget() }).range(markFrom, markTo));
    });
  }

  return decos.length === 0 ? Decoration.none : Decoration.set(decos, true);
}

class MarkdownFormattingConceal {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildConcealSet(view);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged
    ) {
      this.decorations = buildConcealSet(update.view);
    }
  }
}

/**
 * Conceals markdown punctuation by replacing those ranges with inline widget
 * decorations (no layout width for most marks), not opacity-only marks.
 */
export const markdownFormattingConceal = ViewPlugin.fromClass(MarkdownFormattingConceal, {
  decorations: (v) => v.decorations,
});
