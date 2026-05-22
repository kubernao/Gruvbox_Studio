import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

const KINDS = ["character", "location", "thread", "note", "fact"] as const;

type MemoryEntry = {
	id: string;
	kind: string;
	title: string;
	body: string;
	source: string;
	sourceRef: string;
	updatedAt: number;
};

type MemoryStore = {
	version: number;
	entries: MemoryEntry[];
	manuscript: { includeGlobs: string[] };
};

function defaultStore(): MemoryStore {
	return {
		version: 1,
		entries: [],
		manuscript: { includeGlobs: ["**/*.md", "**/*.mdx"] },
	};
}

/**
 * Resolves the project root used for memory persistence. When Gruvie runs in an
 * AI git worktree, process.cwd() points at the ephemeral worktree; Electron sets
 * GRUVBOX_MEMORY_ROOT to the real repo so reads, retrieval, and writes stay aligned.
 */
function resolveMemoryRoot(): string {
	const fromEnv = typeof process.env.GRUVBOX_MEMORY_ROOT === "string" ? process.env.GRUVBOX_MEMORY_ROOT.trim() : "";
	return fromEnv !== "" ? fromEnv : process.cwd();
}

/**
 * Gruvbox Studio: registers the memory_remember tool that the AI uses to
 * persist short factual memories about the current project. Writes directly
 * to <projectRoot>/.gruvbox/memory/project-memory.json which the Electron
 * main process reads on subsequent turns to inject as retrieval context.
 *
 * Only `kind`, `title`, `body`, and `sourceRef` are persisted here; the
 * embedding field is recomputed lazily by the main-process retrieval code.
 */
export default function gruvboxMemoryToolExtension(pi: ExtensionAPI) {
	pi.registerTool(
		defineTool({
			name: "memory_remember",
			label: "Remember (project memory)",
			description:
				"Persist a small canonical fact about this project for future sessions. " +
				"Use for characters, locations, plot threads, world rules, or important facts the user has established. " +
				"Keep entries short and factual; one entry per discrete idea.",
			parameters: Type.Object({
				kind: Type.Union(KINDS.map((k) => Type.Literal(k))),
				title: Type.String({ description: "Short canonical name, e.g. 'Alice (protagonist)'." }),
				body: Type.String({ description: "A few factual sentences worth keeping." }),
				sourceRef: Type.Optional(
					Type.String({ description: "Optional source path like 'chapters/03.md'." }),
				),
			}),
			execute: async (_id, args) => {
				const root = resolveMemoryRoot();
				const dir = path.join(root, ".gruvbox", "memory");
				const file = path.join(dir, "project-memory.json");
				await fs.mkdir(dir, { recursive: true });

				let store: MemoryStore = defaultStore();
				try {
					const raw = await fs.readFile(file, "utf8");
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === "object") {
						store = {
							version: typeof parsed.version === "number" ? parsed.version : 1,
							entries: Array.isArray(parsed.entries) ? (parsed.entries as MemoryEntry[]) : [],
							manuscript:
								parsed.manuscript && typeof parsed.manuscript === "object"
									? parsed.manuscript
									: { includeGlobs: ["**/*.md", "**/*.mdx"] },
						};
					}
				} catch {
					// missing file is fine; we'll create one
				}

				const title = String(args.title ?? "").trim();
				const body = String(args.body ?? "").trim();
				if (!title || !body) {
					return {
						content: [
							{
								type: "text",
								text: "memory_remember: title and body are required.",
							},
						],
						isError: true,
					};
				}

				const entry: MemoryEntry = {
					id: `m-${crypto.randomUUID()}`,
					kind: String(args.kind ?? "note"),
					title,
					body,
					source: "ai",
					sourceRef: typeof args.sourceRef === "string" ? args.sourceRef.trim() : "",
					updatedAt: Date.now(),
				};

				store.entries = Array.isArray(store.entries) ? store.entries : [];
				store.entries.push(entry);
				await fs.writeFile(file, JSON.stringify(store, null, 2), "utf8");

				return {
					content: [{ type: "text", text: `Remembered (${entry.kind}): ${entry.title}` }],
				};
			},
		}),
	);
}
