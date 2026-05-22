/**
 * Gruvbox Studio Pi extension: registers the `web_search` tool for the agent.
 *
 * Uses the Brave Search API when GRUVBOX_BRAVE_SEARCH_API_KEY or BRAVE_API_KEY
 * is set in the Pi child environment (inherited from Electron main process env).
 * Returns compact numbered results so the model can cite sources without bash.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { searchWeb } from "./gruvbox-web-search-core";

/**
 * Registers the Gruvbox `web_search` tool on the Pi extension API.
 */
export default function gruvboxWebSearchExtension(pi: ExtensionAPI) {
	pi.registerTool(
		defineTool({
			name: "web_search",
			label: "Web search",
			description:
				"Search the public web for current documentation, facts, news, or references. " +
				"Use when the user asks about recent events, external APIs, or information not in the project. " +
				"Prefer project files (read/grep) for repo-specific content.",
			parameters: Type.Object({
				query: Type.String({ description: "Search query (plain language)." }),
				max_results: Type.Optional(
					Type.Number({
						description: "Maximum results to return (1–10, default 5).",
						minimum: 1,
						maximum: 10,
					}),
				),
				country: Type.Optional(
					Type.String({ description: "Optional 2-letter country code (e.g. US, DE)." }),
				),
				freshness: Type.Optional(
					Type.String({
						description:
							"Optional Brave freshness filter: pd (past day), pw (week), pm (month), py (year).",
					}),
				),
			}),
			execute: async (_id, args) => {
				const query = String(args.query ?? "").trim();
				if (!query) {
					return {
						content: [{ type: "text", text: "web_search: query is required." }],
						isError: true,
					};
				}

				try {
					const text = await searchWeb(query, {
						maxResults: args.max_results,
						country: typeof args.country === "string" ? args.country : undefined,
						freshness: typeof args.freshness === "string" ? args.freshness : undefined,
					});
					return { content: [{ type: "text", text }] };
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					return {
						content: [{ type: "text", text: message }],
						isError: true,
					};
				}
			},
		}),
	);
}
