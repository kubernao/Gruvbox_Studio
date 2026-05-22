/**
 * Gruvbox Studio Pi extension: safe document mutations (append, prepend, insert_at).
 *
 * Registers tools that avoid misusing the built-in `write` tool when the model only
 * meant to add text. Paths resolve against `process.cwd()` (Pi workspace) and must
 * stay inside that directory. Mutations serialize per file via `withFileMutationQueue`.
 */

import { Type } from "typebox";
import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import {
	assertInsideProjectRoot,
	computeAppend,
	computeInsertAt,
	computePrepend,
	normalizeInsertAnchor,
	resolveDocPath,
	utf8ByteLength,
} from "./gruvbox-doc-tools-core";

/**
 * Build a short human-readable summary line after a successful mutation.
 */
function formatSuccess(tool: string, pathRel: string, bytesBefore: number, bytesAfter: number): string {
	const delta = bytesAfter - bytesBefore;
	return `${tool}: ${pathRel} (${bytesBefore} → ${bytesAfter} bytes, ${delta >= 0 ? "+" : ""}${delta})`;
}

/**
 * Read UTF-8 file body or empty string if optional checks pass for missing file on append.
 */
async function readExistingUtf8(absPath: string): Promise<string> {
	try {
		await fsAccess(absPath, constants.R_OK | constants.W_OK);
		const buf = await fsReadFile(absPath);
		return buf.toString("utf8");
	} catch (e: unknown) {
		const err = e as { code?: string };
		if (err?.code === "ENOENT") {
			return "";
		}
		throw e;
	}
}

const anchorSchema = Type.Object(
	{
		line: Type.Optional(Type.Number({ description: "1-indexed line; insert before this line. Use n+1 to append after the last line." })),
		afterText: Type.Optional(Type.String({ description: "Unique substring; insert immediately after this match." })),
		beforeText: Type.Optional(Type.String({ description: "Unique substring; insert immediately before this match." })),
	},
	{ additionalProperties: false },
);

/**
 * Registers Gruvbox document tools on the Pi extension API.
 */
export default function gruvboxDocToolsExtension(pi: ExtensionAPI) {
	const cwd = () => process.cwd();

	pi.registerTool(
		defineTool({
			name: "append_to_file",
			label: "Append to file",
			description:
				"Append text to the end of an existing file without rewriting the whole file. Creates the file if missing. " +
				"Prefer this over `write` when the user asks to add continuations, new paragraphs, or sections at the bottom.",
			parameters: Type.Object({
				path: Type.String({ description: "Path relative to project root or absolute." }),
				content: Type.String({ description: "Text to append (only this fragment, not the full document)." }),
				ensure_trailing_newline: Type.Optional(
					Type.Boolean({
						description: "If true (default), ensure the file ends with a newline after append.",
					}),
				),
			}),
			execute: async (_id, args) => {
				const root = cwd();
				const pathRaw = String(args.path ?? "").trim();
				const fragment = String(args.content ?? "");
				const ensureTrailing = args.ensure_trailing_newline;
				if (!pathRaw) {
					return { content: [{ type: "text", text: "append_to_file: path is required." }], isError: true };
				}
				const abs = resolveDocPath(pathRaw, root);
				assertInsideProjectRoot(abs, root);

				return withFileMutationQueue(abs, async () => {
					const existing = await readExistingUtf8(abs);
					const bytesBefore = utf8ByteLength(existing);
					const next = computeAppend(existing, fragment, {
						ensureTrailingNewline: ensureTrailing !== false,
					});
					const bytesAfter = utf8ByteLength(next);
					await fsWriteFile(abs, next, "utf8");
					return {
						content: [
							{
								type: "text",
								text: formatSuccess("append_to_file", pathRaw, bytesBefore, bytesAfter),
							},
						],
					};
				});
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "prepend_to_file",
			label: "Prepend to file",
			description:
				"Insert text at the beginning of the file without rewriting the whole document. Creates the file if missing. " +
				"Use when the user asks to add a header, title block, or front matter at the top.",
			parameters: Type.Object({
				path: Type.String({ description: "Path relative to project root or absolute." }),
				content: Type.String({ description: "Text to prepend before existing content." }),
			}),
			execute: async (_id, args) => {
				const root = cwd();
				const pathRaw = String(args.path ?? "").trim();
				const fragment = String(args.content ?? "");
				if (!pathRaw) {
					return { content: [{ type: "text", text: "prepend_to_file: path is required." }], isError: true };
				}
				const abs = resolveDocPath(pathRaw, root);
				assertInsideProjectRoot(abs, root);

				return withFileMutationQueue(abs, async () => {
					const existing = await readExistingUtf8(abs);
					const bytesBefore = utf8ByteLength(existing);
					const next = computePrepend(existing, fragment);
					const bytesAfter = utf8ByteLength(next);
					await fsWriteFile(abs, next, "utf8");
					return {
						content: [
							{
								type: "text",
								text: formatSuccess("prepend_to_file", pathRaw, bytesBefore, bytesAfter),
							},
						],
					};
				});
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "insert_at",
			label: "Insert at line or marker",
			description:
				"Insert a fragment into an existing file at a line number (1-indexed, insert before that line) " +
				"or after/before a unique text marker. Does not replace the whole file. File must already exist.",
			parameters: Type.Object({
				path: Type.String({ description: "Path relative to project root or absolute." }),
				content: Type.String({ description: "Text to insert." }),
				anchor: anchorSchema,
			}),
			execute: async (_id, args) => {
				const root = cwd();
				const pathRaw = String(args.path ?? "").trim();
				const fragment = String(args.content ?? "");
				if (!pathRaw) {
					return { content: [{ type: "text", text: "insert_at: path is required." }], isError: true };
				}
				let anchorNorm;
				try {
					anchorNorm = normalizeInsertAnchor(args.anchor);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					return { content: [{ type: "text", text: `insert_at: ${msg}` }], isError: true };
				}

				const abs = resolveDocPath(pathRaw, root);
				assertInsideProjectRoot(abs, root);

				return withFileMutationQueue(abs, async () => {
					try {
						await fsAccess(abs, constants.R_OK | constants.W_OK);
					} catch (e: unknown) {
						const err = e as { code?: string };
						if (err?.code === "ENOENT") {
							return {
								content: [{ type: "text", text: `insert_at: file does not exist: ${pathRaw}` }],
								isError: true,
							};
						}
						throw e;
					}
					const existing = (await fsReadFile(abs)).toString("utf8");
					const bytesBefore = utf8ByteLength(existing);
					let next: string;
					try {
						next = computeInsertAt(existing, anchorNorm, fragment);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						return { content: [{ type: "text", text: `insert_at: ${msg}` }], isError: true };
					}
					const bytesAfter = utf8ByteLength(next);
					await fsWriteFile(abs, next, "utf8");
					return {
						content: [{ type: "text", text: formatSuccess("insert_at", pathRaw, bytesBefore, bytesAfter) }],
					};
				});
			},
		}),
	);
}
