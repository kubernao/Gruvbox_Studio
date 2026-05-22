import type { AgentTool } from "@mariozechner/pi-agent-core";
import * as Diff from "diff";
import { Type } from "typebox";
import type { Executor } from "../sandbox.js";

/**
 * Generate a unified diff string with line numbers and context
 */
function generateDiffString(oldContent: string, newContent: string, contextLines = 4): string {
	const parts = Diff.diffLines(oldContent, newContent);
	const output: string[] = [];

	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;

	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") {
			raw.pop();
		}

		if (part.added || part.removed) {
			for (const line of raw) {
				if (part.added) {
					const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
					output.push(`+${lineNum} ${line}`);
					newLineNum++;
				} else {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(`-${lineNum} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);

			if (lastWasChange || nextPartIsChange) {
				let linesToShow = raw;
				let skipStart = 0;
				let skipEnd = 0;

				if (!lastWasChange) {
					skipStart = Math.max(0, raw.length - contextLines);
					linesToShow = raw.slice(skipStart);
				}

				if (!nextPartIsChange && linesToShow.length > contextLines) {
					skipEnd = linesToShow.length - contextLines;
					linesToShow = linesToShow.slice(0, contextLines);
				}

				if (skipStart > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				}

				for (const line of linesToShow) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}

				if (skipEnd > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				}

				oldLineNum += skipStart + skipEnd;
				newLineNum += skipStart + skipEnd;
			} else {
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}

			lastWasChange = false;
		}
	}

	return output.join("\n");
}

/**
 * Normalizes text for fuzzy matching by preserving semantic content while
 * tolerating formatting drift (line-ending variants, trailing spaces,
 * smart quotes, unicode dashes, and uncommon unicode spaces).
 */
function normalizeForFuzzyMatch(text: string): string {
	return text
		.normalize("NFKC")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

/**
 * Finds a unique match for oldText in content using exact search first, then
 * fuzzy-normalized search as a fallback. It returns the content space that
 * should be used for replacement so indices are always correct.
 */
function findTextWithFuzzyFallback(
	content: string,
	oldText: string,
): { found: boolean; index: number; matchLength: number; contentForReplacement: string } {
	const exactIndex = content.indexOf(oldText);
	if (exactIndex !== -1) {
		return {
			found: true,
			index: exactIndex,
			matchLength: oldText.length,
			contentForReplacement: content,
		};
	}

	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
	if (fuzzyIndex === -1) {
		return {
			found: false,
			index: -1,
			matchLength: 0,
			contentForReplacement: content,
		};
	}

	return {
		found: true,
		index: fuzzyIndex,
		matchLength: fuzzyOldText.length,
		contentForReplacement: fuzzyContent,
	};
}

/**
 * Counts oldText occurrences in fuzzy-normalized space so duplicate detection
 * stays consistent for both exact and fallback fuzzy matching.
 */
function countOccurrencesWithFuzzyNormalization(content: string, oldText: string): number {
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	return fuzzyContent.split(fuzzyOldText).length - 1;
}

const editSchema = Type.Object({
	label: Type.String({ description: "Brief description of the edit you're making (shown to user)" }),
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldText: Type.String({ description: "Text to find and replace (exact match first, fuzzy fallback supported)" }),
	newText: Type.String({ description: "New text to replace the old text with" }),
});

export function createEditTool(executor: Executor): AgentTool<typeof editSchema> {
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a file by replacing text. The tool tries exact matching first, then fuzzy matching to tolerate minor whitespace and unicode formatting drift.",
		parameters: editSchema,
		execute: async (
			_toolCallId: string,
			{ path, oldText, newText }: { label: string; path: string; oldText: string; newText: string },
			signal?: AbortSignal,
		) => {
			// Read the file
			const readResult = await executor.exec(`cat ${shellEscape(path)}`, { signal });
			if (readResult.code !== 0) {
				throw new Error(readResult.stderr || `File not found: ${path}`);
			}

			const content = readResult.stdout;

			const matchResult = findTextWithFuzzyFallback(content, oldText);
			if (!matchResult.found) {
				throw new Error(
					`Could not find the target text in ${path}. The tool supports exact match plus fuzzy normalization, so provide a more unique snippet with nearby context.`,
				);
			}

			const baseContent = matchResult.contentForReplacement;
			const occurrences = countOccurrencesWithFuzzyNormalization(baseContent, oldText);
			if (occurrences > 1) {
				throw new Error(
					`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
				);
			}

			const index = matchResult.index;
			const newContent =
				baseContent.substring(0, index) + newText + baseContent.substring(index + matchResult.matchLength);

			if (baseContent === newContent) {
				throw new Error(
					`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
				);
			}

			// Write the file back
			const writeResult = await executor.exec(`printf '%s' ${shellEscape(newContent)} > ${shellEscape(path)}`, {
				signal,
			});
			if (writeResult.code !== 0) {
				throw new Error(writeResult.stderr || `Failed to write file: ${path}`);
			}

			return {
				content: [
					{
						type: "text",
						text: `Successfully replaced text in ${path}.`,
					},
				],
				details: { diff: generateDiffString(baseContent, newContent) },
			};
		},
	};
}

function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}
