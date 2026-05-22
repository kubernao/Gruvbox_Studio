import { useMemo } from 'react';
import type { Extension } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { HighlightStyle, syntaxHighlighting, indentUnit, type Language } from '@codemirror/language';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { createTableExtension } from '@markwhen/codemirror-tables';
import { mermaid } from 'codemirror-lang-mermaid';
import { latex } from 'codemirror-lang-latex';
import CodeMirrorSurface from './CodeMirrorSurface';
import { markdownFormattingConceal } from './markdownFormattingConceal';
import { markdownDecoratorAtomics } from './markdownDecoratorAtomics';
import { markdownMermaidWidget } from './markdownMermaidWidget';
import { markdownLatexWidget } from './markdownLatexWidget';
import { markdownProseHighlights } from './markdownProseHighlight';
import { markdownInlineHtmlWidget } from './markdownInlineHtmlWidget';
import { useTheme } from '../theme/lib';
import type { AiChangedSection } from '../../shared/ai/extractAiChangedLinesFromUnifiedDiff';
import { readDocEditorFlags } from './docEditorFlags';
import { buildDocReviewExtensions } from './docReviewExtensions';

interface MarkdownCodeMirrorEditorProps {
  docId?: string;
  content: string;
  isEditable: boolean;
  onChange: (next: string) => void;
  aiHighlightSections?: readonly AiChangedSection[];
  onUndoAiSection?: (sectionId: string) => void;
}

export function resolveMarkdownFenceLanguage(info: string): Language | null {
  const fenceLanguage = info.trim().toLowerCase().split(/\s+/)[0];
  if (fenceLanguage === 'mermaid') {
    return mermaid().language;
  }
  if (fenceLanguage === 'latex' || fenceLanguage === 'tex' || fenceLanguage === 'katex') {
    return latex().language;
  }
  return null;
}

/**
 * Debug A/B: `localStorage.setItem('gruvbox-debug-disable-md-conceal', '1')` then reload — omit conceal plugin to compare drag-selection. Remove key or set to `0` to restore.
 */
function isMarkdownFormattingConcealDisabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('gruvbox-debug-disable-md-conceal') === '1';
  } catch {
    return false;
  }
}

/**
 * Table cells host a nested CodeMirror. It still receives the app Gruvbox theme, but
 * we override a few high-salience styles so the cell editor does not mirror the
 * main document (selection, cursor, and typography scale).
 */
const tableCellEditorTheme = EditorView.theme({
  '.cm-content': {
    // Match the surrounding table typography instead of the root editor's 14px theme.
    fontSize: 'inherit !important',
    lineHeight: 'inherit !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--blue-dim)',
  },
});

/**
 * Markwhen nests a markdown-capable editor inside each cell. Our main markdown buffer also enables
 * {@link markdownProseHighlights}, which is scoped to `markdownLanguage` — so it unintentionally
 * applies to nested cell editors too (inline code "pills", link colors, heading sizes, etc.).
 *
 * Neutralize those prose decorations inside table cells only, without changing the main editor.
 */
const tableCellMarkdownNeutralHighlights = Prec.highest(
  syntaxHighlighting(
    HighlightStyle.define(
      [
        {
          tag: tags.heading,
          fontFamily: 'inherit',
          fontWeight: 'inherit',
          color: 'inherit',
        },
        { tag: tags.heading1, fontSize: 'inherit', lineHeight: 'inherit' },
        { tag: tags.heading2, fontSize: 'inherit', lineHeight: 'inherit' },
        { tag: tags.heading3, fontSize: 'inherit', lineHeight: 'inherit' },
        { tag: tags.heading4, fontSize: 'inherit', lineHeight: 'inherit' },
        { tag: tags.heading5, fontSize: 'inherit', lineHeight: 'inherit' },
        { tag: tags.heading6, fontSize: 'inherit', lineHeight: 'inherit' },
        { tag: tags.emphasis, fontStyle: 'inherit', color: 'inherit' },
        { tag: tags.strong, fontWeight: 'inherit', color: 'inherit' },
        { tag: tags.link, color: 'inherit', textDecoration: 'inherit' },
        { tag: tags.url, color: 'inherit' },
        { tag: tags.quote, color: 'inherit', fontStyle: 'inherit' },
        {
          tag: tags.monospace,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          backgroundColor: 'transparent',
          borderRadius: '0',
          padding: '0',
          color: 'inherit',
        },
        { tag: tags.strikethrough, textDecoration: 'inherit', color: 'inherit' },
        { tag: tags.contentSeparator, color: 'inherit' },
      ],
      { scope: markdownLanguage }
    )
  )
);

export default function MarkdownCodeMirrorEditor({
  docId = 'markdown-doc',
  content,
  isEditable,
  onChange,
  aiHighlightSections,
  onUndoAiSection,
}: MarkdownCodeMirrorEditorProps) {
  const { isDark } = useTheme();
  const flags = useMemo(() => readDocEditorFlags(), []);

  const markdownExtension = useMemo((): Extension[] => {
    const base: Extension[] = [
      EditorState.tabSize.of(4),
      indentUnit.of('  '),
      markdownProseHighlights,
      createTableExtension({
        cellEditorExtensions: [tableCellEditorTheme, tableCellMarkdownNeutralHighlights],
      }),
    ];
    if (!isMarkdownFormattingConcealDisabled()) {
      base.push(markdownFormattingConceal);
      base.push(markdownDecoratorAtomics);
    }
    base.push(markdownInlineHtmlWidget);
    base.push(markdownMermaidWidget(isDark ? 'dark' : 'default'));
    base.push(markdownLatexWidget);
    base.push(
      markdown({
        extensions: [GFM],
        codeLanguages: (info) => resolveMarkdownFenceLanguage(info),
      })
    );
    return base;
  }, [isDark]);

  const documentExtensions = useMemo(
    () => buildDocReviewExtensions(docId, flags),
    [docId, flags]
  );

  return (
    <div className="main-editor-wrapper markdown-mode">
      <div className="main-editor-cm-root">
        <CodeMirrorSurface
          content={content}
          isEditable={isEditable}
          languageExtension={markdownExtension}
          documentExtensions={documentExtensions}
          onChange={onChange}
          aiHighlightSections={aiHighlightSections}
          onUndoAiSection={onUndoAiSection}
          className="markdown-codemirror-root markdown-wysiwyg-mask editor-container"
        />
      </div>
    </div>
  );
}
