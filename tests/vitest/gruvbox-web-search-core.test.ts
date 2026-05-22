import { describe, expect, it } from 'vitest';
import {
  clampMaxResults,
  formatWebSearchResults,
  missingApiKeyMessage,
  parseBraveWebResults,
  resolveBraveApiKey,
  searchWeb,
} from '../../submodules/pi-mono/.pi/extensions/gruvbox-web-search-core';

describe('gruvbox-web-search-core', () => {
  it('resolveBraveApiKey prefers GRUVBOX_BRAVE_SEARCH_API_KEY', () => {
    expect(
      resolveBraveApiKey({
        BRAVE_API_KEY: 'b',
        GRUVBOX_BRAVE_SEARCH_API_KEY: 'g',
      }),
    ).toBe('g');
  });

  it('resolveBraveApiKey falls back to BRAVE_API_KEY', () => {
    expect(resolveBraveApiKey({ BRAVE_API_KEY: 'key-123' })).toBe('key-123');
  });

  it('clampMaxResults enforces bounds', () => {
    expect(clampMaxResults(0)).toBe(1);
    expect(clampMaxResults(99)).toBe(10);
    expect(clampMaxResults(3)).toBe(3);
  });

  it('parseBraveWebResults maps Brave payload', () => {
    const results = parseBraveWebResults({
      web: {
        results: [
          { title: 'A', url: 'https://a.test', description: 'Snippet A' },
          { title: '', url: 'https://b.test', description: '' },
        ],
      },
    });
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('A');
    expect(results[1].title).toBe('https://b.test');
  });

  it('formatWebSearchResults handles empty list', () => {
    expect(formatWebSearchResults('test query', [])).toContain('No web results');
  });

  it('searchWeb throws when API key is missing', async () => {
    await expect(searchWeb('hello', {}, {})).rejects.toThrow(missingApiKeyMessage());
  });

  it('searchWeb calls Brave API and formats hits', async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      expect(url).toContain('api.search.brave.com');
      expect(init?.headers).toMatchObject({ 'X-Subscription-Token': 'test-key' });
      return new Response(
        JSON.stringify({
          web: {
            results: [{ title: 'Docs', url: 'https://example.com', description: 'Overview' }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const text = await searchWeb('pi agent', { maxResults: 3 }, { BRAVE_API_KEY: 'test-key' }, fetchImpl);
    expect(text).toContain('Web search results for: pi agent');
    expect(text).toContain('https://example.com');
    expect(text).toContain('Overview');
  });

  it('searchWeb surfaces Brave API errors', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ message: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });

    await expect(searchWeb('x', {}, { BRAVE_API_KEY: 'bad' }, fetchImpl)).rejects.toThrow(/401/);
  });
});
