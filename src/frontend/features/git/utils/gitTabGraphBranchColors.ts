/**
 * @ignore
 * Maps branch **names** → colors using {@link paletteColorForBranchName} so the branch picker,
 * diff badges, and commit dots stay aligned: same name always maps to the same palette slot
 * (FNV-1a of the name), not “first time seen” along the log walk.
 *
 * Display branch for a commit (merges) uses a deterministic ref order: local refs before
 * `origin/…`, then `localeCompare`.
 */

import type { GitLogEntry } from '../types/git';
import { parseGitDecorationRefs } from './gitDecorationParse';

import {
  type GraphEdgeConnectivity,
  buildCommitGraphModel,
  DEFAULT_GRAPH_EDGE_CONNECTIVITY,
  importParentHashesForGitgraph,
} from './gitTabGraphModel';
import {
  GRUVBOX_BRANCH_PALETTE,
  GRUVBOX_GRAPH_FALLBACK_STROKE,
  paletteColorForBranchName,
} from './gitTabGraphHeatmapColors';

export type { GraphEdgeConnectivity } from './gitTabGraphModel';
export { DEFAULT_GRAPH_EDGE_CONNECTIVITY } from './gitTabGraphModel';

const TAG_PREFIX = 'tag: ';

/**
 * Mirrors the legacy gitgraph empty-string sentinel for deleted branches (`Branch.DELETED_BRANCH_NAME`; the empty string used
 * internally by the library to mark removed branches). We replicate it here so callers never
 * depend on a private export of that package.
 */
const DELETED_BRANCH_NAME = '';

/**
 * When every import row has empty `refs` (typical for `git log -- file` without `%D`),
 * The graph import path needs a single synthetic ref so layout works. Not a real branch; stable color
 * via {@link paletteColorForBranchName}.
 */
export const GITGRAPH_SYNTHETIC_SINGLE_BRANCH_REF = 'history';

interface ChronRow {
  hash: string
  parents: string[]
  refs: string[]
}

/**
 * Graph `import()` assigns every commit to a branch derived from `refs`. If every row has
 * empty `refs` (common for `git log -- file` without decorations), the layout can fail or render
 * nothing; a single synthetic ref on the newest row fixes that.
 */
export function ensureBranchRefsForGitgraphImport (
  rows: Record<string, unknown>[],
): void {
  if (rows.length === 0) {
    return
  }
  const allEmpty = rows.every(
    (r) => Array.isArray(r.refs) && (r.refs as unknown[]).length === 0,
  )
  if (!allEmpty) {
    return
  }
  const head = rows[0] as { refs: string[] }
  head.refs = [GITGRAPH_SYNTHETIC_SINGLE_BRANCH_REF]
}

function buildChronologicalRows (
  entriesNewestFirst: GitLogEntry[],
  graphEdgeConnectivity: GraphEdgeConnectivity = DEFAULT_GRAPH_EDGE_CONNECTIVITY,
): ChronRow[] {
  const model = buildCommitGraphModel(entriesNewestFirst, graphEdgeConnectivity)
  const rowsNewest: ChronRow[] = entriesNewestFirst.map((entry) => {
    const vertex = model.vertices.get(entry.hash)
    const parents =
      vertex !== undefined ? importParentHashesForGitgraph(vertex) : []
    const refs = parseGitDecorationRefs(entry.decorations ?? '')
    return { hash: entry.hash, parents, refs }
  })
  ensureBranchRefsForGitgraphImport(rowsNewest as unknown as Record<string, unknown>[])
  return rowsNewest.slice().reverse()
}

/**
 * Same ordering as legacy `GitgraphCore.prototype.getBranches`: for each ref
 * (excluding HEAD), walk first-parent chain and attach that ref name to each commit on the path.
 */
