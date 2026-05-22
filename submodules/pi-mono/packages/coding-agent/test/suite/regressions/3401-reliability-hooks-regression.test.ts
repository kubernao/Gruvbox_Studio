import { fauxAssistantMessage, fauxToolCall } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.js";

/**
 * These regressions cover reliability hardening hooks that guard provider
 * payload quality and tool-call validity. The cases are deterministic and
 * intentionally narrow so they can be replayed when production failures are
 * captured into a known-failures corpus.
 */
describe("issue #3401 reliability hooks regression", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("blocks malformed write calls in tool_call preflight", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", (event) => {
						if (event.toolName !== "write") return;
						const input = event.input as Record<string, unknown>;
						if (typeof input.path !== "string" || typeof input.content !== "string") {
							return { block: true, reason: "write requires path and content" };
						}
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "README.md" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("fallback"),
		]);

		await harness.session.prompt("trigger malformed write");

		const writeExecutionEnd = harness.eventsOfType("tool_execution_end").find((event) => event.toolName === "write");
		expect(writeExecutionEnd?.isError).toBe(true);
	});
});
