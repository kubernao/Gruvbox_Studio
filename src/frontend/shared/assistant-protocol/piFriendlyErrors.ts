/**
 * Map raw Gruvie / OpenRouter / IPC errors to short, actionable copy for the assistant UI.
 */
export function formatPiUserMessage(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return 'Something went wrong.';
  }
  if (text.includes('OpenRouter API key is not configured')) {
    return 'Add your OpenRouter API key in Gruvie settings (gear icon).';
  }
  if (text.toLowerCase().includes('unauthorized') || text.includes('401')) {
    return 'OpenRouter rejected the API key. Check the key at https://openrouter.ai/keys and save it again in Gruvie settings.';
  }
  if (text.includes('Pi CLI not found') || text.includes('provider extension not found')) {
    return 'Gruvie is not built or files are missing. From Gruvbox Studio run npm run build:pi and reopen the app.';
  }
  if (text.includes('JSON_TEXT_WITHOUT_TOOL_EVENT')) {
    return 'Gruvie emitted JSON-like assistant text instead of invoking a tool call. The turn was stopped to prevent retry loops.';
  }
  if (looksLikeNetworkFailure(text)) {
    return (
      'Network error while calling OpenRouter. Check your internet connection and that https://openrouter.ai is reachable.'
    );
  }
  return text;
}

function looksLikeNetworkFailure(text: string): boolean {
  const t = text.toLowerCase();
  return (
    text.includes('ECONNREFUSED') ||
    text.includes('ECONNRESET') ||
    text.includes('ETIMEDOUT') ||
    text.includes('ENOTFOUND') ||
    text.includes('EAI_AGAIN') ||
    t.includes('fetch failed') ||
    t.includes('network') ||
    t.includes('abort')
  );
}
