// A video's picture size, as Resize Video sets it: shared by its editor (in
// the page) and its handler (in the main process), so the size the page
// shows is the size the file comes out at. No React or Electron here.

export type FrameSize = { width: number; height: number };

/** The smallest side a resized video may have, in pixels. */
export const minSide = 16;
/** The largest side: the most H.264 encoders take (4096×2304 at level 5.1). */
export const maxSide = 4096;

/** `value` rounded to an even number of pixels, as H.264 in 4:2:0 needs,
 *  and at least 2. */
export const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** "1920 × 1080" (or "1920x1080") as a size, or null. */
export function parseSize(text: string): FrameSize | null {
  const match = /^\s*(\d+)\s*[×x]\s*(\d+)\s*$/i.exec(text);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** A size as the page shows it: "1920 × 1080". */
export const sizeLabel = ({ width, height }: FrameSize) =>
  `${width} × ${height}`;

/**
 * `source` scaled to the largest size that fits inside `box`, keeping its
 * shape, both sides even: 1080×1920 inside 1920×1080 is 608×1080. Bigger
 * than `source` when the box is (an upscale).
 */
export function fitInside(source: FrameSize, box: FrameSize): FrameSize {
  const scale = Math.min(box.width / source.width, box.height / source.height);
  return {
    width: Math.min(box.width, even(source.width * scale)),
    height: Math.min(box.height, even(source.height * scale)),
  };
}

/** `source` scaled to `width` pixels wide, keeping its shape. */
export const atWidth = (source: FrameSize, width: number): FrameSize => ({
  width: even(width),
  height: even((width * source.height) / source.width),
});

/** `source` scaled to `height` pixels tall, keeping its shape. */
export const atHeight = (source: FrameSize, height: number): FrameSize => ({
  width: even((height * source.width) / source.height),
  height: even(height),
});

/**
 * `size` (in `source`'s shape) kept within `minSide` and `maxSide`, still
 * in that shape.
 */
export function withinLimits(source: FrameSize, size: FrameSize): FrameSize {
  const wide = source.width >= source.height;
  // The side that is out of bounds is set to the bound; the other follows.
  if (Math.max(size.width, size.height) > maxSide) {
    return wide ? atWidth(source, maxSide) : atHeight(source, maxSide);
  }
  if (Math.min(size.width, size.height) < minSide) {
    return wide ? atHeight(source, minSide) : atWidth(source, minSide);
  }
  return size;
}

/** How a size compares with the source's, in percent of its width. */
export const percentOf = (source: FrameSize, size: FrameSize) =>
  Math.round((size.width / source.width) * 100);
