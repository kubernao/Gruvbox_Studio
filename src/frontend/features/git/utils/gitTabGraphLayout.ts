/**
 * @ignore
 * Single source for Git-tab graph geometry + typography (sidebar).
 * Consumed by the React git tab (`CommitGraphRenderer`, `GitBranchPickerGraph`).
 */

/** Vertical step between commit rows (`template.commit.spacing`). */
export const GIT_TAB_GRAPH_COMMIT_SPACING = 48

/** Commit dot radius in SVG (`template.commit.dot.size` = circle `r`). */
export const GIT_TAB_GRAPH_DOT_RADIUS = 5

/** Scale applied to the selected commit dot (local coords, centered on `cx`/`cy`). */
export const GIT_TAB_GRAPH_DOT_SELECTED_SCALE = 1.22

/**
 * Metro template `commit.dot.strokeWidth`; `createGitgraphCommitDotElement` doubles on `<use>` → ring ~6px.
 * Picker junction rings use the doubled value to match the rendered graph.
 */
export const GIT_TAB_GRAPH_DOT_STROKE_TEMPLATE = 1.5

export const GIT_TAB_GRAPH_DOT_RING_PX =
  GIT_TAB_GRAPH_DOT_STROKE_TEMPLATE * 2

/** `template.branch.lineWidth`. */
export const GIT_TAB_GRAPH_BRANCH_LINE_WIDTH = 2

/** `template.branch.spacing` (column gap in the commit graph layout). */
export const GIT_TAB_GRAPH_BRANCH_SPACING = 14

/** `template.commit.message` body size. */
export const GIT_TAB_GRAPH_COMMIT_MESSAGE_PX = 16

/** `template.branch.label` — Metro branch tags on the commit graph. */
export const GIT_TAB_GRAPH_BRANCH_LABEL_PX = 11

export const GIT_TAB_GRAPH_BRANCH_LABEL_FONT =
  `600 ${GIT_TAB_GRAPH_BRANCH_LABEL_PX}px var(--font-ui), system-ui, sans-serif`

/** Picker: checked-out branch (+1px, bolder — graph has no separate “current” tag style). */
export const GIT_TAB_GRAPH_BRANCH_LABEL_CURRENT_PX = GIT_TAB_GRAPH_BRANCH_LABEL_PX + 1

export const GIT_TAB_GRAPH_BRANCH_LABEL_CURRENT_FONT =
  `700 ${GIT_TAB_GRAPH_BRANCH_LABEL_CURRENT_PX}px var(--font-ui), system-ui, sans-serif`

/** `template.branch.label.borderRadius` (Metro). */
export const GIT_TAB_GRAPH_BRANCH_LABEL_RADIUS = 5

/**
 * Uniform visual scale for the branch-switching picker SVG so it matches
 * the apparent size of the commit history graph rendered by `commit-graph`.
 */
export const GIT_TAB_GRAPH_BRANCH_PICKER_SCALE = 1
