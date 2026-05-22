# Pi Harness Parity Matrix

This matrix locks must-match behavior between upstream Pi coding-agent and Gruvbox's Electron bridge.

## Must-Match Contracts

| Area | Upstream Pi Expectation | Gruvbox Requirement |
|---|---|---|
| Tool call transport | Structured tool-call events drive execution, not plain text JSON | Never treat assistant text JSON as a valid tool call |
| Tool result feedback | Structured success/error content blocks | Emit typed `toolEnvelope` + minimal descriptive text |
| Retry loop | Bounded correction loop, deterministic stop | Error-class retry policy with explicit exhaustion |
| Mutation safety | Invalid mutations fail fast with actionable next step | `write(path-only)` auto-fallback to `read/edit` flow |
| Session lifecycle | One active stream per session | One stream state per window/request, no global bleed |
| Prompt context | Conversational context informs tool decisions | Feed compact transcript context, not latest-user-only |
| Renderer boundary | Rendering does not mutate model-facing payload | Strip UI tool tokens from model transcript payload |

## Known Divergences (intentional)

- Host policy guard for malformed mutations (`write` missing `content`).
- KPI telemetry and feature flags for staged rollout.

## Acceptance Gates

1. Repeated `write(path-only)` no longer loops.
2. Model recovers in-turn through read/edit or valid write payload.
3. UI tokenization never leaks into model-facing transcript.
4. Session abort/reuse behavior is deterministic by window + request ID.
