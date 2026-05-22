import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CommitGraph,
  type CommitGraphStyle as GraphStyle,
} from '../vendors/commitGraphVendor';
import type { GitLogEntry } from '../types/git';
import type { GitLogFileGraphContext } from '../utils/gitTabGraphBranchColors';
import {
  buildCommitGraphImportData,
  GRUVBOX_BRANCH_PALETTE,
} from '../utils/gitGraphUtils';
import {
  commitGraphDotCenterY,
  commitRowRelativeLabel,
  getCommitNodesSortedByGraphRow,
} from '../utils/commitGraphLayoutCompat';
import { parseGitDecorationRefs } from '../utils/gitDecorationParse';
import { allocateWindowLanes } from '../utils/windowLaneAllocator';
import { useWindowViewportState } from '../utils/windowViewportState';
import { HistoryGraphSvg } from './HistoryGraphSvg';

export interface CommitGraphRendererProps {
  commits: GitLogEntry[];
  graphContext: GitLogFileGraphContext | null;
  selectedHashes: string[];
  onCommitActivate: (hash: string) => void;
  setGitHistoryGraphError: (msg: string) => void;
}

/**
 * Slightly larger than commit-graph’s defaults, but compact enough to better
 * match the tightened legacy graph geometry.
 * Must stay in sync with {@link commitGraphDotCenterY} via `graphStyle`.
 */
const COMMIT_GRAPH_LAYOUT_SCALE = 1.2;
const GIT_HISTORY_WINDOW_LANE_REUSE = true;
const DEFAULT_STYLE: GraphStyle = {
  commitSpacing: Math.round(30 * COMMIT_GRAPH_LAYOUT_SCALE),
  branchSpacing: Math.round(15 * COMMIT_GRAPH_LAYOUT_SCALE),
  nodeRadius: Math.max(2, Math.round(2.5 * COMMIT_GRAPH_LAYOUT_SCALE)),
  branchColors: [...GRUVBOX_BRANCH_PALETTE],
};
const COMMIT_HOVER_CARD_OFFSET_Y = 6;
const COMMIT_HOVER_CARD_FALLBACK_HEIGHT_PX = 224; // keep in sync with .git-commit-graph-cell__text max-height (14rem)
type GraphRendererAdapter = 'legacy' | 'windowed';

function branchNamesFromDecorations(raw: string): string[] {
  return parseGitDecorationRefs(raw).filter((ref) => {
    const t = ref.trim();
    if (t === '' || t === 'HEAD') {
      return false;
    }
    if (t.startsWith('tag: ')) {
      return false;
    }
    return true;
  });
}

/** Prefix commit cell copy with a left-side dash. */
function withLeftDash(text: string): string {
  const t = text.trim();
  return t === '' ? '-' : `- ${t}`;
}

