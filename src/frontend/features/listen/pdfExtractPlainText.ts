/**
 * Loads a PDF from disk in the Electron renderer and concatenates per-page text items into a single
 * string suitable for audiobook playback. Mirrors the pdf.js loading strategy used by the PDF viewer
 * so extraction stays consistent with what the user sees, while remaining independent of canvas rendering.
 */

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import { IPCService } from '../../shared/utils/ipc';

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

try {
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
} catch {
  /* Worker wiring may fail in non-standard bundles; extraction still attempts disableWorker load. */
}

/**
 * Reads every page of the PDF at `filePath` and returns plain text in reading order.
 *
 * @param filePath - Absolute path to the PDF on disk (same as PdfViewer).
 */
export async function extractPlainTextFromPdfPath(filePath: string): Promise<string> {
  const base64 = await IPCService.readFileBase64(filePath);
  const bytes = decodeBase64ToUint8Array(base64);
  const loadingTask = getDocument({ data: bytes, disableWorker: true } as any);
  const pdf = await loadingTask.promise;
  try {
    const parts: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText !== '') {
        parts.push(pageText);
      }
    }
    return parts.join('\n\n').trim();
  } finally {
    await pdf.destroy().catch(() => {});
  }
}
