import type { Extension } from '@codemirror/state';
import { linter, type Diagnostic } from '@codemirror/lint';

const commonMisspellings = /\b(teh|recieve|occured|seperate|definately|untill)\b/gi;

export function writingDiagnosticsExtension(): Extension {
  return linter(
    (view) => {
      const text = view.state.doc.toString();
      const diagnostics: Diagnostic[] = [];
      for (const match of text.matchAll(commonMisspellings)) {
        const from = match.index ?? 0;
        const to = from + match[0].length;
        diagnostics.push({
          from,
          to,
          severity: 'warning',
          message: `Possible misspelling: "${match[0]}"`,
        });
      }
      for (const match of text.matchAll(/\s{2,}/g)) {
        const from = match.index ?? 0;
        diagnostics.push({
          from,
          to: from + match[0].length,
          severity: 'info',
          message: 'Repeated whitespace',
        });
      }
      return diagnostics;
    },
    { delay: 350 }
  );
}