function getBranchesMapFromRefs (
  chron: ChronRow[],
  commitPerName: Map<string, string>,
): Map<string, Set<string>> {
  const commitsByHash = new Map(chron.map((c) => [c.hash, c]))
  const result = new Map<string, Set<string>>()
  const branchNames = Array.from(commitPerName.keys()).filter((n) => n !== 'HEAD')

  for (const branch of branchNames) {
    const commitHash = commitPerName.get(branch)
    if (commitHash === undefined) {
      continue
    }
    const visited = new Set<string>()
    const queue = [commitHash]
    while (queue.length > 0) {
      const currentHash = queue.pop() as string
      if (visited.has(currentHash)) {
        continue
      }
      visited.add(currentHash)
      const current = commitsByHash.get(currentHash)
      const prevBranches = result.get(currentHash) ?? new Set<string>()
      prevBranches.add(branch)
      result.set(currentHash, prevBranches)
      if (current !== undefined && current.parents.length > 0) {
        queue.push(current.parents[0])
      }
    }
  }
  return result
}

/**
 * Same as the IIFE in `GitgraphCore.prototype.computeRenderedCommits` for merge reachability.
 */
function computeReachableUnassociatedCommits (
  chron: ChronRow[],
  branches: Map<string, Set<string>>,
): Set<string> {
  const commitsByHash = new Map(chron.map((c) => [c.hash, c]))
  const unassociatedCommits = new Set(
    chron.filter((c) => !branches.has(c.hash)).map((c) => c.hash),
  )
  const tipsOfMergedBranches: ChronRow[] = []
  for (const commit of chron) {
    if (commit.parents.length > 1) {
      for (const parentHash of commit.parents.slice(1)) {
        const p = commitsByHash.get(parentHash)
        if (p !== undefined) {
          tipsOfMergedBranches.push(p)
        }
      }
    }
  }
  const reachableCommits = new Set<string>()
  for (const tip of tipsOfMergedBranches) {
    const seen = new Set<string>()
    let current: ChronRow | undefined = tip
    while (current !== undefined && unassociatedCommits.has(current.hash)) {
      if (seen.has(current.hash)) {
        break
      }
      seen.add(current.hash)
      reachableCommits.add(current.hash)
      const nextHash: string | undefined = current.parents[0]
      current =
        nextHash !== undefined ? commitsByHash.get(nextHash) : undefined
    }
  }
  return reachableCommits
}

/**
 * Prefer `master` / `origin/master` when a commit carries multiple refs so the graph and
 * badges default to the master line (then non-`origin/` before `origin/…`, `localeCompare`, empty last).
 */
function masterRefSortTier (ref: string): number {
  const t = ref.trim().toLowerCase()
  if (t === 'master') {
    return 0
  }
  if (t === 'origin/master') {
    return 1
  }
  return 2
}

/**
 * Total order for branch/ref names: `master` first, then `origin/master`, then non-`origin/` before
 * `origin/…`, then `localeCompare`, empty last (matches legacy deleted-branch placeholder).
 * Used for display picks, badge lists, and `compareBranchesOrder` on the Git tab graph.
 */
export function compareGitgraphBranchNames (a: string, b: string): number {
  const aEmpty = a === '' ? 1 : 0
  const bEmpty = b === '' ? 1 : 0
  if (aEmpty !== bEmpty) {
    return aEmpty - bEmpty
  }
  const ma = masterRefSortTier(a)
  const mb = masterRefSortTier(b)
  if (ma !== mb) {
    return ma - mb
  }
  const aRemote = a.startsWith('origin/') ? 1 : 0
  const bRemote = b.startsWith('origin/') ? 1 : 0
  if (aRemote !== bRemote) {
    return aRemote - bRemote
  }
  return a.localeCompare(b, undefined, { sensitivity: 'accent' })
}

/**
 * Diff badge order: deterministic, but without hard-prioritizing master.
 * Prefer local before remote, then lexical.
 */
