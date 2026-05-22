import { useEffect, useMemo, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { useTheme, THEMES } from '../../features/theme/lib';
import { createGruvboxTheme } from './editorConfig';
import { codemirrorCoreSetup } from './codemirrorCoreSetup';
import { aiLineHighlightExtension } from './aiLineHighlights';
import type { AiChangedSection } from '../../shared/ai/extractAiChangedLinesFromUnifiedDiff';

interface CodeMirrorSurfaceProps {
  content: string;
  isEditable: boolean;
  languageExtension: Extension | readonly Extension[];
  onChange: (next: string) => void;
  className: string;
  aiHighlightSections?: readonly AiChangedSection[];
  onUndoAiSection?: (sectionId: string) => void;
  documentExtensions?: Extension | readonly Extension[];
}

export default function CodeMirrorSurface({
  content,
  isEditable,
  languageExtension,
  onChange,
  className,
  aiHighlightSections = [],
  onUndoAiSection,
  documentExtensions = [],
}: CodeMirrorSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const { theme, isDark } = useTheme();
  const initialContentRef = useRef(content);
  const initialEditableRef = useRef(isEditable);
  const initialThemeRef = useRef(theme);
  const initialDarkRef = useRef(isDark);
  const initialLanguageExtensionRef = useRef(languageExtension);
  const isEditableRef = useRef(isEditable);

  const themeCompartment = useMemo(() => new Compartment(), []);
  const editableCompartment = useMemo(() => new Compartment(), []);
  const readOnlyCompartment = useMemo(() => new Compartment(), []);
  const languageCompartment = useMemo(() => new Compartment(), []);
  const highlightCompartment = useMemo(() => new Compartment(), []);
  const documentFeaturesCompartment = useMemo(() => new Compartment(), []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const startState = EditorState.create({
      doc: initialContentRef.current,
      extensions: [
        ...codemirrorCoreSetup,
        EditorView.lineWrapping,
        editableCompartment.of(EditorView.editable.of(initialEditableRef.current)),
        readOnlyCompartment.of(EditorState.readOnly.of(!initialEditableRef.current)),
        themeCompartment.of(
          createGruvboxTheme(THEMES[initialThemeRef.current], initialDarkRef.current)
        ),
        languageCompartment.of(initialLanguageExtensionRef.current),
        highlightCompartment.of(
          aiHighlightSections.length > 0 && onUndoAiSection
            ? aiLineHighlightExtension(aiHighlightSections, onUndoAiSection)
            : [],
        ),
        documentFeaturesCompartment.of(documentExtensions),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) {
            return;
          }
          onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });
    viewRef.current = view;
    const host = containerRef.current as HTMLElement & { gruvboxEditorView?: EditorView };
    host.gruvboxEditorView = view;

    if (process.env.NODE_ENV === 'development') {
      type Win = Window & { __gruvboxInspectCmSelection?: () => void };
      (window as Win).__gruvboxInspectCmSelection = () => {
        document.querySelectorAll('.markdown-codemirror-root, .code-codemirror-root').forEach((node, i) => {
          const el = node as HTMLElement & { gruvboxEditorView?: EditorView };
          const v = el.gruvboxEditorView;
          if (!v) {
            console.warn(`[Gruvbox CM] root ${i}: no gruvboxEditorView`);
            return;
          }
          const m = v.state.selection.main;
          const slice = m.empty ? '' : v.state.sliceDoc(m.from, m.to);
          console.log(`[Gruvbox CM] root ${i}`, {
            from: m.from,
            to: m.to,
            empty: m.empty,
            slicePreview: slice.slice(0, 120),
          });
        });
      };
    }

    if (initialEditableRef.current) {
      queueMicrotask(() => {
        viewRef.current?.focus();
      });
    }

    return () => {
      const host = containerRef.current as (HTMLElement & { gruvboxEditorView?: EditorView }) | null;
      if (host) {
        delete host.gruvboxEditorView;
      }
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentContent = view.state.doc.toString();
    if (currentContent === content) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: currentContent.length, insert: content },
    });
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const wasEditable = isEditableRef.current;
    isEditableRef.current = isEditable;
    view.dispatch({
      effects: [
        editableCompartment.reconfigure(EditorView.editable.of(isEditable)),
        readOnlyCompartment.reconfigure(EditorState.readOnly.of(!isEditable)),
      ],
    });
    if (isEditable && !wasEditable) {
      queueMicrotask(() => {
        view.focus();
      });
    }
  }, [isEditable, editableCompartment, readOnlyCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: themeCompartment.reconfigure(createGruvboxTheme(THEMES[theme], isDark)),
    });
  }, [theme, isDark, themeCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: languageCompartment.reconfigure(languageExtension),
    });
  }, [languageExtension, languageCompartment]);

  const highlightKey = aiHighlightSections
    .map((section) => `${section.id}:${section.currentStartLine}-${section.currentEndLine}`)
    .join('|');

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: highlightCompartment.reconfigure(
        aiHighlightSections.length > 0 && onUndoAiSection
          ? aiLineHighlightExtension(aiHighlightSections, onUndoAiSection)
          : [],
      ),
    });
  }, [highlightKey, highlightCompartment, aiHighlightSections, onUndoAiSection]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: documentFeaturesCompartment.reconfigure(documentExtensions),
    });
  }, [documentExtensions, documentFeaturesCompartment]);

  return <div className={className} ref={containerRef} />;
}
