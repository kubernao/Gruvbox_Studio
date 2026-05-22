# Archive parity (Vue Git tab → React)

This folder documents how the legacy **Claurst-era** Git sidebar in `archive/source/win-main/sidebar/` maps to the React implementation under `src/renderer/features/versionControl/`.

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
| `git-tab-graph-layout.ts` (constants) | `utils/gitTabGraphLayout.ts` |
| `git-graph-badge-label.ts` | `utils/gitGraphBadgeLabel.ts` |
| `git-tab-graph.ts` `paintGitgraphDotSelection` | `utils/gitGraphSelectionPaint.ts` (adapted for `@gitgraph/react` DOM) |
| `use-git-history-graph-sync.ts` | `hooks/useGitHistoryGraphSync.ts` |
| `GitBranchPickerGraph.vue` | `components/GitBranchPickerGraph.tsx` |
| `GitSidebarGraphHollowDot.vue` | `components/GitSidebarGraphHollowDot.tsx` |
| `git-tab-graph-mount.ts` | Not ported 1:1 — React uses `@gitgraph/react` `<Gitgraph>`; lifecycle covered by `CommitGraphHost` + hook |

## Data fields

Archive `GitLogEntry` used `parentHashes` and `refDecorations`. This app uses **`parents`** and **`decorations`** (see `types/git.ts`); ported helpers read those names.

## Missing upstream modules

If you need the exact upstream `GitTab.vue`, pull it from the same revision as the rest of `archive/`.