export function compareDiffBadgeBranchNames (a: string, b: string): number {
  const aa = a.trim()
  const bb = b.trim()
  const aEmpty = aa === '' ? 1 : 0
  const bEmpty = bb === '' ? 1 : 0
  if (aEmpty !== bEmpty) {
    return aEmpty - bEmpty
  }
  const aRemote = aa.startsWith('origin/') ? 1 : 0
  const bRemote = bb.startsWith('origin/') ? 1 : 0
  if (aRemote !== bRemote) {
    return aRemote - bRemote
  }
  return aa.localeCompare(bb, undefined, { sensitivity: 'accent' })
}

/** Picks one branch name from candidates; preferred wins when present. */
export function resolvePrimaryDiffBadgeBranch (
  candidates: readonly string[],
  preferredBranch?: string,
): string {
  const unique = Array.from(
    new Set(candidates.map((name) => name.trim()).filter((name) => name !== '')),
  )
  if (unique.length === 0) {
    return ''
  }
  const preferred = preferredBranch?.trim() ?? ''
  if (preferred !== '' && unique.includes(preferred)) {
    return preferred
  }
  const sorted = [...unique].sort(compareDiffBadgeBranchNames)
  return sorted[0] ?? ''
}

/**
 * Canonical diff badge branch resolver used by GitTab and DiffViewer.
 * Ensures both paths choose the same primary branch for each hash.
 * When both diff endpoints list the same branch name, that name is preferred for every row (if present
 * on that row) so paired versions read as one logical branch when possible.
 */
export function resolvePrimaryDiffBadgeBranchByHash (
  refsByHash: ReadonlyMap<string, string[]>,
  leftHash: string,
  rightHash: string,
): Map<string, string> {
  const lh = leftHash.trim()
  const rh = rightHash.trim()
  let preferred: string | undefined
  if (lh !== '' && rh !== '') {
    const leftNames = new Set(
      (refsByHash.get(lh) ?? [])
        .map((n) => n.trim())
        .filter((n) => n !== ''),
    )
    const rightNames = new Set(
      (refsByHash.get(rh) ?? [])
        .map((n) => n.trim())
        .filter((n) => n !== ''),
    )
    const shared = [...leftNames].filter((n) => rightNames.has(n))
    if (shared.length > 0) {
      preferred = resolvePrimaryDiffBadgeBranch(shared)
    }
  }
  const out = new Map<string, string>()
  for (const [hash, candidates] of refsByHash.entries()) {
    out.set(hash, resolvePrimaryDiffBadgeBranch(candidates, preferred))
  }
  return out
}

/** Stable `refs` order for graph import rows (aligns with branchToDisplay tie-break). */
export function sortGitgraphDecorationRefs (refs: string[]): string[] {
  return [...refs].sort(compareGitgraphBranchNames)
}

function parseCurrentBranchFromDecorations (raw: string): string | undefined {
  const match = raw.match(/(?:^|,\s*)HEAD\s*->\s*([^,]+)/)
  const branchName = match?.[1]?.trim()
  return branchName !== undefined && branchName !== '' ? branchName : undefined
}

function isGitBranchRefName (ref: string): boolean {
  const trimmed = ref.trim()
  if (trimmed === '' || trimmed === 'HEAD') {
    return false
  }
  if (trimmed.startsWith(TAG_PREFIX)) {
    return false
  }
  return true
}

function resolveCurrentBranchName (
  entriesNewestFirst: GitLogEntry[],
  commitPerName: ReadonlyMap<string, string>,
): string | undefined {
  const fromDecorations = entriesNewestFirst
    .map((entry) => parseCurrentBranchFromDecorations(entry.decorations ?? ''))
    .find((name) => name !== undefined)
  if (fromDecorations !== undefined) {
    return fromDecorations
  }
  for (const entry of entriesNewestFirst) {
    const refs = sortGitgraphDecorationRefs(
      parseGitDecorationRefs(entry.decorations ?? ''),
    )
    for (const ref of refs) {
      if (isGitBranchRefName(ref)) {
        return ref
      }
    }
  }
  return [...commitPerName.keys()]
    .filter((name) => isGitBranchRefName(name))
    .sort(compareGitgraphBranchNames)[0]
}

