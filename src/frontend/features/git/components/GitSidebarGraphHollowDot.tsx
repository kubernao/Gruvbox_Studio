import React from 'react';
import {
  GIT_TAB_GRAPH_DOT_RADIUS,
  GIT_TAB_GRAPH_DOT_RING_PX,
} from '../utils/gitTabGraphLayout';
import {
  GITGRAPH_DOT_INTERIOR_FILL,
} from '../utils/gitGraphSelectionPaint';

const R = GIT_TAB_GRAPH_DOT_RADIUS;
const ringStrokeWidth = String(GIT_TAB_GRAPH_DOT_RING_PX);

export interface GitSidebarGraphHollowDotProps {
  circleId: string;
  centerX: number;
  centerY: number;
  ringColor: string;
  interiorFill?: string;
  title?: string;
  className?: string;
}

export const GitSidebarGraphHollowDot: React.FC<GitSidebarGraphHollowDotProps> = ({
  circleId,
  centerX,
  centerY,
  ringColor,
  interiorFill = GITGRAPH_DOT_INTERIOR_FILL,
  title,
  className,
}) => {
  const clipPathId = `clip-${circleId}`;
  const circleHref = `#${circleId}`;
  const clipPathUrl = `url(#${clipPathId})`;
  const outerTransform = `translate(${centerX - R}, ${centerY - R})`;

  return (
    <g className={className} pointerEvents="none" transform={outerTransform}>
      {title !== undefined && title !== '' ? <title>{title}</title> : null}
      <defs>
        <circle id={circleId} cx={R} cy={R} r={R} fill={interiorFill} />
        <clipPath id={clipPathId}>
          <use href={circleHref} xlinkHref={circleHref} />
        </clipPath>
      </defs>
      <use
        href={circleHref}
        xlinkHref={circleHref}
        clipPath={clipPathUrl}
        stroke={ringColor}
        strokeWidth={ringStrokeWidth}
      />
    </g>
  );
};
