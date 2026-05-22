import { useMemo } from 'react';
import { Extension } from '@codemirror/state';
import { getLanguageExtension } from './editorConfig';
import CodeMirrorSurface from './CodeMirrorSurface';
import type { AiChangedSection } from '../../shared/ai/extractAiChangedLinesFromUnifiedDiff';

interface CodeMirrorCodeEditorProps {
  filePath: string;
  content: string;
  isEditable: boolean;
  onChange: (next: string) => void;
  aiHighlightSections?: readonly AiChangedSection[];
  onUndoAiSection?: (sectionId: string) => void;
}

export default function CodeMirrorCodeEditor({
  filePath,
  content,
  isEditable,
  onChange,
  aiHighlightSections,
  onUndoAiSection,
}: CodeMirrorCodeEditorProps) {
  const languageExtension = useMemo<Extension>(() => getLanguageExtension(filePath), [filePath]);

  return (
    <div className="main-editor-wrapper code-file">
      <div className="main-editor-cm-root">
        <CodeMirrorSurface
          content={content}
          isEditable={isEditable}
          languageExtension={languageExtension}
          onChange={onChange}
          aiHighlightSections={aiHighlightSections}
          onUndoAiSection={onUndoAiSection}
          className="code-codemirror-root editor-container"
        />
      </div>
    </div>
  );
}
