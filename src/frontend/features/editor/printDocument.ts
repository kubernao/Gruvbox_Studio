import { markdownToSafeHtml } from './markdownPreviewHtml';

const PRINT_BASE_CSS = `
body {
  font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
  line-height: 1.6;
  margin: 24px;
  color: #1f1f1f;
}
img {
  max-width: 100%;
  height: auto;
}
pre, code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
pre {
  white-space: pre-wrap;
  word-break: break-word;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th, td {
  border: 1px solid #d9d9d9;
  padding: 0.5rem;
}
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isMarkdownLanguage(language: string | null | undefined): boolean {
  return language === 'markdown' || language === 'mdx';
}

export async function buildPrintableDocumentHtml(
  content: string,
  language: string | null | undefined
): Promise<string> {
  if (isMarkdownLanguage(language)) {
    return markdownToSafeHtml(content);
  }
  return `<pre>${escapeHtml(content)}</pre>`;
}

export function printHtmlDocument(
  html: string,
  options: { title: string; css?: string } = { title: 'Document' }
): void {
  if (typeof window === 'undefined') {
    return;
  }
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=960,height=720');
  if (!printWindow) {
    throw new Error('Popup blocked while opening print preview');
  }
  const css = `${PRINT_BASE_CSS}\n${options.css ?? ''}`;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(options.title)}</title>
    <style>${css}</style>
  </head>
  <body>${html}</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
