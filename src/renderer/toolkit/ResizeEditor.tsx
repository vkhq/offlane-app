import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  type FrameSize,
  atHeight,
  atWidth,
  fitInside,
  maxSide,
  minSide,
  parseSize,
  percentOf,
  sizeLabel,
  withinLimits,
} from '../../shared/frameSize';
import {
  PlayButton,
  PlayClock,
  VideoWaiting,
  useEditorPlayback,
  useEditorVideo,
} from './editorVideo';
import type { ToolEditorProps } from './standardTool';

/** Room kept around the frame on the stage, for its handles, in px. */
const margin = 14;
/** How much of the stage the video fills at its own size, so there is
 *  room to drag the frame bigger than it (an upscale). */
const restShare = 0.72;
/** Within this share of the video's own width, a drag lands on it. */
const snap = 0.03;

/** A handle, by the edges it moves: -1 left or top, 1 right or bottom. */
type Handle = { x: -1 | 0 | 1; y: -1 | 0 | 1; name: string; cursor: string };
const handles: Handle[] = [
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
const videoRadius = 10;
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
const handleShape = (handle: Handle) =>
  handle.x && handle.y
    ? 'bg-transparent!'
    : 'rounded-full border-[2.5px] bg-white!';

/**
 * A handle's size and place about its point on the frame: a pill centred on
 * it, an L's outer corner half its thickness outside the video's, so its
 * arms run down the video's edge.
 */
const handleStyle = (handle: Handle): CSSProperties => {
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
    [`border${vertical}${horizontal}Radius`]: videoRadius + half,
  };
};

/**
 * How far a pointer is from the frame's centre, for `handle`, as half the
 * frame's width on screen: a side counts only its own direction, a corner
 * whichever is further, with heights in the video's shape (`ratio`).
 */
const reach = (handle: Handle, dx: number, dy: number, ratio: number) =>
  handle.x && handle.y
    ? Math.max(Math.abs(dx), Math.abs(dy) * ratio)
    : handle.x
      ? Math.abs(dx)
      : Math.abs(dy) * ratio;

/**
 * Resize Video's editor: the video on a stage, inside a frame that is the
 * size it will come out at, with a play button under it. The frame has a
 * handle at each corner and side; dragging one resizes the frame about
 * its centre, keeping the video's shape, the video filling it (smaller
 * when the frame is, bigger when it is dragged past the video's own size,
 * which is shown dashed: an upscale, flagged as losing quality).
 *
 * It works with the `size` option (a preset "W × H", or Custom) and
 * Custom's `width` and `height`: a preset fits the video inside it, the
 * frame showing what that comes to; dragging switches to Custom with the
 * size dragged to; and typing Custom's Width or Height fills in the other
 * in the video's shape. Beside each preset the Size menu says what it
 * comes to for this video, where that differs ("→ 608 × 1080").
 */
