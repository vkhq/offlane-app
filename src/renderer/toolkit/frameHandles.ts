import type { CSSProperties } from 'react';

// The handles on a frame over an editor's video (Resize Video's frame, Crop
// Video's box): where each sits, how it looks and which way it drags.

/** A handle, by the edges it moves: -1 left or top, 1 right or bottom. */
export type Handle = {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
  name: string;
  cursor: string;
};
export const handles: Handle[] = [
  { x: -1, y: -1, name: 'Top left corner', cursor: 'cursor-nwse-resize' },
  { x: 0, y: -1, name: 'Top edge', cursor: 'cursor-ns-resize' },
  { x: 1, y: -1, name: 'Top right corner', cursor: 'cursor-nesw-resize' },
  { x: 1, y: 0, name: 'Right edge', cursor: 'cursor-ew-resize' },
  { x: 1, y: 1, name: 'Bottom right corner', cursor: 'cursor-nwse-resize' },
  { x: 0, y: 1, name: 'Bottom edge', cursor: 'cursor-ns-resize' },
  { x: -1, y: 1, name: 'Bottom left corner', cursor: 'cursor-nesw-resize' },
  { x: -1, y: 0, name: 'Left edge', cursor: 'cursor-ew-resize' },
];

/** The video's corner radius, in px; the frame and corner handles follow it. */
export const videoRadius = 10;
/** How thick a side handle is, in px, centred on the video's edge: room
 *  for its 2.5px border and a white middle. */
const handleThickness = 10;
/** How long a side handle is, and each arm of a corner handle, in px. */
const sideLength = 36;
const cornerArm = 22;
/** How thick a corner handle's arms are, in px. */
const cornerThickness = 5;

/**
 * A handle's shape: a hollow pill along its side (a coloured border round a
 * white middle), or a solid L hugging its corner. The L is the borders of a clear box, rounded on its corner so it
 * bends with the video's (both are squircles). Each takes a larger, unseen
 * hit area (its ::before).
 */
export const handleShape = (handle: Handle) =>
  handle.x && handle.y
    ? 'bg-transparent!'
    : 'rounded-full border-[2.5px] bg-white!';

/**
 * A handle's size and place about its point on the frame: a pill centred on
 * it, an L's outer corner half its thickness outside the video's, so its
 * arms run down the video's edge.
 */
export const handleStyle = (
  handle: Handle,
  radius = videoRadius,
): CSSProperties => {
  const place = {
    left: `${((handle.x + 1) / 2) * 100}%`,
    top: `${((handle.y + 1) / 2) * 100}%`,
  };
  if (!handle.x || !handle.y) {
    return {
      ...place,
      width: handle.x ? handleThickness : sideLength,
      height: handle.x ? sideLength : handleThickness,
      transform: 'translate(-50%, -50%)',
    };
  }
  const half = cornerThickness / 2;
  const along = (side: -1 | 1) =>
    side < 0 ? `-${half}px` : `calc(-100% + ${half}px)`;
  const vertical = handle.y < 0 ? 'Top' : 'Bottom';
  const horizontal = handle.x < 0 ? 'Left' : 'Right';
  return {
    ...place,
    width: cornerArm,
    height: cornerArm,
    transform: `translate(${along(handle.x)}, ${along(handle.y)})`,
    [`border${vertical}Width`]: cornerThickness,
    [`border${horizontal}Width`]: cornerThickness,
    [`border${vertical}${horizontal}Radius`]: radius + half,
  };
};
