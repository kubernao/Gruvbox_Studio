import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import type { AiChangedSection } from '../../shared/ai/extractAiChangedLinesFromUnifiedDiff';

function filterUsableSections(
  view: EditorView,
  sections: readonly AiChangedSection[],
): readonly AiChangedSection[] {
  return sections.filter(
    (section) =>
      section.currentStartLine >= 1 &&
      section.currentEndLine >= section.currentStartLine &&
      section.currentEndLine <= view.state.doc.lines,
  );
}

class SectionUndoWidget extends WidgetType {
  constructor(
    private readonly sectionId: string,
    private readonly onUndoSection: (sectionId: string) => void,
  ) {
    super();
  }

  override eq(other: SectionUndoWidget): boolean {
    return this.sectionId === other.sectionId;
  }

  override toDOM(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-ai-section-undo-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-ai-section-undo-btn';
    button.setAttribute('aria-label', 'Undo AI section');
    button.title = 'Undo section';
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M3 7v6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13a9 9 0 1 0 3-6.7L3 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onUndoSection(this.sectionId);
    });
    wrapper.appendChild(button);
    return wrapper;
  }
}

function buildDecorationSet(
  view: EditorView,
  sections: readonly AiChangedSection[],
  onUndoSection: (sectionId: string) => void,
): DecorationSet {
  const usableSections = filterUsableSections(view, sections);
  if (usableSections.length === 0) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (const section of usableSections) {
    for (let lineNumber = section.currentStartLine; lineNumber <= section.currentEndLine; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber);
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-ai-edit-line' }));
    }
    const endLine = view.state.doc.line(section.currentEndLine);
    builder.add(
      endLine.to,
      endLine.to,
      Decoration.widget({
        widget: new SectionUndoWidget(section.id, onUndoSection),
        side: 1,
        block: true,
      }),
    );
  }
  return builder.finish();
}

/** Line-level background + per-section undo control for AI-changed sections. */
export function aiLineHighlightExtension(
  sections: readonly AiChangedSection[],
  onUndoSection: (sectionId: string) => void,
): Extension {
  return ViewPlugin.define(
    (view) => ({
      sections,
      onUndoSection,
      decorations: buildDecorationSet(view, sections, onUndoSection),
      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildDecorationSet(update.view, this.sections, this.onUndoSection);
        }
      },
    }),
    {
      decorations: (v) => v.decorations,
    },
  );
}
