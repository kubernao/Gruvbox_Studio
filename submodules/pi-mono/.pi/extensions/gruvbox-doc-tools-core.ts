/**
 * Gruvbox Studio — pure helpers for document mutation tools used by Pi.
 *
 * These functions have no Pi SDK dependency so Gruvbox Vitest can exercise
 * append/prepend/insert semantics without spawning the coding agent. They
 * preserve CRLF vs LF when rewriting text derived from an existing file body.
 */

import { isAbsolute, relative, resolve as resolvePath } from "node:path";

/**
 * Detect whether the file uses CRLF or LF as the primary newline sequence.
 */
export function detectLineEnding(content: string): "\r\n" | "\n" {
	const crlfIdx = content.indexOf("\r\n");
	const lfIdx = content.indexOf("\n");
	if (lfIdx === -1) return "\n";
	if (crlfIdx === -1) return "\n";
	return crlfIdx < lfIdx ? "\r\n" : "\n";
}

/**
 * Normalize text to LF-only for line-oriented operations.
 */
export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Restore the original newline style after editing normalized content.
 */
export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/**
 * UTF-8 byte length for metrics returned to the model.
 */
export function utf8ByteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

/**
 * Resolve a user-provided path relative to the Pi workspace cwd or absolute.
 */
export function resolveDocPath(rawPath: string, cwd: string): string {
	const original = String(rawPath ?? "").trim();
	const p = original.startsWith("@/") ? original.slice(2) : original.startsWith("@") ? original.slice(1) : original;
	if (!p) {
		throw new Error("path is required");
	}
	if (isAbsolute(p)) {
		return resolvePath(p);
	}
	return resolvePath(cwd, p);
}

/**
 * Ensure the resolved file path stays inside the project root (no .. escape).
 */
export function assertInsideProjectRoot(absPath: string, root: string): void {
	const rootAbs = resolvePath(root);
	const fileAbs = resolvePath(absPath);
	const rel = relative(rootAbs, fileAbs);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`path escapes project root: ${absPath}`);
	}
}

export type InsertAnchor =
	| { line: number }
	| { afterText: string }
	| { beforeText: string };

/**
 * Validate anchor object has exactly one of line / afterText / beforeText.
 */
export function normalizeInsertAnchor(raw: unknown): InsertAnchor {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("anchor must be an object");
	}
	const o = raw as Record<string, unknown>;
	const line = o.line;
	const afterText = o.afterText;
	const beforeText = o.beforeText;
	let count = 0;
	if (line !== undefined && line !== null) count++;
	if (typeof afterText === "string") count++;
	if (typeof beforeText === "string") count++;
	if (count !== 1) {
		throw new Error("anchor must set exactly one of: line, afterText, beforeText");
	}
	if (line !== undefined && line !== null) {
		if (!Number.isFinite(line) || typeof line !== "number") {
			throw new Error("anchor.line must be a finite number");
		}
		const n = Math.trunc(line);
		if (n < 1) {
			throw new Error("anchor.line must be >= 1");
		}
		return { line: n };
	}
	if (typeof afterText === "string") {
		if (afterText === "") {
			throw new Error("anchor.afterText must be non-empty");
		}
		return { afterText };
	}
	if (typeof beforeText === "string" && beforeText !== "") {
		return { beforeText };
	}
	throw new Error("anchor.beforeText must be a non-empty string");
}

/**
 * Count non-overlapping occurrences of needle in haystack.
 */
export function countOccurrences(haystack: string, needle: string): number {
	if (needle === "") return 0;
	let count = 0;
	let pos = 0;
	while (pos <= haystack.length - needle.length) {
		const idx = haystack.indexOf(needle, pos);
		if (idx === -1) break;
		count++;
		pos = idx + needle.length;
	}
	return count;
}

/**
 * Append fragment to existing body without dropping prior bytes; optionally ensure final newline.
 */
export function computeAppend(
	existing: string,
	fragment: string,
	options?: { ensureTrailingNewline?: boolean },
): string {
	const le = existing === "" ? detectLineEnding(fragment) : detectLineEnding(existing);
	let body = existing;
	let toAppend = fragment;
	if (existing !== "") {
		const endsWithNl = existing.endsWith("\n") || existing.endsWith("\r\n");
		if (!endsWithNl) {
			const sep = le === "\r\n" ? "\r\n" : "\n";
			toAppend = sep + fragment;
		}
	}
	body = existing + toAppend;
	const ensureTrail = options?.ensureTrailingNewline !== false;
	if (ensureTrail && body !== "" && !body.endsWith("\n") && !body.endsWith("\r\n")) {
		body += le === "\r\n" ? "\r\n" : "\n";
	}
	return body;
}

/**
 * Prepend fragment before existing body, inserting a newline between them when needed.
 */
export function computePrepend(existing: string, fragment: string): string {
	if (existing === "") {
		return fragment;
	}
	const le = detectLineEnding(existing);
	const fragEndsNl = fragment.endsWith("\n") || fragment.endsWith("\r\n");
	const sep = fragEndsNl ? "" : le === "\r\n" ? "\r\n" : "\n";
	return fragment + sep + existing;
}

/**
 * Insert fragment before line `line` (1-indexed), or after last line when line === n + 1.
 */
export function computeInsertAtLine(existing: string, line: number, fragment: string): string {
	const le = detectLineEnding(existing);
	const norm = normalizeToLF(existing);
	const lines = norm.split("\n");
	const n = lines.length;
	if (line < 1 || line > n + 1) {
		throw new Error(`anchor.line ${line} out of range for file with ${n} lines (valid 1..${n + 1})`);
	}
	const fragNorm = normalizeToLF(fragment);
	const fragLines = fragNorm.split("\n");
	const idx = line - 1;
	const merged = [...lines.slice(0, idx), ...fragLines, ...lines.slice(idx)];
	return restoreLineEndings(merged.join("\n"), le);
}

/**
 * Insert fragment immediately after the unique substring afterText.
 */
export function computeInsertAfterText(existing: string, afterText: string, fragment: string): string {
	const c = countOccurrences(existing, afterText);
	if (c !== 1) {
		throw new Error(`anchor.afterText must match exactly once (found ${c})`);
	}
	const idx = existing.indexOf(afterText);
	const end = idx + afterText.length;
	return existing.slice(0, end) + fragment + existing.slice(end);
}

/**
 * Insert fragment immediately before the unique substring beforeText.
 */
export function computeInsertBeforeText(existing: string, beforeText: string, fragment: string): string {
	const c = countOccurrences(existing, beforeText);
	if (c !== 1) {
		throw new Error(`anchor.beforeText must match exactly once (found ${c})`);
	}
	const idx = existing.indexOf(beforeText);
	return existing.slice(0, idx) + fragment + existing.slice(idx);
}

/**
 * Dispatch insert by normalized anchor.
 */
export function computeInsertAt(existing: string, anchor: InsertAnchor, fragment: string): string {
	if ("line" in anchor) {
		return computeInsertAtLine(existing, anchor.line, fragment);
	}
	if ("afterText" in anchor) {
		return computeInsertAfterText(existing, anchor.afterText, fragment);
	}
	return computeInsertBeforeText(existing, anchor.beforeText, fragment);
}
