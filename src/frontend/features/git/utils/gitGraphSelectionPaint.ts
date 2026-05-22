/**
 * Post-render selection styling for `commit-graph` Metro dots (circle `id` = commit hash).
 * Adapted from archive `paintGitgraphDotSelection` — DOM differs slightly (stroke `<use>` sits in an inner `<g>`).
 */

import type { GitLogEntry } from '../types/git';
import { GIT_TAB_GRAPH_DOT_SELECTED_SCALE } from './gitTabGraphLayout';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const GITGRAPH_SELECTED_DOT_FILL = 'var(--text-on-accent)';
export const GITGRAPH_SELECTED_DOT_STROKE = GITGRAPH_SELECTED_DOT_FILL;
export const GITGRAPH_DOT_INTERIOR_FILL =
  'var(--bg-sidebar, var(--bg-primary, transparent))';

const GITGRAPH_BASE_STROKE_ATTR = 'data-gitgraph-base-stroke';
const GITGRAPH_BASE_FILL_ATTR = 'data-gitgraph-base-fill';

function findGitgraphDotUseElement(circle: Element): SVGUseElement | null {
  const defs = circle.parentElement;
  if (defs === null || defs.localName !== 'defs') {
    return null;
  }
  const sib = defs.nextElementSibling;
  if (sib === null) {
    return null;
  }
  if (sib.localName === 'use') {
    return sib as SVGUseElement;
  }
  if (sib.localName === 'g') {
    const use = sib.querySelector('use');
    return use instanceof SVGUseElement ? use : null;
  }
  return null;
}

/** Group that receives the selection scale transform (inner dot graphic, not the commit translate `<g>`). */
function findGitgraphDotScaleGroup(circle: Element): SVGGElement | null {
  const defs = circle.parentElement;
  if (defs === null || defs.localName !== 'defs') {
    return null;
  }
  const inner = defs.nextElementSibling;
  if (inner instanceof SVGGElement) {
    return inner;
  }
  const outer = defs.parentElement;
  return outer instanceof SVGGElement ? outer : null;
}

function paintOneGitgraphDotSelection(circle: Element, selected: boolean): void {
  const useEl = findGitgraphDotUseElement(circle);
  const dotG = findGitgraphDotScaleGroup(circle);
  if (useEl === null || dotG === null) {
    return;
  }
  if (!circle.hasAttribute(GITGRAPH_BASE_FILL_ATTR)) {
    circle.setAttribute(
      GITGRAPH_BASE_FILL_ATTR,
      circle.getAttribute('fill') ?? GITGRAPH_DOT_INTERIOR_FILL,
    );
  }
  if (!useEl.hasAttribute(GITGRAPH_BASE_STROKE_ATTR)) {
    useEl.setAttribute(GITGRAPH_BASE_STROKE_ATTR, useEl.getAttribute('stroke') ?? '');
  }
  const baseFill =
    circle.getAttribute(GITGRAPH_BASE_FILL_ATTR) ?? GITGRAPH_DOT_INTERIOR_FILL;
  const baseStroke = useEl.getAttribute(GITGRAPH_BASE_STROKE_ATTR) ?? '';
  const cx = parseFloat(circle.getAttribute('cx') ?? '0');
  const cy = parseFloat(circle.getAttribute('cy') ?? '0');
  if (selected) {
    circle.setAttribute('fill', GITGRAPH_SELECTED_DOT_FILL);
    useEl.setAttribute('stroke', GITGRAPH_SELECTED_DOT_STROKE);
    dotG.setAttribute(
      'transform',
      `translate(${cx},${cy}) scale(${GIT_TAB_GRAPH_DOT_SELECTED_SCALE}) translate(${-cx},${-cy})`,
    );
  } else {
    circle.setAttribute('fill', baseFill);
    useEl.setAttribute('stroke', baseStroke);
    dotG.removeAttribute('transform');
  }
}

export function paintGitgraphDotSelection(
  mountEl: HTMLElement | null,
  entries: GitLogEntry[],
  selectedHashes: string[],
): void {
  const selectedSet = new Set(
    selectedHashes.map((hash) => hash.trim()).filter((hash) => hash !== ''),
  );
  if (mountEl === null) {
    return;
  }
  const svg = mountEl.querySelector('svg');
  if (svg === null || !(svg instanceof SVGSVGElement)) {
    return;
  }
  const circleById = new Map<string, Element>();
  for (const node of svg.querySelectorAll('circle[id]')) {
    if (node.namespaceURI !== SVG_NS || node.localName !== 'circle') {
      continue;
    }
    const id = node.getAttribute('id');
    if (id !== null && id !== '') {
      circleById.set(id, node);
    }
  }
  if (entries.length === 0) {
    for (const circle of circleById.values()) {
      paintOneGitgraphDotSelection(circle, false);
    }
    return;
  }
  const hashesInEntries = new Set(
    entries.map((e) => e.hash.trim()).filter((h) => h !== ''),
  );
  for (const [id, circle] of circleById) {
    const idNorm = id.trim();
    if (!hashesInEntries.has(idNorm)) {
      paintOneGitgraphDotSelection(circle, false);
      continue;
    }
    paintOneGitgraphDotSelection(circle, selectedSet.has(idNorm));
  }
}
