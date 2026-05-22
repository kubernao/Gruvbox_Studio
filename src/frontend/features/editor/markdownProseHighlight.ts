import { markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { tags } from '@lezer/highlight';

/**
 * Semantic prose styling for markdown (headings, emphasis, links, etc.). This layer is scoped to
 * {@link markdownLanguage} only so code buffers keep their normal monospace styling. Heading font sizes use `em`
 * units relative to the editor body size and intentionally exaggerate level-to-level contrast—especially between H1
 * and H2—so document structure reads clearly at a glance. Keep these values aligned with the `.cm-header-*` rules in
 * `EditorPane.css`, which apply the same scale when highlight styles delegate sizing to the theme classes.
 */
const markdownProseStyle = HighlightStyle.define(
  [
    {
      tag: tags.heading,
      fontFamily: 'var(--font-heading)',
      fontWeight: '700',
      color: 'var(--text-primary)',
    },
    { tag: tags.heading1, fontSize: '2.45em', lineHeight: '1.22' },
    { tag: tags.heading2, fontSize: '1.88em', lineHeight: '1.24' },
    { tag: tags.heading3, fontSize: '1.58em', lineHeight: '1.25' },
    { tag: tags.heading4, fontSize: '1.38em', lineHeight: '1.28' },
    { tag: tags.heading5, fontSize: '1.18em', lineHeight: '1.3' },
    { tag: tags.heading6, fontSize: '1.06em', lineHeight: '1.32' },
    { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--text-primary)' },
    { tag: tags.strong, fontWeight: '700', color: 'var(--text-primary)' },
    { tag: tags.link, color: 'var(--blue-dim)', textDecoration: 'underline' },
    { tag: tags.url, color: 'var(--blue-dim)' },
    { tag: tags.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },
    {
      tag: tags.monospace,
      fontFamily: 'var(--font-mono)',
      fontSize: '0.92em',
      backgroundColor: 'color-mix(in srgb, var(--bg-secondary) 80%, var(--bg-primary))',
      borderRadius: '4px',
      padding: '0.05em 0.25em',
    },
    { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-secondary)' },
    { tag: tags.contentSeparator, color: 'var(--accent-highlight)' },
  ],
  { scope: markdownLanguage }
);

/**
 * Extension that installs {@link markdownProseStyle} at high precedence so markdown prose rules win over generic
 * highlighting in `.md` / markdown-language buffers without touching code editors.
 */
export const markdownProseHighlights = Prec.high(syntaxHighlighting(markdownProseStyle));
