import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ProviderFailureClass =
	| "transport"
	| "throttle"
	| "provider"
	| "auth"
	| "billing_idempotency"
	| "unknown";

/**
 * Classifies provider response metadata into a stable taxonomy that can be
 * consumed by UI diagnostics and replay tooling. The classification uses only
 * status code and normalized headers so it remains deterministic and does not
 * leak sensitive payload data.
 */
function classifyProviderFailure(status: number, headers: Record<string, string>): ProviderFailureClass {
	if (status === 401 || status === 403) return "auth";
	if (status === 409 || headers["x-error-code"] === "IDEMPOTENCY_IN_FLIGHT") return "billing_idempotency";
	if (status === 429) return "throttle";
	if (status >= 500) return "provider";
	if (status <= 0) return "transport";
	return "unknown";
}

/**
 * Builds a compact diagnostics message that can be persisted in session
 * history and replayed in tests. We intentionally keep this shape simple and
 * stable so downstream harnesses can assert behavior without coupling to
 * transient provider response details.
 */
function buildProviderDiagnostics(status: number, headers: Record<string, string>) {
	const failureClass = classifyProviderFailure(status, headers);
	return {
		failureClass,
		status,
		retryAfter: headers["retry-after"] ?? "",
		errorCode: headers["x-error-code"] ?? "",
	};
}

/**
 * Provider reliability guard extension that validates outgoing payload shape,
 * classifies failed responses, and emits structured diagnostics entries for
 * replay and operational triage. The guard is intentionally conservative: it
 * only rewrites obvious malformed payload fields and leaves semantic behavior
 * unchanged.
 */
export default function providerReliabilityGuard(pi: ExtensionAPI) {
	pi.on("before_provider_request", (event) => {
		if (!event?.payload || typeof event.payload !== "object") return;
		const payload = event.payload as Record<string, unknown>;
		if (typeof payload.model === "string") {
			payload.model = payload.model.trim();
		}
	});

	pi.on("after_provider_response", (event, ctx) => {
		if (event.status < 400) return;
		const diagnostics = buildProviderDiagnostics(event.status, event.headers ?? {});
		pi.sendMessage(
			{
				customType: "provider-reliability",
				content: `Provider failure: ${diagnostics.failureClass} (${diagnostics.status})`,
				display: false,
				details: diagnostics,
			},
			{ deliverAs: "nextTurn" },
		);
		if (ctx.hasUI) {
			ctx.ui.notify(
				`Provider guard classified failure as ${diagnostics.failureClass} (${diagnostics.status}).`,
				"warning",
			);
		}
	});
}
