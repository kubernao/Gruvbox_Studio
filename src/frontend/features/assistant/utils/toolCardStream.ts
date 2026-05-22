/**
 * Pure string helpers for streaming tool-card markers embedded in assistant
 * message content.  Extracted from usePiSession.ts so the transform logic is
 * unit-testable without React dependencies.
 *
 * The card format is:
 *   \n\n[[GVX_TOOL:<state>:<URI-encoded-title>:<URI-encoded-body>]]\n\n
 *
 * where state is one of: run | ok | err | building | update
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace the last tool card in content that matches the given state and
 * tool-name prefix, or append a new one when no matching card exists.
 */
export function replaceOrAppendToolCard(
  content: string,
  _toolName: string,
  state: 'building' | 'update',
  title: string,
  body: string,
): string {
  const encodedTitle = encodeURIComponent(title);
  const encodedBody = encodeURIComponent(body);
  const cardMarker = `[[GVX_TOOL:${state}:${encodedTitle}:${encodedBody}]]`;
  const toolPrefix = encodeURIComponent(title.split(':')[0] ?? '');
  const regex = new RegExp(
    `\\n\\n\\[\\[GVX_TOOL:${state}:${escapeRegex(toolPrefix)}[^:]*:[^\\]]*\\]\\]\\n\\n`,
    'g',
  );
  const matches = content.match(regex);
  if (!matches || matches.length === 0) {
    return content + `\n\n${cardMarker}\n\n`;
  }
  const lastIdx = content.lastIndexOf(matches[matches.length - 1]);
  if (lastIdx === -1) {
    return content + `\n\n${cardMarker}\n\n`;
  }
  return (
    content.slice(0, lastIdx) +
    `\n\n${cardMarker}\n\n` +
    content.slice(lastIdx + matches[matches.length - 1].length)
  );
}

/**
 * Accumulates streaming deltas into a single tool card, removing any prior
 * card of the same state/tool from its original position and re-appending
 * at the end of content so the card stays last in the timeline.
 */
export function appendToToolCard(
  content: string,
  _toolName: string,
  state: 'building' | 'update',
  title: string,
  appendBody: string,
): string {
  const encodedTitle = encodeURIComponent(title);
  const toolPrefix = encodeURIComponent(title.split(':')[0] ?? '');
  // Match the full card block including surrounding newlines.
  const blockRegex = new RegExp(
    `\\n\\n\\[\\[GVX_TOOL:${state}:${escapeRegex(toolPrefix)}[^:]*:[^\\]]*\\]\\]\\n\\n`,
    'g',
  );
  // Match just the inner body for decoding.
  const innerRegex = new RegExp(
    `\\[\\[GVX_TOOL:${state}:${escapeRegex(toolPrefix)}[^:]*:([^\\]]*)\\]\\]`,
  );

  let accumulated = '';
  let stripped = content;
  for (const block of content.matchAll(blockRegex)) {
    const inner = block[0].match(innerRegex);
    if (inner && inner[1]) {
      try {
        accumulated += decodeURIComponent(inner[1]);
      } catch {
        // ignore
      }
    }
    // Remove this occurrence.
    stripped = stripped.replace(block[0], '');
  }

  accumulated += appendBody;
  // Convert literal \n / \t escape sequences to actual whitespace.
  const normalized = accumulated.split('\\n').join('\n').split('\\t').join('\t');
  const encodedBody = encodeURIComponent(normalized);
  const cardMarker = `[[GVX_TOOL:${state}:${encodedTitle}:${encodedBody}]]`;
  return stripped.trimEnd() + `\n\n${cardMarker}\n\n`;
}
