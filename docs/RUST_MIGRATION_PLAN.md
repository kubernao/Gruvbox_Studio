# Rust Migration Plan

## Overview

This document tracks the plan to move pure-logic TypeScript/JavaScript modules into the Rust backend and wire up the native binding layer that currently sits dormant.

The existing `rust-sidecar/` crate is already structured as a `cdylib` (native Node.js addon) but `rust-bridge.js` is a **pure JS fallback** with a comment that says "in production, this would use native bindings." Phase 0 activates that real binding before any new logic is ported.

---

## Architecture

```
Renderer (React)
    ↓  IPC channel
Main process (Node.js)
    ↓  napi-rs native module
Rust (gruvbox-file-ops.node)
```

All Rust functions are exposed to Node.js via [napi-rs](https://napi.rs/). The main process calls them synchronously or asynchronously. The renderer never calls Rust directly — it goes through the existing IPC layer.

---

## Phase 0 — Activate the native binding (prerequisite)

**Goal:** Replace the JS fallback in `rust-bridge.js` with real calls to the compiled Rust library.

**Steps:**

1. Add `napi` and `napi-derive` to `Cargo.toml`:
   ```toml
   [dependencies]
   napi = { version = "2", features = ["napi4", "async"] }
   napi-derive = "2"
   ```

2. Annotate the existing public functions in `file_ops.rs` and `watcher.rs` with `#[napi]`.

3. Add a build script (`build.rs`) that generates the `.node` binary into a `dist-rust/` output folder.

4. Update `rust-bridge.js` to load the native module:
   ```js
   const nativeModule = require('../../dist-rust/gruvbox-file-ops.node');
   ```
   and replace each method body with the corresponding native call.

5. Add `dist-rust/` to `.gitignore` and add a `build:rust` npm script:
   ```json
   "build:rust": "cd rust-sidecar && cargo build --release"
   ```

**Files changed:**
- `rust-sidecar/Cargo.toml`
- `rust-sidecar/src/file_ops.rs`
- `rust-sidecar/src/watcher.rs`
- `rust-sidecar/src/lib.rs`
- `src/electron-main/ipc/rust-bridge.js`
- `package.json`

---

## Phase 1 — Diff parser and merge resolver

**Goal:** Port the two most computation-heavy pure-logic files in `DiffViewer/`.

### 1a. `diffParser.ts` → `rust-sidecar/src/diff_parser.rs`

**What it does:** Parses unified `git diff` output into aligned side-by-side row structs. Pure string processing, no DOM.

**Port strategy:**
- Implement `parse_unified_diff(diff_text: String) -> Vec<DiffRow>` in Rust.
- `DiffRow` and `ChangeBlock` become Rust structs with `#[napi(object)]`.
- Expose `parse_unified_diff`, `build_side_by_side_rows`, and `build_change_blocks` as `#[napi]` functions.
- In `rust-bridge.js`, add `parseDiff(text)` which calls the native function.
- Add a new IPC channel `rust:parseDiff` in `main.js`.
- Replace the `parseUnifiedDiff` import in `DiffViewer.tsx` with an async IPC call.

**Files changed:**
- New: `rust-sidecar/src/diff_parser.rs`
- `rust-sidecar/src/lib.rs` (add `pub mod diff_parser`)
- `src/electron-main/ipc/rust-bridge.js`
- `src/electron-main/main.js`
- `src/frontend/components/DiffViewer/utils/diffParser.ts` (keep as thin TS shim that calls IPC, or delete if callers are updated)
- `src/frontend/shared/utils/ipc.ts` (add channel type)

### 1b. `mergeResolver.ts` → `rust-sidecar/src/merge_resolver.rs`

**What it does:** Detects and resolves merge conflicts in diff rows. Pure logic operating on the `DiffRow` type from 1a.

**Port strategy:**
- Port after 1a since it depends on the same `DiffRow` type.
- Expose `resolve_conflicts(rows: Vec<DiffRow>, strategy: String) -> Vec<DiffRow>`.
- Wire up via new IPC channel `rust:resolveMerge`.

**Files changed:**
- New: `rust-sidecar/src/merge_resolver.rs`
- `rust-sidecar/src/lib.rs`
- `src/electron-main/ipc/rust-bridge.js`
- `src/electron-main/main.js`
- `src/frontend/components/DiffViewer/utils/mergeResolver.ts` (replace body or delete)

---

## Phase 2 — Git graph computation

**Goal:** Move the graph layout and decoration parsing pipeline to Rust. These run on every git log refresh and scale with repo size.

### 2a. `gitDecorationParse.ts` → `rust-sidecar/src/git_decoration.rs`

**What it does:** Parses the `decorations` string from `git log` into a list of ref names (branches, tags, HEAD).

**Port strategy:**
- `parse_git_decoration_refs(raw: String) -> Vec<String>` in Rust.
- Simple regex/string splitting — straightforward port.

### 2b. `gitTabGraphModel.ts` → `rust-sidecar/src/git_graph_model.rs`

**What it does:** Builds a vertex/edge graph model from `GitLogEntry[]`. Determines parent-child relationships, computes which commits to show as graph nodes.

**Port strategy:**
- Define `GitLogEntry` and `GraphVertex` as `#[napi(object)]` structs.
- Implement `build_commit_graph_model(entries: Vec<GitLogEntry>, connectivity: String) -> GraphModel`.

### 2c. `gitTabGraphLayout.ts` + `gitBranchPickerLayout.ts` → `rust-sidecar/src/git_graph_layout.rs`

**What it does:** Assigns x-column positions to commits for rendering the branching diagram. The branch picker uses a simplified version of the same algorithm.

**Port strategy:**
- Implement as a pure function: `layout_commit_graph(model: GraphModel) -> Vec<LayoutRow>`.
- Return column assignments as a flat array — rendering stays in TS.

### 2d. `gitTabGraphBranchColors.ts` + `gitTabGraphHeatmapColors.ts` → `rust-sidecar/src/git_graph_colors.rs`

**What it does:** Assigns colors to branches from the Gruvbox palette, builds heatmap colors based on commit age.

**Port strategy:**
- Port the palette lookup and heatmap interpolation math.
- Return color strings (`#rrggbb`) — CSS stays in TS.

**IPC wiring for Phase 2:**
- Add a single `rust:buildCommitGraph` channel that accepts `GitLogEntry[]` and returns `{ layoutRows, branchColors, decorations }` — one round-trip for the full pipeline.
- Update `useGitTab.ts` and `useGitHistoryGraphSync.ts` to call this channel instead of the TS utils.

**Files changed:**
- New: `rust-sidecar/src/git_decoration.rs`, `git_graph_model.rs`, `git_graph_layout.rs`, `git_graph_colors.rs`
- `rust-sidecar/src/lib.rs`
- `src/electron-main/ipc/rust-bridge.js`
- `src/electron-main/main.js`
- `src/frontend/features/git/utils/gitDecorationParse.ts` (replace or delete)
- `src/frontend/features/git/utils/gitTabGraphModel.ts` (replace or delete)
- `src/frontend/features/git/utils/gitTabGraphLayout.ts` (replace or delete)
- `src/frontend/features/git/utils/gitBranchPickerLayout.ts` (replace or delete)
- `src/frontend/features/git/utils/gitTabGraphBranchColors.ts` (replace or delete)
- `src/frontend/features/git/utils/gitTabGraphHeatmapColors.ts` (replace or delete)
- `src/frontend/features/git/hooks/useGitTab.ts`
- `src/frontend/shared/utils/ipc.ts`

---

## Phase 3 — Markdown processing

**Goal:** Port the Markdown → HTML pipeline to Rust using the `pulldown-cmark` crate, which is faster than the JS `marked` library and avoids the `sanitize-html` dependency.

### `markdownPreviewHtml.ts` + `markdownProseHighlight.ts` → `rust-sidecar/src/markdown.rs`

**What it does:** Converts Markdown to sanitized HTML for the preview pane. `markdownProseHighlight.ts` does regex-based inline token detection for the editor surface.

**Port strategy:**
- Add `pulldown-cmark` to `Cargo.toml` for Markdown → HTML.
- Add `ammonia` crate for HTML sanitization (replaces `sanitize-html` npm package).
- Expose `render_markdown(source: String) -> String` via `#[napi]`.
- The prose highlight tokenizer is a separate simpler function: `tokenize_prose(source: String) -> Vec<ProseToken>`.
- Wire up via `rust:renderMarkdown` IPC channel.
- `markdownPreviewHtml.ts` becomes a thin async wrapper around the IPC call.

**New Cargo dependencies:**
```toml
pulldown-cmark = "0.11"
ammonia = "4"
```

**Files changed:**
- New: `rust-sidecar/src/markdown.rs`
- `rust-sidecar/Cargo.toml`
- `rust-sidecar/src/lib.rs`
- `src/electron-main/ipc/rust-bridge.js`
- `src/electron-main/main.js`
- `src/frontend/features/editor/markdownPreviewHtml.ts` (replace body)
- `src/frontend/features/editor/markdownProseHighlight.ts` (replace body)

---

## Phase 4 — Utilities

These are smaller files with no dependencies on React or DOM. Lower priority but easy wins.

### `errorMessages.ts` → `rust-sidecar/src/error_messages.rs`

**What it does:** Maps error codes to human-readable strings. Pure data + formatting.

**Port strategy:** Move the lookup table and formatting logic to Rust. Expose `format_error_message(code: String, context: Option<String>) -> String`.

### `file-permissions.js` → extend `rust-sidecar/src/file_ops.rs`

**What it does:** Checks whether a file is read-only. Already a 27-line utility.

**Port strategy:** Add a `get_permissions(path: String) -> PermissionsResult` function to the existing `file_ops.rs`. Already handles metadata so this is a small addition.

---

## File Index

| Source file | Rust target | Phase | Priority |
|---|---|---|---|
| `src/electron-main/ipc/rust-bridge.js` | Wire up existing native binding | 0 | **Critical** |
| `src/frontend/components/DiffViewer/utils/diffParser.ts` | `diff_parser.rs` | 1a | High |
| `src/frontend/components/DiffViewer/utils/mergeResolver.ts` | `merge_resolver.rs` | 1b | High |
| `src/frontend/features/git/utils/gitDecorationParse.ts` | `git_decoration.rs` | 2a | High |
| `src/frontend/features/git/utils/gitTabGraphModel.ts` | `git_graph_model.rs` | 2b | High |
| `src/frontend/features/git/utils/gitTabGraphLayout.ts` | `git_graph_layout.rs` | 2c | High |
| `src/frontend/features/git/utils/gitBranchPickerLayout.ts` | `git_graph_layout.rs` | 2c | High |
| `src/frontend/features/git/utils/gitTabGraphBranchColors.ts` | `git_graph_colors.rs` | 2d | Medium |
| `src/frontend/features/git/utils/gitTabGraphHeatmapColors.ts` | `git_graph_colors.rs` | 2d | Medium |
| `src/frontend/features/editor/markdownPreviewHtml.ts` | `markdown.rs` | 3 | Medium |
| `src/frontend/features/editor/markdownProseHighlight.ts` | `markdown.rs` | 3 | Medium |
| `src/frontend/shared/utils/errorMessages.ts` | `error_messages.rs` | 4 | Low |
| `src/electron-main/ipc/handlers/file-permissions.js` | extend `file_ops.rs` | 4 | Low |

---

## Files intentionally excluded

| File | Reason |
|---|---|
| All `*.tsx` / `*.tsx` React components | Renderer process; must stay in JS/TS for DOM access |
| `src/electron-main/main.js` (IPC handlers) | Orchestration layer; keeping in JS avoids reimplementing the Electron event loop |
| `src/frontend/shared/utils/ipc.ts` | Type-safe IPC wrapper; needs TypeScript for compile-time channel safety |
| `src/frontend/features/git/utils/gitGraphBadgeLabel.ts` | Trivial; no perf benefit |
| `src/frontend/features/git/utils/commitGraphLayoutCompat.ts` | Thin compat shim; not worth porting |
| `src/frontend/features/git/utils/gitGraphSelectionPaint.ts` | Canvas rendering; must run in renderer |
| `scrollSync.ts`, `ribbonRenderer.ts` | DOM/scroll APIs; renderer-only |

---

## Testing strategy

Each phase ships with parity tests before the TS source is deleted:

1. **Unit tests in Rust** (`rust-sidecar/src/*.rs` `#[cfg(test)]` blocks) covering the same cases as the existing Vitest tests.
2. **Parity check** — run both the TS and Rust implementations against the same input and assert identical output. Keep this check in CI until the TS file is removed.
3. **Existing Vitest tests** (`tests/vitest/diff-parser.test.ts`, `git-helpers.test.ts`, etc.) continue to pass — they now exercise the IPC path end-to-end.
4. **Playwright smoke tests** remain unchanged; they test UI behavior, not implementation.

---

## Dependencies to add

```toml
# napi-rs binding layer
napi = { version = "2", features = ["napi4", "async"] }
napi-derive = "2"

# Phase 3 — Markdown
pulldown-cmark = "0.11"
ammonia = "4"
```

```json
// package.json devDependencies
"@napi-rs/cli": "^2"
```
