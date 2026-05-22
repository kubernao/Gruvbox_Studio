/**
 * Hub → Bézier branch picker geometry (archive `GitBranchPickerGraph.vue` script).
 */

import type { GitBranchListRow } from '../types/git';
import { isNonDeletableLocalBranchName } from './gitGraphUtils';
import { paletteColorForBranchName } from './gitTabGraphHeatmapColors';
import { truncateGitgraphBadgeLabel } from './gitGraphBadgeLabel';
import {
  GIT_TAB_GRAPH_BRANCH_LABEL_PX,
  GIT_TAB_GRAPH_BRANCH_LABEL_RADIUS,
  GIT_TAB_GRAPH_BRANCH_LINE_WIDTH,
  GIT_TAB_GRAPH_BRANCH_PICKER_SCALE,
  GIT_TAB_GRAPH_BRANCH_SPACING,
  GIT_TAB_GRAPH_COMMIT_SPACING,
  GIT_TAB_GRAPH_DOT_RADIUS,
} from './gitTabGraphLayout';

const GIT_TAB_GRAPH_DOT_THEME_RING = 'var(--text-muted)';

const PICKER_DOT_R = GIT_TAB_GRAPH_DOT_RADIUS;
const EDGE_STROKE = GIT_TAB_GRAPH_BRANCH_LINE_WIDTH;