export function ResizeEditor({
  media,
  options,
  values,
  onChange,
  locked,
  onHints,
}: ToolEditorProps) {
  const stage = useRef<HTMLDivElement>(null);
  const { source, failed, mediaKey } = useEditorVideo(media);
  const { shown, time, duration, playing, toggle, videoProps } =
    useEditorPlayback(mediaKey);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  /** The stage's scale while a handle is held, so the frame follows the
   *  pointer rather than the stage rescaling under it. */
  const [held, setHeld] = useState<number | null>(null);

  const original = source?.size ?? shown;
  const sourceKey = original ? sizeLabel(original) : '';

  const choice = String(values.size ?? '');
  const custom = choice === 'Custom';
  const typed = {
    width: Math.round(Number(values.width) || 0),
    height: Math.round(Number(values.height) || 0),
  };
  const sizeSetting = options.size;
  const presets =
    sizeSetting?.kind === 'select'
      ? sizeSetting.options.filter((option) => parseSize(option))
      : [];

  /** What the video comes out at, as the handler works it out. */
  const output: FrameSize | null = !original
    ? null
    : custom
      ? typed.width > 0 && typed.height > 0
        ? fitInside(original, typed)
        : null
      : fitInside(original, parseSize(choice) ?? original);
  const tooBig = !!output && Math.max(output.width, output.height) > maxSide;
  const tooSmall = !!output && Math.min(output.width, output.height) < minSide;

  // The stage's size, for the frame's scale.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () =>
      setRoom({ width: element.clientWidth, height: element.clientHeight });
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    measure();
    return () => watch.disconnect();
  }, []);

  // What each preset comes to for this video, beside it in the Size menu,
  // and which one is its own size.
  useEffect(() => {
    if (!original) return onHints({});
    const size: Record<string, string> = {};
    for (const preset of presets) {
      const fitted = fitInside(original, parseSize(preset)!);
      const upscale = fitted.width > original.width;
      const label = sizeLabel(fitted);
      const parts = [
        // The video's own size: kept as it is.
        ...(preset === sourceKey ? ['original'] : []),
        ...(label === preset ? [] : [`→ ${label}`]),
        ...(upscale ? ['upscale'] : []),
      ];
      if (parts.length) size[preset] = parts.join(' · ');
    }
    onHints({ size });
    // Once per video size; the presets are fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);
  useEffect(() => () => onHints({}), [onHints]);

  /** The size, choice and video last seen, to tell which side was typed. */
  const last = useRef({ ...typed, choice, sourceKey });
  /** Sets Custom's size, as one change the side-filling below leaves be. */
  const setCustom = (size: FrameSize) => {
    last.current = { ...size, choice: 'Custom', sourceKey };
    onChange({ size: 'Custom', width: size.width, height: size.height });
  };

  // Custom's Width and Height kept in the video's shape: switching to
  // Custom starts from the size the preset came to; typing one side fills
  // in the other; a video of another shape keeps the width typed.
  useEffect(() => {
    if (locked || !original) return;
    const before = last.current;
    let next: FrameSize | null = null;
    if (custom && before.choice !== 'Custom') {
      next = fitInside(original, parseSize(before.choice) ?? original);
    } else if (custom && typed.width !== before.width) {
      // The side typed stays as typed; only the other is filled in.
      if (typed.width > 0) {
        next = { ...typed, height: atWidth(original, typed.width).height };
      }
    } else if (custom && typed.height !== before.height) {
      if (typed.height > 0) {
        next = { ...typed, width: atHeight(original, typed.height).width };
      }
    } else if (custom && before.sourceKey !== sourceKey && typed.width > 0) {
      next = atWidth(original, typed.width);
    }
    last.current = { ...(next ?? typed), choice, sourceKey };
    if (next && (next.width !== typed.width || next.height !== typed.height)) {
      onChange({ width: next.width, height: next.height });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, typed.width, typed.height, sourceKey, locked]);

  // Screen pixels per video pixel: the video at `restShare` of the stage,
  // or less if the frame wouldn't fit; held while a handle is dragged.
  const inner = {
    width: Math.max(0, room.width - margin * 2),
    height: Math.max(0, room.height - margin * 2),
  };
  const fits = (size: FrameSize) =>
    Math.min(inner.width / size.width, inner.height / size.height);
  const scale =
    held ??
    (original
      ? Math.min(
          restShare * fits(original),
          output && !tooBig && !tooSmall ? fits(output) : Infinity,
        )
      : 0);
  const ratio = original ? original.width / original.height : 16 / 9;
  /** The frame on screen: the output, or the video's own size if none. */
  const framed = output ?? original;
  const box = framed
    ? { width: framed.width * scale, height: framed.height * scale }
    : null;

  /** The size the frame comes to at `width` (video pixels): snapped to the
   *  video's own size near it, kept to what fits on the stage and what
   *  H.264 takes. */
  const sized = (width: number, at: number): FrameSize | null => {
    if (!original) return null;
    const most = Math.min(inner.width / at, (inner.height / at) * ratio);
    let next = Math.min(Math.max(width, 2), most);
    if (Math.abs(next - original.width) < original.width * snap) {
      next = original.width;
    }
    return withinLimits(original, atWidth(original, next));
  };

  /** Follows a handle's drag until it is let go (heard on the window, as
   *  Trim's handles are), resizing the frame about its centre. */
  const drag = (handle: Handle) => (event: PointerEvent<HTMLElement>) => {
    if (locked || event.button !== 0 || !original || !output || !stage.current)
      return;
    event.preventDefault();
    event.stopPropagation();
    const rect = stage.current.getBoundingClientRect();
    const centre = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    const at = scale;
    setHeld(at);
    const start = reach(
      handle,
      event.clientX - centre.x,
      event.clientY - centre.y,
      ratio,
    );
    const from = (output.width * at) / 2;
    const id = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(id);
    } catch {
      // Without it the window still hears the drag.
    }
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setHeld(null);
    };
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== id) return;
      if ((next.buttons & 1) === 0) return end();
      const now = reach(
        handle,
        next.clientX - centre.x,
        next.clientY - centre.y,
        ratio,
      );
      const size = sized(((from + now - start) * 2) / at, at);
      if (size) setCustom(size);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /** Arrow keys on a handle: Right and Up grow the frame, Left and Down
   *  shrink it, by 1% of the video's width (10% with Shift). */
  const nudge = (event: KeyboardEvent) => {
    if (locked || !original || !output) return;
    const by =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    if (!by) return;
    event.preventDefault();
    const step = original.width * (event.shiftKey ? 0.1 : 0.01);
    const size = sized(output.width + by * step, scale);
    if (size) setCustom(size);
  };

  const percent = original && output ? percentOf(original, output) : null;
  const upscale = percent !== null && percent > 100;

  return (
    <div className="flex flex-col gap-3">
      {/* The stage: the video in its frame, the video's own size dashed. */}
      <div
        ref={stage}
        className="relative aspect-video touch-none overflow-hidden rounded-2xl select-none"
      >
        {original && scale > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 rounded-sm border border-dashed border-ink-faint"
            style={{
              width: original.width * scale,
              height: original.height * scale,
            }}
          />
        )}
        {source && (
          <div
            className="absolute top-1/2 left-1/2 -translate-1/2 rounded-[10px] bg-black"
            style={
              box
                ? { width: box.width, height: box.height }
                : { width: '72%', height: '72%' }
            }
          >
            <video
              {...videoProps}
              src={source.url}
              preload="auto"
              playsInline
              className="size-full cursor-pointer rounded-[10px] object-fill"
            />
            {box && output && (
              <>
                {/* What the frame comes to. The frame has no line of its
                    own: the video's edge is its edge, marked by the handles. */}
                <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                  {sizeLabel(output)}
                </span>
                {!locked &&
                  handles.map((handle) => (
                    <span
                      key={handle.name}
                      role="slider"
                      tabIndex={0}
                      aria-label={`${handle.name}: drag to resize`}
                      aria-valuemin={minSide}
                      aria-valuemax={maxSide}
                      aria-valuenow={output.width}
                      aria-valuetext={sizeLabel(output)}
                      onPointerDown={drag(handle)}
                      onKeyDown={nudge}
                      className={`absolute outline-none drop-shadow-sm before:absolute before:-inset-2 focus-visible:ring-2 focus-visible:ring-brand/50 ${handleShape(handle)} ${upscale ? 'border-amber-500 bg-amber-500' : 'border-brand bg-brand'} ${handle.cursor}`}
                      style={handleStyle(handle)}
                    />
                  ))}
              </>
            )}
          </div>
        )}
        {!source && <VideoWaiting failed={failed} />}
      </div>

      {/* Under it: where it has played to, Play, and the size it makes. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center rounded-2xl bg-canvas px-4 py-1.5 text-[12px] tabular-nums shadow-card">
        <PlayClock time={time} duration={duration} />
        <PlayButton
          playing={playing}
          disabled={!source || !duration}
          onClick={toggle}
        />
        <span className="justify-self-end text-right">
          {tooBig || tooSmall ? (
            <span className="font-medium text-brand">
              {tooBig
                ? `At most ${maxSide} px a side`
                : `At least ${minSide} px a side`}
            </span>
          ) : output && original ? (
            <>
              <span
                className={`font-medium ${upscale ? 'text-amber-700' : 'text-ink'}`}
              >
                {sizeLabel(output)}
              </span>
              <span className="text-ink-soft">
                {' '}
                ({percent}% of {sizeLabel(original)})
              </span>
              {upscale && (
                <span className="block text-amber-700">
                  Upscaling: lower quality
                </span>
              )}
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
