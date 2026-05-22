# Collaboration Backbone ADR

## Status
Accepted for incremental rollout (Phase 0/1).

## Context
- The editor is CodeMirror 6 with compartment-based runtime reconfiguration.
- This repository is local-first Electron without an existing durable collaboration server.
- We need incremental delivery behind feature flags, with a practical path to comments and suggested edits.

## Decision
Use `@codemirror/collab` style transaction semantics for the first rollout and provide a local transport adapter now.

## Why not `y-codemirror.next` in this run
- `y-codemirror.next` is preferred long-term when a shared Yjs provider (websocket/webrtc/persistence) exists.
- The current repo has no Yjs transport/deployment topology configured and no backend contract for Y document sync.
- Shipping a partial Yjs stack without durable provider would add dependencies without delivering stable cross-client semantics.

## Consequences
- Phase 1 ships with a feature-flagged local broadcast backbone and presence rendering, suitable for iterative hardening.
- Comments and suggestions remain built as CM6-first extensions (`StateField`/`StateEffect`/`Decoration`) and stay transport-agnostic.
- Future migration path: replace the local transport extension with a Yjs adapter while preserving command contracts and review data model.

## Rollout flags
- `gruvbox-editor-collab` enables collaboration transport/presence.
- `gruvbox-editor-comments` enables anchored comments.
- `gruvbox-editor-suggest` enables suggest/track-changes.
