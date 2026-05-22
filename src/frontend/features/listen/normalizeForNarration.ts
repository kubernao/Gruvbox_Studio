/**
 * Light-touch normalization so cloud TTS reads prose more like narration than raw typing: trim noisy
 * whitespace, strip bare URLs, and add breathing room before obvious sentence breaks where helpful.
 */

const URL_RE = /\bhttps?:\/\/[^\s]+/gi;

/**
 * Prepares a plain-text segment for neural speech APIs (OpenAI audio speech accepts plain text only).
 *
 * @param text - Speakable plain text after markdown stripping or PDF extraction.
 */
export function normalizeForNarration(text: string): string {
  let t = text.replace(/\r\n/g, '\n');
  t = t.replace(URL_RE, 'link');
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{4,}/g, '\n\n\n');
  t = t.replace(/[ \t]+/g, ' ');
  return t.trim();
}
