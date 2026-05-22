/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Gruvbox heatmap stops + branch palette (heatmap-gradient + name → color)
 * CVM-Role:        Git tab graph — pure helpers (safe for Node tests, no DOM)
 *
 * END HEADER
 */

/**
 * Heatmap stops aligned with `default.css` (`--heatmap-00` … `--heatmap-10`).
 * Index `i` matches `--heatmap-${i.padStart(2,'0')}`.
 */
export const GRUVBOX_HEATMAP_STOPS: string[] = [
  'var(--heatmap-00)',
  'var(--heatmap-01)',
  'var(--heatmap-02)',
  'var(--heatmap-03)',
  'var(--heatmap-04)',
  'var(--heatmap-05)',
  'var(--heatmap-06)',
  'var(--heatmap-07)',
  'var(--heatmap-08)',
  'var(--heatmap-09)',
  'var(--heatmap-10)',
]

/** CSS token for one heatmap stop (theme-aware if `default.css` overrides `--heatmap-*`). */
export function gruvboxHeatmapCssVar (heatmapIndex: number): string {
  const i = Math.max(0, Math.min(GRUVBOX_HEATMAP_STOPS.length - 1, Math.floor(heatmapIndex)))
  return `var(--heatmap-${i.toString().padStart(2, '0')})`
}

/**
 * Walk `0..10` with stride **3** (mod 11): every consecutive branch slot jumps along the ramp so
 * neighbors are not cream–cream or other adjacent heat indices, while still covering the full gradient once.
 *
 * Sequence: 0 → 3 → 6 → 9 → 1 → 4 → 7 → 10 → 2 → 5 → 8
 */
export const GRUVBOX_BRANCH_PALETTE_HEAT_INDICES: readonly number[] = [
  0, 3, 6, 9, 1, 4, 7, 10, 2, 5, 8,
] as const

/**
 * Eleven colors for `commit-graph` branch stroke palette and {@link paletteColorForBranchName}: each slot is
 * one step on the heatmap ramp, ordered so **consecutive indices** stay visually distinct.
 */
export const GRUVBOX_BRANCH_PALETTE: readonly string[] = GRUVBOX_BRANCH_PALETTE_HEAT_INDICES.map(
  (hi) => gruvboxHeatmapCssVar(hi),
) as unknown as readonly string[]

/** Middle of the ramp when indexing fails. */
export const GRUVBOX_GRAPH_FALLBACK_STROKE = gruvboxHeatmapCssVar(2)

/** FNV-1a 32-bit — stable, fast branch name → palette index. */
export function paletteIndexForBranchName (branchName: string, paletteLength: number): number {
  if (paletteLength <= 0) {
    return 0
  }
  const s = branchName.trim() !== '' ? branchName.trim() : 'HEAD'
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % paletteLength
}

export function paletteColorForBranchName (
  branchName: string,
  palette: readonly string[] = GRUVBOX_BRANCH_PALETTE,
): string {
  const i = paletteIndexForBranchName(branchName, palette.length)
  return palette[i] ?? GRUVBOX_GRAPH_FALLBACK_STROKE
}
