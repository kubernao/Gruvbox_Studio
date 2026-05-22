/**
 * @ignore
 * Branch/tag pill labels in the Git tab branch picker (`GitBranchPickerGraph`) and Metro commit graph
 * (branch + tag badges on the Metro-style graph). Used from the Version Control tab branch picker and history.
 */

/** Max displayed characters (truncate longer names; ellipsis is three ASCII dots). */
export const GIT_GRAPH_BADGE_MAX_CHARS = 16

/** Prefix length before `"..."` when truncating (13 + 3 = 16). */
export const GIT_GRAPH_BADGE_TRUNC_PREFIX_CHARS = 13

const GIT_GRAPH_BADGE_ELLIPSIS = '...'

/** Local AI session branches show a fixed label instead of ellipsized hash tail. */
const SESSION_PREFIXES = ['pi-session']

export const AI_SESSION_BADGE_DISPLAY = 'AI-Session'

/**
 * Shorten a ref name for on-graph badges. Full names stay available via SVG `<title>` / tooltips where applied.
 */
export function truncateGitgraphBadgeLabel (name: string): string {
  const trimmed = name.trim()
  if (SESSION_PREFIXES.some((prefix) => trimmed.toLowerCase().startsWith(prefix))) {
    return AI_SESSION_BADGE_DISPLAY
  }
  if (trimmed.length <= GIT_GRAPH_BADGE_MAX_CHARS) {
    return trimmed
  }
  return `${trimmed.slice(0, GIT_GRAPH_BADGE_TRUNC_PREFIX_CHARS)}${GIT_GRAPH_BADGE_ELLIPSIS}`
}
