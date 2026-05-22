# Chat Model Contract

This document defines the model-ID contract between `Gruvbox_studio` and the
`gruvbox_api` OpenAI-compatible gateway.

## Source of Truth

- Treat model IDs returned by `GET /v1/models` or
  `GET /v1/gateway/models?scope=all` as authoritative.
- Forward the selected model ID unchanged to
  `POST /v1/chat/completions`.

## Requirements

- The chat send path must always provide a non-empty model ID.
- Placeholder values like `unknown`, `(unknown)`, and `default model` are
  invalid and must be rejected before request dispatch.
- Gateway roots must be normalized to an origin (no `/api` path), and legacy
  hosts should be remapped to the current production host.

## Why This Exists

`gruvbox_api` forwards `model` to OpenRouter without local translation. If the
desktop client mutates, strips, or fabricates model IDs, chat completions can
fail even when model listing works.
