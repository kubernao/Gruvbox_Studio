import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function summarizeToolError(toolName: string, text: string): string {
	const body = String(text ?? "").trim();
	if (!body) return `${toolName}: unknown error`;
	if (/must have required properties|required/i.test(body)) {
		return `${toolName}: validation_error`;
	}
	if (/not found|no such file|does not exist/i.test(body)) {
		return `${toolName}: not_found`;
	}
	if (/timeout|rate limit|unavailable/i.test(body)) {
		return `${toolName}: transient_error`;
	}
	return `${toolName}: unknown_error`;
}

export default function toolReliabilityGuardExtension(pi: ExtensionAPI) {
	pi.on("tool_execution_end", (event, ctx) => {
		if (!ctx.hasUI) return;
		const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
		if (!event.isError) return;
		const blocks = Array.isArray(event.result?.content) ? event.result.content : [];
		const text = blocks
			.filter((b): b is { type: "text"; text: string } => b?.type === "text" && typeof b.text === "string")
			.map((b) => b.text)
			.join("\n");
		const summary = summarizeToolError(toolName, text);
		ctx.ui.notify(`Tool reliability guard: ${summary}`, "warning");
	});
}