function branchToDisplay (
  hash: string,
  branches: Map<string, Set<string>>,
  preferredBranch?: string,
): string {
  const set = branches.get(hash)
  if (set === undefined || set.size === 0) {
    return DELETED_BRANCH_NAME
  }
  const preferred = preferredBranch?.trim() ?? ''
  if (preferred !== '' && set.has(preferred)) {
    return preferred
  }
  const sorted = Array.from(set).sort(compareGitgraphBranchNames)
  return sorted[0] ?? DELETED_BRANCH_NAME
}

/** One `buildChronologicalRows` pass + shared maps for template, import, picker, and diff badges. */
interface ChronGraphCore {
  chron: ChronRow[]
  commitPerName: Map<string, string>
  branches: Map<string, Set<string>>
  displayByHash: Map<string, string>
  currentBranch?: string
}

function buildChronGraphCore (
  entriesNewestFirst: GitLogEntry[],
  graphEdgeConnectivity: GraphEdgeConnectivity = DEFAULT_GRAPH_EDGE_CONNECTIVITY,
): ChronGraphCore | null {
  if (entriesNewestFirst.length === 0) {
    return null
  }
  const chron = buildChronologicalRows(entriesNewestFirst, graphEdgeConnectivity)
  const commitPerName = new Map<string, string>()
  for (const c of chron) {
    for (const ref of c.refs) {
      if (!ref.startsWith(TAG_PREFIX)) {
        commitPerName.set(ref, c.hash)
      }
    }
  }
  const currentBranch = resolveCurrentBranchName(entriesNewestFirst, commitPerName)
  const branches = getBranchesMapFromRefs(chron, commitPerName)
  const displayByHash = new Map<string, string>()
  for (const c of chron) {
    displayByHash.set(c.hash, branchToDisplay(c.hash, branches, currentBranch))
  }
  return { chron, commitPerName, branches, displayByHash, currentBranch }
}

function sortedUniqueDisplayBranchNames (
  entriesNewestFirst: GitLogEntry[],
  displayByHash: ReadonlyMap<string, string>,
): string[] {
  const unique = new Set<string>()
  for (const e of entriesNewestFirst) {
    unique.add(displayByHash.get(e.hash) ?? '')
  }
  return [...unique].sort(compareGitgraphBranchNames)
}

function badgeRefsMapFromCore (
  chron: ChronRow[],
  branches: Map<string, Set<string>>,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const c of chron) {
    const set = branches.get(c.hash)
    const list =
      set !== undefined && set.size > 0
        ? Array.from(set).sort(compareGitgraphBranchNames)
        : []
    out.set(c.hash, list)
  }
  return out
}

function branchColorByNameFromCore (
  entriesNewestFirst: GitLogEntry[],
  core: ChronGraphCore,
  palette: readonly string[],
): Map<string, string> {
  const { chron, commitPerName, branches } = core
  const reachable = computeReachableUnassociatedCommits(chron, branches)
  const commitsToRender = chron.filter(
    (c) => branches.has(c.hash) || reachable.has(c.hash),
  )
  const names = new Set<string>()
  for (const c of commitsToRender) {
    const d = branchToDisplay(c.hash, branches, core.currentBranch)
    if (d !== '') {
      names.add(d)
    }
  }
  for (const name of commitPerName.keys()) {
    if (name !== 'HEAD' && !name.startsWith(TAG_PREFIX)) {
      names.add(name)
    }
  }
  for (const e of entriesNewestFirst) {
    for (const r of parseGitDecorationRefs(e.decorations ?? '')) {
      const t = r.trim()
      if (t.toLowerCase().startsWith(TAG_PREFIX)) {
        names.add(t)
      }
    }
  }
  const out = new Map<string, string>()
  for (const name of names) {
    out.set(name, paletteColorForBranchName(name, palette))
  }
  return out
}