function dateFormatFn(dateLike: string | number | Date): string {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const CommitGraphRenderer: React.FC<CommitGraphRendererProps> = ({
  commits,
  graphContext,
  selectedHashes,
  onCommitActivate,
  setGitHistoryGraphError,
}) => {
  const graphData = useMemo(
    () =>
      buildCommitGraphImportData(commits, {
        graphEdgeConnectivity: graphContext?.graphEdgeConnectivity,
      }),
    [commits, graphContext?.graphEdgeConnectivity],
  );

  const hoverMetaByHash = useMemo(() => {
    const m = new Map<string, { branchesLine: string; message: string }>();
    for (const e of commits) {
      const branches = branchNamesFromDecorations(e.decorations ?? '');
      const branchesLine =
        branches.length > 0 ? branches.join(', ') : '—';
      const subj =
        e.subject.trim() === '' ? '(no commit message)' : e.subject.trim();
      const body = (e.body ?? '').trim();
      const message = body !== '' ? `${subj}\n\n${body}` : subj;
      m.set(e.hash, { branchesLine, message });
    }
    return m;
  }, [commits]);

  const graphStyle: GraphStyle = useMemo(() => {
    const branchColors = graphContext?.templateBranchColors;
    return {
      ...DEFAULT_STYLE,
      branchColors:
        branchColors !== undefined && branchColors.length > 0
          ? [...branchColors]
          : [...GRUVBOX_BRANCH_PALETTE],
    };
  }, [graphContext?.templateBranchColors]);

  const adapter: GraphRendererAdapter = GIT_HISTORY_WINDOW_LANE_REUSE
    ? 'windowed'
    : 'legacy';
  const [windowEngineHealthy, setWindowEngineHealthy] = useState(true);

  const viewportRange = useWindowViewportState(
    graphStyle.commitSpacing,
    graphData.commits.length,
  );

  const laneCacheRef = useRef<Map<string, ReturnType<typeof allocateWindowLanes>>>(
    new Map(),
  );
  const windowLaneAllocation = useMemo(() => {
    if (!windowEngineHealthy || adapter !== 'windowed') {
      return null;
    }
    const key = `${viewportRange.overscanStartRow}:${viewportRange.overscanEndRow}:${
      graphData.commits.length
    }:${graphContext?.graphEdgeConnectivity ?? ''}`;
    const cached = laneCacheRef.current.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const next = allocateWindowLanes({
      commits: graphData.commits,
      startRow: viewportRange.overscanStartRow,
      endRow: viewportRange.overscanEndRow,
    });
    laneCacheRef.current.set(key, next);
    if (laneCacheRef.current.size > 12) {
      const oldest = laneCacheRef.current.keys().next().value;
      if (oldest !== undefined) {
        laneCacheRef.current.delete(oldest);
      }
    }
    return next;
  }, [
    windowEngineHealthy,
    adapter,
    viewportRange.overscanStartRow,
    viewportRange.overscanEndRow,
    graphData.commits,
    graphContext?.graphEdgeConnectivity,
  ]);
  useEffect(() => {
    if (adapter !== 'windowed') return;
    if (windowLaneAllocation !== null) return;
    setWindowEngineHealthy(false);
    setGitHistoryGraphError('Fell back to legacy graph renderer.');
  }, [adapter, windowLaneAllocation, setGitHistoryGraphError]);

  const legacyRows = useMemo(
    () => getCommitNodesSortedByGraphRow(graphData.commits),
    [graphData.commits],
  );
  const sortedRows = useMemo(() => {
    if (adapter === 'legacy') {
      return legacyRows;
    }
    const fallback = graphData.commits.map((c, i) => ({
      hash: c.sha,
      y: i,
      x: 0,
      children: [],
      parents: [],
      committer: '',
      commitDate: new Date(0),
      commitColor: '',
    }));
    if (windowLaneAllocation === null || windowLaneAllocation.rows.length === 0) {
      return fallback;
    }
    const laneByHash = windowLaneAllocation.laneIndexByHash;
    return graphData.commits.map((c, i) => ({
      hash: c.sha,
      y: i,
      x: laneByHash.get(c.sha) ?? 0,
      children: [],
      parents: [],
      committer: '',
      commitDate: new Date(0),
      commitColor: '',
    }));
  }, [adapter, legacyRows, graphData.commits, windowLaneAllocation]);

  const selectedSet = useMemo(
    () => new Set(selectedHashes.map((h) => h.trim()).filter(Boolean)),
    [selectedHashes],
  );

  const pickHoverHashFromLocalY = useCallback(
    (localY: number): string | null => {
      if (sortedRows.length === 0) {
        return null;
      }
      const { commitSpacing, nodeRadius } = graphStyle;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < sortedRows.length; i++) {
        const row = sortedRows[i];
        const cy = commitGraphDotCenterY(commitSpacing, nodeRadius, row.y);
        const d = Math.abs(localY - cy);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      return sortedRows[bestIdx]?.hash ?? null;
    },
    [sortedRows, graphStyle],
  );

  const handleCommitNodeClick = useCallback(
    (hash: string) => {
      onCommitActivate(hash);
    },
    [onCommitActivate],
  );

  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [hoverCardHeight, setHoverCardHeight] = useState<number>(
    COMMIT_HOVER_CARD_FALLBACK_HEIGHT_PX,
  );
  const hoverCardRef = useRef<HTMLDivElement | null>(null);

  const commitSpacing = graphStyle.commitSpacing;
  const baseLayerHeightPx = sortedRows.length * commitSpacing;
  const hoveredRow = useMemo(
    () =>
      hoveredHash === null
        ? null
        : sortedRows.find((row) => row.hash === hoveredHash) ?? null,
    [hoveredHash, sortedRows],
  );
  const hoveredMeta = useMemo(
    () =>
      hoveredHash === null ? undefined : hoverMetaByHash.get(hoveredHash),
    [hoverMetaByHash, hoveredHash],
  );
  const hoveredCardTop = useMemo(() => {
    if (hoveredRow === null) {
      return COMMIT_HOVER_CARD_OFFSET_Y;
    }
    return hoveredRow.y * commitSpacing + commitSpacing + COMMIT_HOVER_CARD_OFFSET_Y;
  }, [hoveredRow, commitSpacing]);
  const layerBottomOverflowPx = useMemo(() => {
    if (hoveredRow === null || hoveredMeta === undefined) {
      return 0;
    }
    return Math.max(
      0,
      hoveredCardTop + hoverCardHeight + COMMIT_HOVER_CARD_OFFSET_Y - baseLayerHeightPx,
    );
  }, [
    hoveredRow,
    hoveredMeta,
    hoveredCardTop,
    hoverCardHeight,
    baseLayerHeightPx,
  ]);
  const layerHeightPx = baseLayerHeightPx + layerBottomOverflowPx;

  useEffect(() => {
    setGitHistoryGraphError('');
  }, [setGitHistoryGraphError, commits.length]);

  const commitListKey = useMemo(
    () => commits.map((c) => c.hash).join('\n'),
    [commits],
  );

  useEffect(() => {
    setHoveredHash(null);
  }, [commitListKey]);

  useEffect(() => {
    if (hoveredHash === null) {
      setHoverCardHeight(COMMIT_HOVER_CARD_FALLBACK_HEIGHT_PX);
      return;
    }
    const el = hoverCardRef.current;
    if (el === null) {
      return;
    }
    const measured = Math.ceil(el.getBoundingClientRect().height);
    if (measured > 0 && measured !== hoverCardHeight) {
      setHoverCardHeight(measured);
    }
  }, [hoveredHash, hoveredMeta, hoverCardHeight]);

  if (commits.length === 0) {
    return null;
  }

  return (
    <div
      className="git-version-graph-host git-version-graph-host--commit-graph"
      style={{ minHeight: layerHeightPx }}
    >
      {adapter === 'legacy' || !windowEngineHealthy || windowLaneAllocation === null ? (
        <CommitGraph
          commits={graphData.commits}
          branchHeads={graphData.branchHeads}
          graphStyle={graphStyle}
          currentBranch={graphData.currentBranch}
          onCommitClick={(commitNode) => {
            handleCommitNodeClick(commitNode.hash);
          }}
          fullSha={selectedHashes.length > 0}
          dateFormatFn={dateFormatFn}
        />
      ) : (
        <HistoryGraphSvg
          rows={windowLaneAllocation.rows}
          edges={windowLaneAllocation.edges}
          branchColors={graphStyle.branchColors}
          commitSpacing={graphStyle.commitSpacing}
          branchSpacing={graphStyle.branchSpacing}
          nodeRadius={graphStyle.nodeRadius}
        />
      )}
      <div
        className="git-commit-graph-cell-layer"
        style={{ minHeight: layerHeightPx }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const localY = e.clientY - r.top;
          const next = pickHoverHashFromLocalY(localY);
          if (next !== null) {
            setHoveredHash(next);
          }
        }}
        onMouseLeave={() => setHoveredHash(null)}
      >
        {sortedRows.map((row) => {
          const showText = hoveredHash === row.hash;
          const isSelected = selectedSet.has(row.hash);
          const stripClass = [
            'git-commit-graph-cell-strip',
            showText ? 'git-commit-graph-cell-strip--hover' : '',
            isSelected ? 'git-commit-graph-cell-strip--selected' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const relLabel = commitRowRelativeLabel(row.y);
          return (
            <div
              key={row.hash}
              className="git-commit-graph-cell-outer"
              style={{
                top: row.y * commitSpacing,
                zIndex: showText ? 5 : 1,
              }}
            >
              <span
                className="git-commit-graph-cell__rel"
                aria-hidden
                style={{ top: `${Math.round(commitSpacing / 2)}px` }}
              >
                {withLeftDash(relLabel)}
              </span>
              <button
                type="button"
                className={stripClass}
                style={{ minHeight: commitSpacing }}
                onClick={() => handleCommitNodeClick(row.hash)}
                aria-label={`${relLabel}: select commit for diff`}
              />
            </div>
          );
        })}
        {hoveredRow !== null && hoveredMeta !== undefined ? (
          <div
            ref={hoverCardRef}
            className="git-commit-graph-cell__text"
            style={{
              top: hoveredCardTop,
            }}
          >
            <div className="git-commit-graph-cell__branch">
              {hoveredMeta.branchesLine}
            </div>
            <div className="git-commit-graph-cell__msg">
              {hoveredMeta.message}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
