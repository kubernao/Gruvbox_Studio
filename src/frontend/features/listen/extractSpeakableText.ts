/**
 * Converts editor buffer content into plain text suitable for text-to-speech playback.
 *
 * Markdown and MDX documents are normalized by removing fenced code blocks, simplifying links and
 * images to spoken words, stripping heading markers, and collapsing decorative punctuation so the
 * synthesizer reads prose rather than raw markup. Non-markdown sources pass through with light
 * whitespace normalization so code and plain text files remain usable without surprising omissions.
 */

const FENCED_CODE_BLOCK = /```[\w-]*\n?[\s\S]*?```/g;
const INLINE_CODE = /`([^`]+)`/g;
const LINK_MARKDOWN = /\[([^\]]*)\]\([^)]*\)/g;
const IMAGE_MARKDOWN = /!\[([^\]]*)\]\([^)]*\)/g;
const HEADING_LINE = /^#{1,6}\s+/gm;
const BLOCKQUOTE_LINE = /^>\s?/gm;
const LIST_LINE = /^\s{0,3}[-*+]\s+/gm;
const ORDERED_LIST_LINE = /^\s*\d+\.\s+/gm;
const HR_LINE = /^\s{0,3}(?:[-*_]\s*){3,}\s*$/gm;
const TABLE_ROW = /^\|.*\|\s*$/gm;

/**
 * Returns true when the language id indicates markdown-like authoring where markup stripping should run.
 *
 * @param language - CodeMirror or workspace language string for the active document.
 */
export function isMarkdownLikeLanguage(language: string): boolean {
  const lower = language.trim().toLowerCase();
  return lower === 'markdown' || lower === 'mdx' || lower === 'md';
}

/**
 * Strips markdown constructs and decorative syntax so the result reads naturally when spoken.
 *
 * @param source - Raw markdown buffer from the editor.
 */
export function markdownToSpeakablePlainText(source: string): string {
  let text = source.replace(FENCED_CODE_BLOCK, ' ');
  text = text.replace(LINK_MARKDOWN, '$1');
  text = text.replace(IMAGE_MARKDOWN, (_, alt: string) => (alt.trim() !== '' ? alt : 'image'));
  text = text.replace(INLINE_CODE, '$1');
  text = text.replace(HEADING_LINE, '');
  text = text.replace(BLOCKQUOTE_LINE, '');
  text = text.replace(LIST_LINE, '');
  text = text.replace(ORDERED_LIST_LINE, '');
  text = text.replace(HR_LINE, ' ');
  text = text.replace(TABLE_ROW, ' ');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__(.+?)__/g, '$1');
  text = text.replace(/_(.+?)_/g, '$1');
  text = text.replace(/~~(.+?)~~/g, '$1');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

/**
 * Split long prose into segments that stay within typical speech-synthesis queue limits while
 * preferring paragraph boundaries for natural pauses between utterances.
 *
 * @param text - Plain text after markdown flattening.
 * @param maxChars - Soft maximum characters per chunk before forcing a split.
 */
export function chunkTextForSpeechUtterances(text: string, maxChars = 8000): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized === '') {
    return [];
  }
  const paragraphs = normalized.split(/\n\s*\n+/);
  const chunks: string[] = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    const piece = paragraph.trim();
    if (piece === '') {
      continue;
    }
    const candidate = buffer === '' ? piece : `${buffer}\n\n${piece}`;
    if (candidate.length > maxChars && buffer !== '') {
      chunks.push(buffer);
      buffer = piece.length > maxChars ? piece.slice(0, maxChars) : piece;
      while (buffer.length >= maxChars) {
        chunks.push(buffer.slice(0, maxChars));
        buffer = buffer.slice(maxChars).trimStart();
      }
      continue;
    }
    if (candidate.length > maxChars && buffer === '') {
      let rest = piece;
      while (rest.length > maxChars) {
        chunks.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars).trimStart();
      }
      buffer = rest;
      continue;
    }
    buffer = candidate;
  }
  if (buffer.trim() !== '') {
    chunks.push(buffer.trim());
  }
  return chunks;
}

export type ExtractSpeakableTextInput = {
  content: string;
  language: string;
};

/**
 * Produces speakable plain text for the active editor buffer using markdown-aware rules when appropriate.
 *
 * @param input - Editor buffer and language metadata from the middle editor state.
 */
export function extractSpeakableText(input: ExtractSpeakableTextInput): string {
  const raw = input.content.replace(/\r\n/g, '\n');
  if (isMarkdownLikeLanguage(input.language)) {
    return markdownToSpeakablePlainText(raw);
  }
  return raw.replace(/\s+/g, ' ').trim();
}
