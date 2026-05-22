/**
 * conversationParity — sanitize and normalize AI conversation content.
 *
 * Strips internal GVX tool-call markers and normalizes whitespace so that
 * content forwarded to the model matches what would appear in a clean
 * conversation history. Stateless pure functions; no IPC or file I/O.
 */

function sanitizeModelFacingContent(content) {
  return String(content ?? '')
    .replace(/\[\[GVX_TOOL:[^\]]+\]\]/g, '')
    // Strip standalone JSON argument blobs that often leak from tool-intent turns.
    .replace(
      /(?:^|\n)\{[\s\S]{0,1200}"(?:path|command|pattern|glob|cwd|file|oldText|newText|edits|content)"[\s\S]{0,1200}\}(?=\n|$)/g,
      '\n',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildConversationPrompt(messages) {
  const turns = Array.isArray(messages) ? messages : [];
  const compact = turns
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({
      role: m.role,
      content: sanitizeModelFacingContent(m.content),
    }))
    .filter((m) => m.content !== '');
  if (compact.length === 0) {
    return '';
  }
  if (compact.length === 1 && compact[0].role === 'user') {
    return compact[0].content;
  }
  return compact.map((m) => `[${m.role}] ${m.content}`).join('\n\n');
}

module.exports = {
  sanitizeModelFacingContent,
  buildConversationPrompt,
};
