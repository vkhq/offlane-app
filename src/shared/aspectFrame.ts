// A video's new shape, as Change Aspect Ratio makes it: shared by its editor
// (in the page) and its handler (in the main process), so what the page
// shows is what the file comes out as. No React or Electron here.

import { type FrameSize, even, fitInside, maxSide } from './frameSize';

/** Where a part of the picture is: its size and its top-left corner. */
export type FrameRect = FrameSize & { x: number; y: number };

/** How the video is made to take the new shape. */
export type AspectFit = 'Fit with Bars' | 'Fill and Crop';

/** "9:16 Vertical" (or "9:16") as a shape, 9 wide by 16 tall, or null. */
export function parseRatio(text: string): FrameSize | null {
  const match = /^\s*(\d+)\s*:\s*(\d+)/.exec(text);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** `value` rounded down to an even number of pixels (0 or more): an
 *  offset. */
const evenFloor = (value: number) => Math.max(0, Math.floor(value / 2) * 2);
/** `value` rounded down to an even number of pixels, at least 2: a side. */
const evenDown = (value: number) => Math.max(2, evenFloor(value));

/** Whether `size` is in `ratio`'s shape, to within 1%. */
export const sameShape = (size: FrameSize, ratio: FrameSize) =>
  Math.abs(size.width / size.height / (ratio.width / ratio.height) - 1) < 0.01;

/**
 * The frame Fit makes: `ratio`'s shape at the video's own long side (a
 * 1920×1080 video at 9:16 is 1080×1920), at most `maxSide`, both sides even.
 */
export function fitFrame(source: FrameSize, ratio: FrameSize): FrameSize {
  const long = Math.min(maxSide, Math.max(source.width, source.height));
  return ratio.width >= ratio.height
    ? { width: even(long), height: even((long * ratio.height) / ratio.width) }
    : { width: even((long * ratio.width) / ratio.height), height: even(long) };
}

/**
 * The largest part of `source` in `ratio`'s shape, both sides even and
 * inside it: what Fill keeps, before it is placed.
 */
export function largestPart(source: FrameSize, ratio: FrameSize): FrameSize {
  if (sameShape(source, ratio)) {
    return { width: evenDown(source.width), height: evenDown(source.height) };
  }
  const wider = source.width / source.height > ratio.width / ratio.height;
  return wider
    ? {
        width: Math.min(
          evenDown(source.width),
          even((source.height * ratio.width) / ratio.height),
        ),
        height: evenDown(source.height),
      }
    : {
        width: evenDown(source.width),
        height: Math.min(
          evenDown(source.height),
          even((source.width * ratio.height) / ratio.width),
        ),
      };
}

/**
 * `part` of `source` with its top-left corner at `x`, `y` (in the video's
 * own pixels, as it plays), kept inside the picture and on even pixels;
 * -1 centres it on that side.
 */
export function placePart(
  source: FrameSize,
  part: FrameSize,
  x: number,
  y: number,
): FrameRect {
  const place = (at: number, room: number) =>
    at < 0 ? evenFloor(room / 2) : Math.min(evenFloor(at), evenFloor(room));
  return {
    ...part,
    x: place(x, source.width - part.width),
    y: place(y, source.height - part.height),
  };
}

/** What Change Aspect Ratio does to a video, worked out in full. */
export type AspectPlan = {
  /** The size it comes out at. */
  output: FrameSize;
  /** Fit: the video, scaled, and where it sits in the frame (bars round
   *  it). Null under Fill. */
  picture: FrameRect | null;
  /** Fill: the part of the video kept, in its own pixels. Null under Fit. */
  part: FrameRect | null;
  /** Whether the video is made bigger than it is (it may look softer). */
  upscale: boolean;
  /** Whether the video is already in the new shape. */
  same: boolean;
};

/**
 * How a `source` video becomes `ratio`'s shape under `fit`: Fit at the
 * video's long side with black bars; Fill as the largest part of that
 * shape, unscaled, placed at `x`, `y` (-1 centres it). A `size` (Custom's
 * width and height) sets the output's size exactly, the video scaled to
 * it. Sizes past `maxSide` come down to it.
 */
export function aspectPlan(
  source: FrameSize,
  ratio: FrameSize,
  fit: AspectFit,
  { size, x = -1, y = -1 }: { size?: FrameSize; x?: number; y?: number } = {},
): AspectPlan {
  const same = sameShape(source, ratio);
  if (fit === 'Fit with Bars') {
    const output = size
      ? { width: even(size.width), height: even(size.height) }
      : fitFrame(source, ratio);
    const scaled = fitInside(source, output);
    const picture = {
      ...scaled,
      x: evenFloor((output.width - scaled.width) / 2),
      y: evenFloor((output.height - scaled.height) / 2),
    };
    return {
      output,
      picture,
      part: null,
      upscale: scaled.width > source.width,
      same,
    };
  }
  const part = placePart(source, largestPart(source, ratio), x, y);
  const output = size
    ? { width: even(size.width), height: even(size.height) }
    : Math.max(part.width, part.height) > maxSide
      ? fitInside(part, { width: maxSide, height: maxSide })
      : { width: part.width, height: part.height };
  return {
    output,
    picture: null,
    part,
    upscale: output.width > part.width,
    same,
  };
}

/** Where the bars are, in words, for a Fit plan. */
export function barsOf(plan: AspectPlan): string {
  const picture = plan.picture;
  if (!picture) return '';
  const sides = picture.width < plan.output.width - 2;
  const ends = picture.height < plan.output.height - 2;
  return sides && ends
    ? 'bars all round'
    : sides
      ? 'bars at the sides'
      : ends
        ? 'bars above and below'
        : 'no bars';
}
