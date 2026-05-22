import React, { Suspense } from 'react';
import MarkdownCodeMirrorEditor from './MarkdownCodeMirrorEditor';
import CodeMirrorCodeEditor from './CodeMirrorCodeEditor';
import { MiddleEditorDocument } from './useMiddleEditorState';
import type { AiChangedSection } from '../../shared/ai/extractAiChangedLinesFromUnifiedDiff';

const PdfViewer = React.lazy(() => import('./PdfViewer'));

interface MiddleContentHostProps {
  activeDocument: MiddleEditorDocument;
  onChange: (next: string) => void;
  aiHighlightSections?: readonly AiChangedSection[];
  onUndoAiSection?: (sectionId: string) => void;
  zoomScale?: number;
}

export default function MiddleContentHost({
  activeDocument,
  onChange,
  aiHighlightSections,
  onUndoAiSection,
  zoomScale = 1,
}: MiddleContentHostProps) {
  if (activeDocument.fileType === 'pdf') {
    return (
      <Suspense fallback={<div className="pdf-viewer-status">Loading PDF viewer...</div>}>
        <PdfViewer filePath={activeDocument.path} zoomScale={zoomScale} />
      </Suspense>
    );
  }

  const isMarkdownLike =
    activeDocument.language === 'markdown' || activeDocument.language === 'mdx';

  if (isMarkdownLike) {
    return (
      <MarkdownCodeMirrorEditor
        docId={activeDocument.path}
        key={activeDocument.path}
        content={activeDocument.content}
        isEditable={!activeDocument.isReadOnly}
        onChange={onChange}
        aiHighlightSections={aiHighlightSections}
        onUndoAiSection={onUndoAiSection}
      />
    );
  }

  return (
    <CodeMirrorCodeEditor
      key={activeDocument.path}
      filePath={activeDocument.path}
      content={activeDocument.content}
      isEditable={!activeDocument.isReadOnly}
      onChange={onChange}
      aiHighlightSections={aiHighlightSections}
      onUndoAiSection={onUndoAiSection}
    />
  );
}
