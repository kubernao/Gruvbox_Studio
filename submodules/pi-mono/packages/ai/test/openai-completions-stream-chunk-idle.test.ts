import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.js";
import { resolveStreamChunkIdleTimeoutMs } from "../src/providers/openai-completions.js";
import { streamSimple } from "../src/stream.js";

const mockState = vi.hoisted(() => ({
	lastParams: undefined as unknown,
	chunks: undefined as Array<null | Record<string, unknown>> | undefined,
}));

function waitUntilAborted(signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		if (!signal) {
			resolve();
			return;
		}
		if (signal.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}
		signal.addEventListener(
			"abort",
			() => {
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true },
		);
	});
}

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (_params: unknown, opts?: { signal?: AbortSignal }) => {
					const signal = opts?.signal;
					const stream = {
						async *[Symbol.asyncIterator]() {
							const chunks = mockState.chunks ?? [
								{
									id: "chatcmpl-test",
									choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
								},
							];
							for (const chunk of chunks) {
								if (signal?.aborted) {
									throw new DOMException("Aborted", "AbortError");
								}
								yield chunk;
							}
							// Simulate a hung SSE connection: block until the stream signal aborts.
							await waitUntilAborted(signal);
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

describe("openai-completions stream chunk idle", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
		mockState.chunks = undefined;
		delete process.env.PI_OPENAI_STREAM_CHUNK_IDLE_MS;
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolveStreamChunkIdleTimeoutMs defaults to 120s", () => {
		expect(resolveStreamChunkIdleTimeoutMs()).toBe(120_000);
	});

	it("resolveStreamChunkIdleTimeoutMs clamps sub-minimum env values to 30s", () => {
		process.env.PI_OPENAI_STREAM_CHUNK_IDLE_MS = "50";
		expect(resolveStreamChunkIdleTimeoutMs()).toBe(30_000);
	});

	it("ends with error when the provider stream stalls after the first chunk", async () => {
		vi.useFakeTimers();
		process.env.PI_OPENAI_STREAM_CHUNK_IDLE_MS = "30000";

		mockState.chunks = [
			{
				id: "chatcmpl-test",
				choices: [{ delta: { content: "first" }, finish_reason: null }],
			},
		];

		const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
		const model = { ...baseModel, api: "openai-completions" } as const;

		const streamResult = streamSimple(
			model,
			{
				messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
			},
			{ apiKey: "test" },
		);

		const resultPromise = streamResult.result();
		await vi.waitFor(() => {
			expect(resolveStreamChunkIdleTimeoutMs()).toBe(30_000);
		});
		await vi.advanceTimersByTimeAsync(30_100);
		const result = await resultPromise;

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("Stream idle");
	});
});
