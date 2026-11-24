// The box Crop Video keeps: shared by its editor (in the page) and its
// handler (in the main process), so the box the page shows is what the file
// comes out as. In the video's own pixels, as it plays. No React or
// Electron here.

import { type FrameRect, largestPart } from './aspectFrame';
import type { FrameSize } from './frameSize';

/** The smallest side a crop may have, in pixels. */
export const minCrop = 16;

/** `value` rounded down to an even number (0 or more). */
const evenFloor = (value: number) => Math.max(0, Math.floor(value / 2) * 2);
const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/** The whole picture, as a box (both sides even). */
export const wholeBox = (source: FrameSize): FrameRect => ({
  x: 0,
  y: 0,
  width: evenFloor(source.width),
  height: evenFloor(source.height),
});

/**
 * The box as the options hold it (`left`, `top`, `width`, `height`), kept
 * inside `source`, at least `minCrop` a side, on even pixels. A width or
 * height of 0 (the default) is the whole picture.
 */
export function boxOf(
  source: FrameSize,
  set: { left: number; top: number; width: number; height: number },
): FrameRect {
  if (set.width <= 0 || set.height <= 0) return wholeBox(source);
  const most = wholeBox(source);
  const width = clamp(evenFloor(set.width), minCrop, most.width);
  const height = clamp(evenFloor(set.height), minCrop, most.height);
  return {
    width,
    height,
    x: clamp(evenFloor(set.left), 0, evenFloor(source.width - width)),
    y: clamp(evenFloor(set.top), 0, evenFloor(source.height - height)),
  };
}

/** Whether `box` is all of `source`: nothing to crop. */
export const isWhole = (source: FrameSize, box: FrameRect) => {
  const whole = wholeBox(source);
  return (
    box.x === 0 &&
    box.y === 0 &&
    box.width === whole.width &&
    box.height === whole.height
  );
};

/**
 * The largest box of `ratio`'s shape in `source`, centred where `box` is
 * centred (as far as the picture allows): what choosing a Shape makes.
 */
export function shapeBox(
  source: FrameSize,
  box: FrameRect,
  ratio: FrameSize,
): FrameRect {
  const size = largestPart(source, ratio);
  return boxOf(source, {
    left: box.x + box.width / 2 - size.width / 2,
    top: box.y + box.height / 2 - size.height / 2,
    width: size.width,
    height: size.height,
  });
}

/** A handle, by the edges it moves: -1 left or top, 1 right or bottom. */
export type BoxHandle = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/**
 * `start` after a drag of `dx`, `dy` (the video's pixels): moved whole, or
 * by a `handle`, whose opposite edges stay put. With a `ratio` the box
 * keeps that shape: a corner follows whichever way the pointer went
 * further (growing or shrinking), and a side grows the other way about the box's centre. Always
 * inside `source` and at least `minCrop` a side.
 */
export function dragBox(
  source: FrameSize,
  start: FrameRect,
  handle: BoxHandle | 'move',
  dx: number,
  dy: number,
  ratio: FrameSize | null = null,
): FrameRect {
  if (handle === 'move') {
    return boxOf(source, {
      left: start.x + dx,
      top: start.y + dy,
      width: start.width,
      height: start.height,
    });
  }
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  if (!ratio) {
    // Each edge the handle moves, kept inside and short of the other.
    const left =
      handle.x < 0 ? clamp(start.x + dx, 0, right - minCrop) : start.x;
    const top =
      handle.y < 0 ? clamp(start.y + dy, 0, bottom - minCrop) : start.y;
    const r =
      handle.x > 0 ? clamp(right + dx, start.x + minCrop, source.width) : right;
    const b =
      handle.y > 0
        ? clamp(bottom + dy, start.y + minCrop, source.height)
        : bottom;
    // Rounded so the edges that stayed put stay put.
    const x = evenFloor(left);
    const y = evenFloor(top);
    return boxOf(source, {
      left: x,
      top: y,
      width: (handle.x > 0 ? r : right) - x,
      height: (handle.y > 0 ? b : bottom) - y,
    });
  }

  const shape = ratio.width / ratio.height;
  const centre = {
    x: start.x + start.width / 2,
    y: start.y + start.height / 2,
  };
  // How wide it may grow: to the picture's edge from the edges kept, and
  // on a side, as tall as fits about its centre.
  const roomX =
    handle.x < 0
      ? right
      : handle.x > 0
        ? source.width - start.x
        : 2 * Math.min(centre.x, source.width - centre.x);
  const roomY =
    handle.y < 0
      ? bottom
      : handle.y > 0
        ? source.height - start.y
        : 2 * Math.min(centre.y, source.height - centre.y);
  // A side by its own way; a corner by whichever way the pointer went
  // further, growing or shrinking.
  const byX = start.width + handle.x * dx;
  const byY = (start.height + handle.y * dy) * shape;
  const wanted = !handle.y
    ? byX
    : !handle.x
      ? byY
      : Math.abs(byX - start.width) >= Math.abs(byY - start.width)
        ? byX
        : byY;
  const width = clamp(
    wanted,
    Math.max(minCrop, minCrop * shape),
    Math.min(roomX, roomY * shape),
  );
  const height = width / shape;
  const left =
    handle.x < 0
      ? right - width
      : handle.x > 0
        ? start.x
        : centre.x - width / 2;
  const top =
    handle.y < 0
      ? bottom - height
      : handle.y > 0
        ? start.y
        : centre.y - height / 2;
  return boxOf(source, { left, top, width, height });
}
