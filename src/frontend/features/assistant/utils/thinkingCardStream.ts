/**
 * Pure string helpers for streaming thinking markers embedded in assistant
 * message content. Thinking segments use the same inline timeline pattern as
 * tool cards so reasoning appears in chronological order with tools and text.
 *
 * Format:
 *   \n\n[[GVX_THINK:<URI-encoded-body>]]\n\n
 */

/**
 * Build a single thinking marker block for the assistant content timeline.
 */
export function buildThinkingMarker(body: string): string {
  const encoded = encodeURIComponent(body);
  return `\n\n[[GVX_THINK:${encoded}]]\n\n`;
}

/**
 * Append streamed reasoning to the trailing thinking segment when it is still
 * the last timeline entry; otherwise append a new thinking segment at the end.
 */
export function appendToThinkingCard(content: string, appendBody: string): string {
  const trimmed = content.trimEnd();
  const endMatch = /\[\[GVX_THINK:([^\]]*)\]\]$/.exec(trimmed);
  if (endMatch) {
    let accumulated = '';
    try {
      accumulated = decodeURIComponent(endMatch[1]);
    } catch {
      // ignore decode errors and treat as empty
    }
    accumulated += appendBody;
    const encoded = encodeURIComponent(accumulated);
    const marker = `[[GVX_THINK:${encoded}]]`;
    const prefix = trimmed.slice(0, trimmed.length - endMatch[0].length);
    const trailingWhitespace = content.slice(trimmed.length);
    return prefix + marker + trailingWhitespace;
  }
  return content.trimEnd() + buildThinkingMarker(appendBody);
}