function pickerBranchDotIdFingerprint(branchName: string, rowIndex: number): string {
  let h = 2166136261;
  const payload = `${branchName}\0${rowIndex}`;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function branchDotCircleId(role: string, branchName: string, rowIndex: number): string {
  return `gbg-${role}-${pickerBranchDotIdFingerprint(branchName, rowIndex)}`;
}

export function branchStemFadeUpGradientId(branchName: string, rowIndex: number): string {
  return `gbg-stem-fade-up-${pickerBranchDotIdFingerprint(branchName, rowIndex)}`;
}

export function branchHubLeftFadeGradientId(branchName: string, rowIndex: number): string {
  return `gbg-hub-left-fade-${pickerBranchDotIdFingerprint(branchName, rowIndex)}`;
}

export function branchHubRightFadeGradientId(branchName: string, rowIndex: number): string {
  return `gbg-hub-right-fade-${pickerBranchDotIdFingerprint(branchName, rowIndex)}`;
}

export function stemFadeUpStrokeUrl(gradientId: string): string {
  return `url(#${gradientId})`;
}

const LABEL_FRAME_STROKE = 1.25;
const HIT_RX = 4;
const DELETE_ICON_SCALE = 0.88;
const DELETE_COLUMN_W = 48;
const DELETE_HIT_INSET_LEFT = 8;
const DELETE_HIT_W = DELETE_COLUMN_W - DELETE_HIT_INSET_LEFT;
const DELETE_HIT_H = 48;
const DELETE_VISUAL_RING_R = 20;
const DELETE_GAP_AFTER_LABEL = 2;
const HIT_SEP_BEFORE_DELETE = 4;
const MIN_LABEL_HIT_W = 1;

export function deleteIconTransform(cx: number, cy: number): string {
  return `translate(${cx}, ${cy}) scale(${DELETE_ICON_SCALE}) translate(-12, -12)`;
}

const HUB = { cx: PICKER_DOT_R, r: PICKER_DOT_R };
const ROW_H = GIT_TAB_GRAPH_COMMIT_SPACING;
const PAD_Y_TOP = 8;
const PAD_Y_BOTTOM = 4;
const INTERMEDIATE_COL_X = 96;
export const GIT_BRANCH_PICKER_LABEL_PAD_X =
  INTERMEDIATE_COL_X + GIT_TAB_GRAPH_BRANCH_SPACING;
const LABEL_PAD_X = GIT_BRANCH_PICKER_LABEL_PAD_X;
const VB_WIDTH_MIN = 272;
const INTERMEDIATE_AFTER_DELETE_GAP = 2;
const PAD_X_OUTER = 0;
const LABEL_DY = -11;
const LABEL_FRAME_PAD_X = 7;
const LABEL_FRAME_PAD_Y = 4;
const LABEL_FRAME_RX = GIT_TAB_GRAPH_BRANCH_LABEL_RADIUS;
const LABEL_CHAR_EW = 6.45;
const LABEL_FRAME_H = 19;
const BEZIER_PULL_X = 34;
const BEZIER_APPROACH_TO_NODE = 26;
const TERMINAL_PAD_AFTER_LABEL = 8;
const BRANCH_PICKER_VIEW_TOP_PAD = 48;
const CURRENT_BRANCH_UP_STEM_LEAD_X = 14;
const CURRENT_BRANCH_UP_BEND_PULL_X = 18;
const CURRENT_BRANCH_UP_BEND_TANGENT_Y = 10;
const CURRENT_BRANCH_UP_BEND_DROP = 22;
const CURRENT_BRANCH_UP_STEM_PX = 26;
const CURRENT_BRANCH_CAPTION_LOWER_OFFSET_PX = 6;
const CURRENT_BRANCH_CAPTION_FADE_HALF_PX = 10;
const CURRENT_BRANCH_STEM_FADE_MIN_LEN_PX = 18;
const CURRENT_BRANCH_STEM_FADE_JOIN_EPS = 0.75;
const CURRENT_BRANCH_CAPTION_TEXT_HALF_WIDTH = 52;
export const CURRENT_BRANCH_CAPTION_FONT =
  '600 10px var(--font-ui), system-ui, sans-serif';
const HIT_PAD_X = 6;
const LABEL_TOP_EXTRA = 12;

function truncateDisplay(name: string): string {
  return truncateGitgraphBadgeLabel(name);
}

function estimateBranchLabelTextWidth(displayName: string): number {
  return Math.max(20, Math.ceil(displayName.length * LABEL_CHAR_EW));
}

export interface StemGradientDef {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  stop0Opacity: number;
  stop100Opacity: number;
}

export interface BranchPickerLayoutRow {
  name: string;
  displayName: string;
  isCurrent: boolean;
  branchColor: string;
  railY: number;
  midX: number;
  terminalCx: number;
  pathD: string;
  pathLeftFromHub: string;
  pathMiddleRail: string;
  pathRightToHub: string;
  hubLeftFadeGradientId: string;
  hubRightFadeGradientId: string;
  hitX: number;
  hitY: number;
  hitW: number;
  hitH: number;
  deleteCx: number;
  deleteCy: number;
  deleteHitX: number;
  deleteHitY: number;
  deleteHitW: number;
  deleteHitH: number;
  labelFrameX: number;
  labelFrameY: number;
  labelFrameW: number;
  labelFrameH: number;
  labelFrameRx: number;
  intermediateCx: number;
  currentBranchCaptionX?: number;
  currentBranchCaptionMidY?: number;
  stemFadeSplit: boolean;
  pathStemLower: string;
  pathStemFade: string;
  pathStemUpper: string;
  pathStemFullVertical: string;
  stemUpperFadeGradientId: string;
  stemFullVerticalGradientId: string;
}

export interface BranchPickerLayoutResult {
  orderedBranches: GitBranchListRow[];
  graphInnerHeight: number;
  hubY: number;
  layoutRows: BranchPickerLayoutRow[];
  rightHubCx: number;
  vbWidth: number;
  hasOtherBranches: boolean;
  stemFadeGradients: StemGradientDef[];
  viewBox: string;
  branchPickerSvgStyle: Record<string, string>;
}

export function computeBranchPickerLayout(
  branches: GitBranchListRow[],
  branchColorByName: ReadonlyMap<string, string> | null | undefined,
): BranchPickerLayoutResult {
  const orderedBranches = [...branches].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) {
      return a.isCurrent ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const n = orderedBranches.length;
  const graphInnerHeight =
    n === 0 ? 0 : PAD_Y_TOP + n * ROW_H + PAD_Y_BOTTOM;
  const hubY = graphInnerHeight / 2;

  if (n === 0) {
    return {
      orderedBranches,
      graphInnerHeight: 0,
      hubY: 0,
      layoutRows: [],
      rightHubCx: 0,
      vbWidth: 1,
      hasOtherBranches: false,
      stemFadeGradients: [],
      viewBox: '0 0 1 1',
      branchPickerSvgStyle: {
        ['--git-branch-picker-scale' as string]: String(GIT_TAB_GRAPH_BRANCH_PICKER_SCALE),
      },
    };
  }

  const hubYVal = hubY;
  const x0 = HUB.cx + HUB.r;
  const c1x = x0 + BEZIER_PULL_X;
  const midX = INTERMEDIATE_COL_X;
  const c2x = midX - BEZIER_APPROACH_TO_NODE;

  const baseRows = orderedBranches.map((b, i) => {
    const branchColor =
      branchColorByName?.get(b.name) ?? paletteColorForBranchName(b.name);
    const railY = PAD_Y_TOP + i * ROW_H + ROW_H / 2;
    const labelTopApprox = railY + LABEL_DY - LABEL_TOP_EXTRA;
    const displayName = truncateDisplay(b.name);
    const textW = Math.ceil(estimateBranchLabelTextWidth(displayName));
    const labelFrameW = textW + 2 * LABEL_FRAME_PAD_X;
    const baselineY = railY + LABEL_DY;
    const labelFrameH = LABEL_FRAME_H;
    const labelPx = GIT_TAB_GRAPH_BRANCH_LABEL_PX;
    const ascenderPx = labelPx * 0.78;
    const labelFrameY = baselineY - (ascenderPx + LABEL_FRAME_PAD_Y);
    const labelFrameX = LABEL_PAD_X - LABEL_FRAME_PAD_X;

    return {
      name: b.name,
      displayName,
      isCurrent: b.isCurrent,
      branchColor,
      railY,
      midX,
      labelTopApprox,
      labelFrameX,
      labelFrameY,
      labelFrameW,
      labelFrameH,
      labelFrameRx: LABEL_FRAME_RX,
    };
  });

  const maxLabelRight = Math.max(
    LABEL_PAD_X,
    ...baseRows.map((r) => r.labelFrameX + r.labelFrameW),
  );
  const hasOtherBranches = baseRows.some((r) => !r.isCurrent);

  const deleteColumnRightEdge = (r: (typeof baseRows)[0]): number =>
    r.labelFrameX + r.labelFrameW + DELETE_GAP_AFTER_LABEL + DELETE_COLUMN_W;

  const nonCurrentRows = baseRows.filter((r) => !r.isCurrent);
  const maxDeleteRightEdge =
    nonCurrentRows.length === 0
      ? 0
      : Math.max(...nonCurrentRows.map(deleteColumnRightEdge));

  const intermediateCx =
    maxDeleteRightEdge + INTERMEDIATE_AFTER_DELETE_GAP + PICKER_DOT_R;

  const leftArm = midX - x0;
  const mergeChordMin = PICKER_DOT_R * 2 + 8;
  const mergeChord = Math.max(Math.round(leftArm * 0.38), mergeChordMin);

  let rightHubCx = 0;
  let rightEdgeX = 0;
  if (hasOtherBranches) {
    rightEdgeX = intermediateCx + mergeChord;
    rightHubCx = rightEdgeX + HUB.r;
  }

  let vbWidth = hasOtherBranches
    ? Math.max(VB_WIDTH_MIN, rightHubCx + HUB.r + PAD_X_OUTER)
    : Math.max(VB_WIDTH_MIN, maxLabelRight + 16);

  const stemFadeGradients: StemGradientDef[] = [];

  const layoutRows: BranchPickerLayoutRow[] = baseRows.map((r, rowIndex) => {
    const c1y = hubYVal;
    const c2y = r.railY;

    const terminalCxCurr =
      r.labelFrameX + r.labelFrameW + TERMINAL_PAD_AFTER_LABEL + PICKER_DOT_R;
    const xDotRight = terminalCxCurr + PICKER_DOT_R;
    const xStem = xDotRight + CURRENT_BRANCH_UP_STEM_LEAD_X;
    const pull = CURRENT_BRANCH_UP_BEND_PULL_X;
    const xUp = xStem + pull;
    const yRail = r.railY;
    const yBend = yRail - CURRENT_BRANCH_UP_BEND_DROP;
    const yStemEnd = yBend - CURRENT_BRANCH_UP_STEM_PX;
    const c2yUp = yBend + CURRENT_BRANCH_UP_BEND_TANGENT_Y;

    const pathLeftFromHub =
      `M ${x0} ${hubYVal} C ${c1x} ${c1y} ${c2x} ${c2y} ${r.midX} ${r.railY}`;
    const pathMiddleRail = `M ${r.midX} ${r.railY} L ${intermediateCx} ${r.railY}`;
    const pathRightToHub = hasOtherBranches
      ? `M ${intermediateCx} ${r.railY} L ${rightEdgeX} ${r.railY}`
      : '';

    const pathDCurrentAfterJunction =
      `M ${r.midX} ${yRail} L ${terminalCxCurr} ${yRail} ` +
      `L ${xDotRight} ${yRail} L ${xStem} ${yRail} ` +
      `C ${xUp} ${yRail} ${xUp} ${c2yUp} ${xUp} ${yBend}`;

    const hubLeftFadeGradientId = branchHubLeftFadeGradientId(r.name, rowIndex);
    stemFadeGradients.push({
      id: hubLeftFadeGradientId,
      x1: x0,
      y1: hubYVal,
      x2: r.midX,
      y2: r.railY,
      color: r.branchColor,
      stop0Opacity: 0,
      stop100Opacity: 1,
    });

    let hubRightFadeGradientId = '';
    if (pathRightToHub !== '') {
      hubRightFadeGradientId = branchHubRightFadeGradientId(r.name, rowIndex);
      stemFadeGradients.push({
        id: hubRightFadeGradientId,
        x1: intermediateCx,
        y1: r.railY,
        x2: rightEdgeX,
        y2: r.railY,
        color: r.branchColor,
        stop0Opacity: 1,
        stop100Opacity: 0,
      });
    }

    const stemLen = yBend - yStemEnd;
    const captionY =
      (yBend + yStemEnd) / 2 + CURRENT_BRANCH_CAPTION_LOWER_OFFSET_PX;

    let pathD = r.isCurrent ? pathDCurrentAfterJunction : '';
    let stemFadeSplit = false;
    let pathStemLower = '';
    let pathStemFade = '';
    let pathStemUpper = '';
    let pathStemFullVertical = '';
    let stemUpperFadeGradientId = '';
    let stemFullVerticalGradientId = '';

    if (r.isCurrent && stemLen >= CURRENT_BRANCH_STEM_FADE_MIN_LEN_PX) {
      const fadeLo = Math.min(
        yBend - CURRENT_BRANCH_STEM_FADE_JOIN_EPS,
        captionY + CURRENT_BRANCH_CAPTION_FADE_HALF_PX,
      );
      const fadeHi = Math.max(
        yStemEnd + CURRENT_BRANCH_STEM_FADE_JOIN_EPS,
        captionY - CURRENT_BRANCH_CAPTION_FADE_HALF_PX,
      );
      const minGap = CURRENT_BRANCH_STEM_FADE_JOIN_EPS * 4;
      if (fadeLo - fadeHi >= minGap) {
        stemFadeSplit = true;
        pathStemLower = `M ${xUp} ${yBend} L ${xUp} ${fadeLo}`;
        pathStemFade = `M ${xUp} ${fadeLo} L ${xUp} ${fadeHi}`;
        pathStemUpper = `M ${xUp} ${fadeHi} L ${xUp} ${yStemEnd}`;
        stemUpperFadeGradientId = branchStemFadeUpGradientId(r.name, rowIndex);
        stemFadeGradients.push({
          id: stemUpperFadeGradientId,
          x1: xUp,
          y1: fadeHi,
          x2: xUp,
          y2: yStemEnd,
          color: r.branchColor,
          stop0Opacity: 1,
          stop100Opacity: 0,
        });
      }
    }

    if (r.isCurrent && !stemFadeSplit) {
      pathStemFullVertical = `M ${xUp} ${yBend} L ${xUp} ${yStemEnd}`;
      stemFullVerticalGradientId = branchStemFadeUpGradientId(r.name, rowIndex);
      stemFadeGradients.push({
        id: stemFullVerticalGradientId,
        x1: xUp,
        y1: yBend,
        x2: xUp,
        y2: yStemEnd,
        color: r.branchColor,
        stop0Opacity: 1,
        stop100Opacity: 0,
      });
    }

    const terminalCx = r.isCurrent ? terminalCxCurr : 0;
    const currentBranchCaptionX = r.isCurrent ? xUp : undefined;
    const currentBranchCaptionMidY = r.isCurrent ? captionY : undefined;

    const deleteCy = r.labelFrameY + r.labelFrameH / 2;
    const hitX = LABEL_PAD_X - HIT_PAD_X;
    const labelRight = r.labelFrameX + r.labelFrameW;
    const deleteColumnLeft =
      r.isCurrent || isNonDeletableLocalBranchName(r.name)
        ? 0
        : labelRight + DELETE_GAP_AFTER_LABEL;
    const deleteCx =
      deleteColumnLeft === 0 ? 0 : deleteColumnLeft + DELETE_COLUMN_W / 2;
    const deleteHitX =
      deleteColumnLeft === 0 ? 0 : deleteColumnLeft + DELETE_HIT_INSET_LEFT;
    const deleteHitY = deleteCy - DELETE_HIT_H / 2;
    let hitW = Math.max(48, labelRight + 10 - hitX);
    if (deleteCx !== 0) {
      const maxHitRight = deleteHitX - HIT_SEP_BEFORE_DELETE;
      hitW = Math.min(hitW, Math.max(0, maxHitRight - hitX));
      hitW = Math.max(MIN_LABEL_HIT_W, hitW);
    }

    return {
      name: r.name,
      displayName: r.displayName,
      isCurrent: r.isCurrent,
      branchColor: r.branchColor,
      railY: r.railY,
      midX: r.midX,
      terminalCx,
      pathD,
      pathLeftFromHub,
      pathMiddleRail: r.isCurrent ? '' : pathMiddleRail,
      pathRightToHub: r.isCurrent ? '' : pathRightToHub,
      hubLeftFadeGradientId,
      hubRightFadeGradientId,
      hitX,
      hitY: r.labelTopApprox,
      hitW,
      hitH: Math.max(26, r.railY - r.labelTopApprox + 6),
      deleteCx,
      deleteCy,
      deleteHitX,
      deleteHitY,
      deleteHitW: DELETE_HIT_W,
      deleteHitH: DELETE_HIT_H,
      labelFrameX: r.labelFrameX,
      labelFrameY: r.labelFrameY,
      labelFrameW: r.labelFrameW,
      labelFrameH: r.labelFrameH,
      labelFrameRx: r.labelFrameRx,
      intermediateCx,
      currentBranchCaptionX,
      currentBranchCaptionMidY,
      stemFadeSplit,
      pathStemLower,
      pathStemFade,
      pathStemUpper,
      pathStemFullVertical,
      stemUpperFadeGradientId,
      stemFullVerticalGradientId,
    };
  });

  for (const row of layoutRows) {
    if (row.isCurrent) {
      const terminalCxCurr =
        row.labelFrameX + row.labelFrameW + TERMINAL_PAD_AFTER_LABEL + PICKER_DOT_R;
      const xStem =
        terminalCxCurr + PICKER_DOT_R + CURRENT_BRANCH_UP_STEM_LEAD_X;
      const xUp = xStem + CURRENT_BRANCH_UP_BEND_PULL_X;
      const stemRight = xStem + CURRENT_BRANCH_UP_BEND_PULL_X + PAD_X_OUTER;
      const captionRight =
        xUp + CURRENT_BRANCH_CAPTION_TEXT_HALF_WIDTH + PAD_X_OUTER;
      vbWidth = Math.max(vbWidth, stemRight, captionRight);
    }
  }

  const pad = BRANCH_PICKER_VIEW_TOP_PAD;
  const viewBox = `0 ${-pad} ${vbWidth} ${graphInnerHeight + pad}`;

  return {
    orderedBranches,
    graphInnerHeight,
    hubY,
    layoutRows,
    rightHubCx,
    vbWidth,
    hasOtherBranches,
    stemFadeGradients,
    viewBox,
    branchPickerSvgStyle: {
      ['--git-branch-picker-scale' as string]: String(GIT_TAB_GRAPH_BRANCH_PICKER_SCALE),
    },
  };
}

export {
  GIT_TAB_GRAPH_DOT_THEME_RING,
  EDGE_STROKE,
  LABEL_FRAME_STROKE,
  HIT_RX,
  DELETE_VISUAL_RING_R,
  PICKER_DOT_R,
  HUB,
};
