# Archive parity (Vue Git tab → React)

This document maps the legacy **Claurst-era** Git sidebar in `archive/source/win-main/sidebar/` to the current React implementation under `src/frontend/features/git/`. The `archive/` tree is not shipped with this repo; pull it from the upstream revision when you need the original Vue sources.

## Layout in `archive/`

- **Reference root:** `archive/source/win-main/sidebar/`
- **Graph sync composable:** `composables/use-git-history-graph-sync.ts` — schedules `syncGitHistoryGraphMount`, then `paintGitgraphDotSelection`.
- **Mount / import:** `git-tab-graph-mount.ts` — DOM mount, `import()` retries, teardown.
- **Import rows + custom dot/message (Vue):** `git-tab-graph.ts` — `buildGitgraphImportRows`, selection paint helpers.
- **Branch colors / chronology:** `git-tab-graph-branch-colors.ts` — `buildGitLogFileGraphContext`, FNV palette, badge refs, `ensureBranchRefsForGitgraphImport`.
- **DAG model:** `git-tab-graph-model.ts` — `buildCommitGraphModel`, `importParentHashesForGitgraph`, `GraphEdgeConnectivity`.
- **Heatmap palette:** `git-tab-graph-heatmap-colors.ts` — `GRUVBOX_BRANCH_PALETTE`, `paletteColorForBranchName`.
- **Layout constants:** `git-tab-graph-layout.ts` — spacing, dot radius, Metro label font.
- **Branch picker:** `GitBranchPickerGraph.vue` + `GitSidebarGraphHollowDot.vue`.

`GitTab.vue` is not present in this archive snapshot; behavior is inferred from the modules above and inline comments.

## React mapping

| Archive | React |
|--------|--------|
| `git-tab-graph-model.ts` | `utils/gitTabGraphModel.ts` |
| `git-tab-graph-heatmap-colors.ts` | `utils/gitTabGraphHeatmapColors.ts` |
| `git-tab-graph-branch-colors.ts` | `utils/gitTabGraphBranchColors.ts` |
| `git-tab-graph.ts` (import rows) | `utils/gitGraphUtils.ts` |
| Graph mount / lifecycle | `components/CommitGraphRenderer.tsx` + `components/HistoryGraphSvg.tsx` (windowed lanes via `utils/windowLaneAllocator.ts`; full `commit-graph` fallback on allocation failure) |
| Branch list UI | `components/BranchSection.tsx` |
| Rust-accelerated graph context | `hooks/useGitTab.ts` → `rust:buildCommitGraph` IPC (see `docs/RUST_MIGRATION_PLAN.md`) |

Removed during cleanup (never wired in production): branch-picker graph cluster (`GitBranchPickerGraph`, `GitSidebarGraphHollowDot`, `gitBranchPickerLayout`, `gitGraphSelectionPaint`, `gitTabGraphLayout`, `gitGraphBadgeLabel`).

## Data fields

Archive `GitLogEntry` used `parentHashes` and `refDecorations`. This app uses **`parents`** and **`decorations`** (see `types/git.ts`); ported helpers read those names.

## Missing upstream modules

If you need the exact upstream `GitTab.vue`, pull it from the same revision as the rest of `archive/`.
