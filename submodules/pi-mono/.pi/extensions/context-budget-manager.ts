import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, truncateHead } from "@mariozechner/pi-coding-agent";

const MAX_TOOL_RESULT_BYTES = Math.min(DEFAULT_MAX_BYTES, 20_000);
const COMPACTION_TRIGGER_RATIO = 0.9;

/**
 * Returns a text block that is safe to keep in context by applying a strict
 * head truncation policy. The suffix indicates that compaction occurred so
 * replay harnesses can verify budget enforcement deterministically.
 */
function compactTextForContext(text: string): string {
	const truncation = truncateHead(text, { maxBytes: MAX_TOOL_RESULT_BYTES, maxLines: 800 });
	if (!truncation.truncated) return truncation.content;
	return `${truncation.content}\n\n[truncated-for-context-budget]`;
}

/**
 * Applies context-budget compaction to tool result messages only. We preserve
 * user and assistant content untouched while reducing oversized tool outputs,
 * since these are the most common source of overflow failures.
 */
function compactToolResultMessages(messages: AgentMessage[]): AgentMessage[] {
	return messages.map((message) => {
		if (message.role !== "toolResult" || !Array.isArray(message.content)) return message;
		const nextContent = message.content.map((part) => {
			if (part.type !== "text" || typeof part.text !== "string") return part;
			return { ...part, text: compactTextForContext(part.text) };
		});
		return { ...message, content: nextContent };
	});
}

/**
 * Context budget manager that proactively compacts oversized tool output and
 * requests guided compaction before the session exceeds model limits. This
 * extension focuses on reducing overflow-related failures without modifying
 * user intent or assistant reasoning content.
 */
export default function contextBudgetManager(pi: ExtensionAPI) {
	pi.on("context", (event, ctx) => {
		const usage = ctx.getContextUsage();
		const compacted = compactToolResultMessages(event.messages);
		if (!usage || usage.contextWindow <= 0) {
			return { messages: compacted };
		}
		const ratio = usage.tokens / usage.contextWindow;
		if (ratio >= COMPACTION_TRIGGER_RATIO) {
			ctx.compact({
				customInstructions:
					"Keep user intent and latest tool outcomes. Remove verbose intermediary tool logs and duplicate output.",
			});
		}
		return { messages: compacted };
	});
}
