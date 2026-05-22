import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ToolErrorCategory = "validation_error" | "blocked_unsafe" | "execution_error";

/**
 * Validates essential shape requirements for high-risk built-in tools. The
 * checks are intentionally minimal and deterministic so we can block malformed
 * calls early without changing legitimate tool behavior.
 */
function getValidationIssue(toolName: string, input: unknown): string {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return "Input must be an object.";
	}
	const args = input as Record<string, unknown>;
	if (toolName === "write" && typeof args.path !== "string") return "write.path is required.";
	if (toolName === "write" && typeof args.content !== "string") return "write.content is required.";
	if (toolName === "append_to_file" && typeof args.path !== "string") return "append_to_file.path is required.";
	if (toolName === "append_to_file" && typeof args.content !== "string") return "append_to_file.content is required.";
	if (toolName === "prepend_to_file" && typeof args.path !== "string") return "prepend_to_file.path is required.";
	if (toolName === "prepend_to_file" && typeof args.content !== "string") return "prepend_to_file.content is required.";
	if (toolName === "insert_at" && typeof args.path !== "string") return "insert_at.path is required.";
	if (toolName === "insert_at" && typeof args.content !== "string") return "insert_at.content is required.";
	if (
		toolName === "insert_at" &&
		(args.anchor === undefined ||
			args.anchor === null ||
			typeof args.anchor !== "object" ||
			Array.isArray(args.anchor))
	)
		return "insert_at.anchor is required.";
	if (toolName === "edit" && typeof args.path !== "string") return "edit.path is required.";
	if (toolName === "bash" && typeof args.command !== "string") return "bash.command is required.";
	if (toolName === "memory_remember") {
		if (typeof args.kind !== "string" || args.kind.trim() === "") return "memory_remember.kind is required.";
		const canonicalKind = args.kind.trim().toLowerCase();
		const validKinds = new Set(["character", "location", "thread", "note", "fact"]);
		if (!validKinds.has(canonicalKind)) return "memory_remember.kind must be one of: character, location, thread, note, fact.";
		if (typeof args.title !== "string" || args.title.trim() === "") return "memory_remember.title is required.";
		if (typeof args.body !== "string" || args.body.trim() === "") return "memory_remember.body is required.";
	}
	return "";
}

/**
 * Creates a short diagnostic string for tool failures that can be consumed by
 * reliability dashboards and replay tests. We keep this output compact and
 * categorized to avoid brittle matching against full error text.
 */
function toDiagnostic(toolName: string, category: ToolErrorCategory, detail: string): string {
	const detailText = detail.trim() || "unknown";
	return `${toolName}:${category}:${detailText}`;
}

/**
 * Tool-call sanitizer extension that blocks malformed calls before execution
 * and records normalized error categories for failed tool results. This gives
 * us a consistent failure surface for KPI tracking and deterministic
 * regression tests.
 */
export default function toolCallSanitizer(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		const issue = getValidationIssue(event.toolName, event.input);
		if (!issue) return;
		const summary = toDiagnostic(event.toolName, "validation_error", issue);
		pi.sendMessage(
			{
				customType: "tool-reliability",
				content: summary,
				display: false,
				details: { category: "validation_error", toolName: event.toolName, issue },
			},
			{ deliverAs: "nextTurn" },
		);
		if (ctx.hasUI) {
			ctx.ui.notify(`Tool call blocked: ${issue}`, "warning");
		}
		return { block: true, reason: issue };
	});

	pi.on("tool_result", (event) => {
		if (!event.isError) return;
		const text = event.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n");
		const summary = toDiagnostic(event.toolName, "execution_error", text);
		pi.sendMessage(
			{
				customType: "tool-reliability",
				content: summary,
				display: false,
				details: { category: "execution_error", toolName: event.toolName },
			},
			{ deliverAs: "nextTurn" },
		);
	});
}