/**
 * Cached graph analysis for a file/repo log slice: Metro template signature + lane colors, display
 * branch per hash, picker color map, and diff-badge ref lists — from a single chronological build.
 */
export interface BuildGitLogFileGraphContextOptions {
  /** Must match {@link buildGitgraphImportRows} / mount when overriding defaults. */
  graphEdgeConnectivity?: GraphEdgeConnectivity
}

export interface GitLogFileGraphContext {
  templateSignature: string
  templateBranchColors: string[]
  displayByHash: ReadonlyMap<string, string>
  branchColorByNameMap: ReadonlyMap<string, string>
  badgeRefsByHash: ReadonlyMap<string, string[]>
  /** Resolved connectivity used for chron + import; pass to {@link syncGitHistoryGraphMount}. */
  graphEdgeConnectivity: GraphEdgeConnectivity
}

export function buildGitLogFileGraphContext (
  entriesNewestFirst: GitLogEntry[],
  palette: readonly string[] = GRUVBOX_BRANCH_PALETTE,
  contextOptions?: BuildGitLogFileGraphContextOptions,
): GitLogFileGraphContext | null {
  const connectivity =
    contextOptions?.graphEdgeConnectivity ?? DEFAULT_GRAPH_EDGE_CONNECTIVITY
  const core = buildChronGraphCore(entriesNewestFirst, connectivity)
  if (core === null) {
    return null
  }
  if (palette.length === 0) {
    const sortedNames = sortedUniqueDisplayBranchNames(
      entriesNewestFirst,
      core.displayByHash,
    )
    return {
      templateSignature: sortedNames.join('\0'),
      templateBranchColors: sortedNames.map(() => GRUVBOX_GRAPH_FALLBACK_STROKE),
      displayByHash: core.displayByHash,
      branchColorByNameMap: new Map(),
      badgeRefsByHash: badgeRefsMapFromCore(core.chron, core.branches),
      graphEdgeConnectivity: connectivity,
    }
  }
  const sortedNames = sortedUniqueDisplayBranchNames(
    entriesNewestFirst,
    core.displayByHash,
  )
  return {
    templateSignature: sortedNames.join('\0'),
    templateBranchColors: sortedNames.map((n) =>
      n === ''
        ? GRUVBOX_GRAPH_FALLBACK_STROKE
        : paletteColorForBranchName(n, palette),
    ),
    displayByHash: core.displayByHash,
    branchColorByNameMap: branchColorByNameFromCore(
      entriesNewestFirst,
      core,
      palette,
    ),
    badgeRefsByHash: badgeRefsMapFromCore(core.chron, core.branches),
    graphEdgeConnectivity: connectivity,
  }
}

/**
 * Stable display ref per commit hash (matches {@link buildGitgraphImportRows} after synthetic refs).
 */
export function commitDisplayBranchByHash (
  entriesNewestFirst: GitLogEntry[],
  contextOptions?: BuildGitLogFileGraphContextOptions,
): ReadonlyMap<string, string> {
  const connectivity =
    contextOptions?.graphEdgeConnectivity ?? DEFAULT_GRAPH_EDGE_CONNECTIVITY
  return buildChronGraphCore(entriesNewestFirst, connectivity)?.displayByHash ??
    new Map()
}

/**
 * For each commit in the file/repo log, branch ref names assigned by the same first-parent
 * walk as the graph import (see {@link getBranchesMapFromRefs}). Used to badge diff version rows
 * when `git log %D` has no tip decoration on that commit.
 */
export function branchBadgeRefsByHashFromLog (
  entriesNewestFirst: GitLogEntry[],
  contextOptions?: BuildGitLogFileGraphContextOptions,
): Map<string, string[]> {
  const connectivity =
    contextOptions?.graphEdgeConnectivity ?? DEFAULT_GRAPH_EDGE_CONNECTIVITY
  const core = buildChronGraphCore(entriesNewestFirst, connectivity)
  if (core === null) {
    return new Map()
  }
  return badgeRefsMapFromCore(core.chron, core.branches)
}

