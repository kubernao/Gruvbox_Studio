import type { Extension } from '@codemirror/state';
import { collabBroadcastExtension } from './collabBroadcastExtension';
import { commentsExtension } from './commentsExtension';
import { suggestChangesExtension } from './suggestChangesExtension';
import type { DocEditorFlags } from './docEditorFlags';
import { writingDiagnosticsExtension } from './writingDiagnosticsExtension';

export function buildDocReviewExtensions(docId: string, flags: DocEditorFlags): Extension[] {
  const extensions: Extension[] = [];
  if (flags.collab) {
    extensions.push(collabBroadcastExtension(docId));
  }
  if (flags.comments) {
    extensions.push(commentsExtension());
  }
  if (flags.suggest) {
    extensions.push(suggestChangesExtension());
  }
  if (flags.diagnostics) {
    extensions.push(writingDiagnosticsExtension());
  }
  return extensions;
}
