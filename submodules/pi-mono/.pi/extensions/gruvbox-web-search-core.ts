/**
 * Core web search helpers for the Gruvbox Pi `web_search` tool.
 *
 * Performs Brave Search API requests and formats compact result text for the
 * model. API keys are read from environment variables so Studio can pass them
 * through the Pi child process without embedding secrets in extension source.
 */

export type WebSearchResult = {
	title: string;
	url: string;
	snippet: string;
};

export type WebSearchOptions = {
	maxResults?: number;
	country?: string;
	freshness?: string;
};

type BraveWebResult = {
	title?: string;
	url?: string;
	description?: string;
};

type BraveWebResponse = {
	web?: {
		results?: BraveWebResult[];
	};
	message?: string;
	error?: string;
};

const BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 10;

/**
 * Resolve a Brave Search API key from common Gruvbox and upstream env names.
 * Returns an empty string when no key is configured.
 */
export function resolveBraveApiKey(env: NodeJS.ProcessEnv = process.env): string {
	const candidates = [
		env.GRUVBOX_BRAVE_SEARCH_API_KEY,
		env.BRAVE_API_KEY,
		env.BRAVE_SEARCH_API_KEY,
	];
	for (const raw of candidates) {
		const key = String(raw ?? "").trim();
		if (key) {
			return key;
		}
	}
	return "";
}

/**
 * Clamp an optional max-results value to a safe integer within [1, hardMax].
 */
export function clampMaxResults(
	value: unknown,
	defaultMax: number = DEFAULT_MAX_RESULTS,
	hardMax: number = HARD_MAX_RESULTS,
): number {
	const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : defaultMax;
	return Math.min(hardMax, Math.max(1, n));
}

/**
 * Normalize Brave API result rows into a stable shape for formatting.
 */
export function parseBraveWebResults(payload: unknown): WebSearchResult[] {
	const data = payload as BraveWebResponse;
	const rows = Array.isArray(data?.web?.results) ? data.web!.results! : [];
	const out: WebSearchResult[] = [];
	for (const row of rows) {
		const title = String(row?.title ?? "").trim();
		const url = String(row?.url ?? "").trim();
		const snippet = String(row?.description ?? "").trim();
		if (!title && !url) {
			continue;
		}
		out.push({ title: title || url, url, snippet });
	}
	return out;
}

/**
 * Format search hits as numbered plain text for Pi tool result content.
 */
export function formatWebSearchResults(query: string, results: WebSearchResult[]): string {
	const q = String(query ?? "").trim();
	if (results.length === 0) {
		return `No web results for: ${q}`;
	}
	const lines = [`Web search results for: ${q}`, ""];
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		lines.push(`${i + 1}. ${r.title}`);
		if (r.url) {
			lines.push(`   URL: ${r.url}`);
		}
		if (r.snippet) {
			lines.push(`   ${r.snippet}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

/**
 * Build the user-facing error when Brave Search is not configured.
 */
export function missingApiKeyMessage(): string {
	return (
		"web_search: Brave Search API key is not configured. " +
		"Set GRUVBOX_BRAVE_SEARCH_API_KEY (or BRAVE_API_KEY) in the environment that launches Gruvbox Studio, " +
		"then restart the app. Get a key at https://brave.com/search/api/"
	);
}

/**
 * Execute a Brave web search and return formatted result text.
 * Throws on HTTP or network errors with a short message.
 */
export async function searchWeb(
	query: string,
	options: WebSearchOptions = {},
	env: NodeJS.ProcessEnv = process.env,
	fetchImpl: typeof fetch = fetch,
): Promise<string> {
	const q = String(query ?? "").trim();
	if (!q) {
		throw new Error("web_search: query is required.");
	}

	const apiKey = resolveBraveApiKey(env);
	if (!apiKey) {
		throw new Error(missingApiKeyMessage());
	}

	const count = clampMaxResults(options.maxResults);
	const params = new URLSearchParams({ q, count: String(count) });
	const country = String(options.country ?? "").trim();
	if (country) {
		params.set("country", country);
	}
	const freshness = String(options.freshness ?? "").trim();
	if (freshness) {
		params.set("freshness", freshness);
	}

	const url = `${BRAVE_WEB_SEARCH_URL}?${params.toString()}`;
	const response = await fetchImpl(url, {
		method: "GET",
		headers: {
			Accept: "application/json",
			"X-Subscription-Token": apiKey,
		},
	});

	const bodyText = await response.text();
	let payload: unknown = {};
	try {
		payload = bodyText ? JSON.parse(bodyText) : {};
	} catch {
		payload = { message: bodyText.slice(0, 500) };
	}

	if (!response.ok) {
		const data = payload as BraveWebResponse;
		const detail =
			String(data?.message ?? data?.error ?? "").trim() || bodyText.slice(0, 300) || response.statusText;
		throw new Error(`web_search: Brave API ${response.status} — ${detail}`);
	}

	const results = parseBraveWebResults(payload);
	return formatWebSearchResults(q, results);
}