/**
 * Union for diff badges: Git `%D` names first, then graph-walk refs (no duplicates).
 */
export function mergeBranchDecorationAndGraphRefs (
  fromDecorations: string[],
  fromGraphWalk: string[],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of fromDecorations) {
    if (!seen.has(r)) {
      seen.add(r)
      out.push(r)
    }
  }
  for (const r of fromGraphWalk) {
    if (!seen.has(r)) {
      seen.add(r)
      out.push(r)
    }
  }
  return out
}

/**
 * Branch name → stroke color for the branch picker and commit-graph dots when `style.dot.color` is set.
 */
export function buildGitgraphBranchColorByNameMap (
  entriesNewestFirst: GitLogEntry[],
  palette: readonly string[] = GRUVBOX_BRANCH_PALETTE,
  contextOptions?: BuildGitLogFileGraphContextOptions,
): ReadonlyMap<string, string> {
  if (entriesNewestFirst.length === 0 || palette.length === 0) {
    return new Map()
  }
  const connectivity =
    contextOptions?.graphEdgeConnectivity ?? DEFAULT_GRAPH_EDGE_CONNECTIVITY
  const core = buildChronGraphCore(entriesNewestFirst, connectivity)
  if (core === null) {
    return new Map()
  }
  return branchColorByNameFromCore(entriesNewestFirst, core, palette)
}

/**
 * Stable signature for when the graph component must be recreated: lane color template follows
 * sorted `branchToDisplay` names; changing this set requires a new graph instance.
 * `palette` must match {@link buildGitLogFileGraphContext} / {@link buildGitgraphTemplateBranchColors}
 * for the same log or signatures and rail colors can disagree.
 */
export function gitGraphBranchTemplateSignature (
  entriesNewestFirst: GitLogEntry[],
  contextOptions?: BuildGitLogFileGraphContextOptions,
): string
export function gitGraphBranchTemplateSignature (
  entriesNewestFirst: GitLogEntry[],
  palette: readonly string[],
  contextOptions?: BuildGitLogFileGraphContextOptions,
): string
export function gitGraphBranchTemplateSignature (
  entriesNewestFirst: GitLogEntry[],
  paletteOrContextOptions?:
    | readonly string[]
    | BuildGitLogFileGraphContextOptions,
  contextOptions?: BuildGitLogFileGraphContextOptions,
): string {
  let palette: readonly string[] = GRUVBOX_BRANCH_PALETTE
  let opts: BuildGitLogFileGraphContextOptions | undefined = contextOptions
  if (paletteOrContextOptions != null) {
    if (Array.isArray(paletteOrContextOptions)) {
      palette = paletteOrContextOptions
    } else {
      palette = GRUVBOX_BRANCH_PALETTE
      opts = paletteOrContextOptions as BuildGitLogFileGraphContextOptions
    }
  }
  return (
    buildGitLogFileGraphContext(entriesNewestFirst, palette, opts)
      ?.templateSignature ?? ''
  )
}

/**
 * Metro `template.colors` aligned with {@link compareGitgraphBranchNames} branch order so
 * branch **rails** use the same FNV palette slot as dots and the sidebar branch picker.
 */
export function buildGitgraphTemplateBranchColors (
  entriesNewestFirst: GitLogEntry[],
  palette: readonly string[] = GRUVBOX_BRANCH_PALETTE,
  contextOptions?: BuildGitLogFileGraphContextOptions,
): string[] {
  if (entriesNewestFirst.length === 0) {
    return [...palette]
  }
  return (
    buildGitLogFileGraphContext(entriesNewestFirst, palette, contextOptions)
      ?.templateBranchColors ?? [...palette]
  )
}
