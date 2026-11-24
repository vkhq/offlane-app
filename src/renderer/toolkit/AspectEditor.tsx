import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  type AspectFit,
  aspectPlan,
  barsOf,
  parseRatio,
  placePart,
  sameShape,
} from '../../shared/aspectFrame';
import {
  type FrameSize,
  maxSide,
  minSide,
  sizeLabel,
} from '../../shared/frameSize';
import {
  PlayButton,
  PlayClock,
  VideoWaiting,
  useEditorPlayback,
  useEditorVideo,
} from './editorVideo';
import type { ToolEditorProps } from './standardTool';

/** Room kept around the picture on the stage, in px. */
const margin = 14;
/** How far an arrow key moves the kept part, in the video's pixels (ten
 *  times as far with Shift). */
const nudgeBy = 2;
/** The picture's corner radius, in px. */
const radius = 'rounded-[10px]';
const animate =
  'transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none';

/**
 * Change Aspect Ratio's editor: the video on a stage as it will come out,
 * with a play button under it.
 *
 * Under Fit with Bars the stage shows the new frame, black, with the
 * video scaled into it: the bars are what is left. Under Fill and Crop it
 * shows the whole video with the part kept lit and the rest dimmed; the
 * kept part is dragged (or moved with the arrow keys) to choose what
 * stays, which sets `cropX` and `cropY`, and double-clicking it centres
 * it. Switching shape or Fit animates the frame to it; the video plays
 * throughout.
 *
 * It works with the `aspect` option (None, a preset "9:16 Vertical", or
 * Custom) and Custom's `width` and `height`: None shows the video as it
 * is; switching to Custom starts from the size the preset came to (the
 * video's own, from None). Beside each preset the Aspect Ratio menu says
 * what it comes to for this video ("→ 1080 × 1920"). The kept part goes
 * back to the middle when the video's size, the shape or Fit changes.
 */
export function AspectEditor({
  media,
  values,
  onChange,
  locked,
  options,
  onHints,
}: ToolEditorProps) {
  const stage = useRef<HTMLDivElement>(null);
  const { source, failed, mediaKey } = useEditorVideo(media);
  const { shown, time, duration, playing, toggle, videoProps } =
    useEditorPlayback(mediaKey);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  /** The stage's scale while the kept part is held, so it follows the
   *  pointer without animating. */
  const [held, setHeld] = useState<number | null>(null);

  const original = source?.size ?? shown;
  const sourceKey = original ? sizeLabel(original) : '';
  const choice = String(values.aspect ?? '');
  const custom = choice === 'Custom';
  const fit = (String(values.fit) || 'Fit with Bars') as AspectFit;
  const fill = fit === 'Fill and Crop';
  const typed = {
    width: Math.round(Number(values.width) || 0),
    height: Math.round(Number(values.height) || 0),
  };
  const tooBig = custom && Math.max(typed.width, typed.height) > maxSide;
  const tooSmall = custom && Math.min(typed.width, typed.height) < minSide;
  const ratio = custom ? typed : parseRatio(choice);
  const plan =
    original && ratio && !tooBig && !tooSmall
      ? aspectPlan(original, ratio, fit, {
          size: custom ? typed : undefined,
          x: Number(values.cropX ?? -1),
          y: Number(values.cropY ?? -1),
        })
      : null;

  // The stage's size, for the picture's scale.
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

  // What each preset comes to for this video under this Fit, beside it in
  // the Aspect Ratio menu, and which is its own shape.
  const aspectSetting = options.aspect;
  const presets =
    aspectSetting?.kind === 'select'
      ? aspectSetting.options.filter((option) => parseRatio(option))
      : [];
  useEffect(() => {
    if (!original) return onHints({});
    const aspect: Record<string, string> = {};
    for (const preset of presets) {
      const shape = parseRatio(preset)!;
      const { output } = aspectPlan(original, shape, fit);
      aspect[preset] = [
        ...(sameShape(original, shape) ? ['original'] : []),
        `→ ${sizeLabel(output)}`,
      ].join(' · ');
    }
    onHints({ aspect });
    // Once per video size and Fit; the presets are fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, fit]);
  useEffect(() => () => onHints({}), [onHints]);

  // Switching to Custom starts from the size the preset came to.
  const lastChoice = useRef(choice);
  useEffect(() => {
    const before = lastChoice.current;
    lastChoice.current = choice;
    if (locked || !original || !custom || before === 'Custom') return;
    // From None, the video's own size.
    const shape = parseRatio(before);
    const { output } = shape
      ? aspectPlan(original, shape, fit)
      : { output: original };
    onChange({ width: output.width, height: output.height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);

  // The kept part goes back to the middle when what it was placed in
  // changes: not when the page opens, which keeps where it was, nor while
  // the video's size isn't known (as while it is got ready again).
  const placedIn = [sourceKey, choice, typed.width, typed.height, fit].join();
  const lastPlacedIn = useRef(sourceKey ? placedIn : '');
  useEffect(() => {
    if (!sourceKey) return;
    const before = lastPlacedIn.current;
    lastPlacedIn.current = placedIn;
    if (locked || !before || before === placedIn) return;
    if (values.cropX !== -1 || values.cropY !== -1) {
      onChange({ cropX: -1, cropY: -1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedIn]);

  // Screen pixels per video pixel: the frame (Fit) or the whole video
  // (Fill) as large as the stage takes; held while the part is dragged.
  const shownSize: FrameSize | null = plan
    ? fill
      ? original
      : plan.output
    : original;
  const scale =
    held ??
    (shownSize
      ? Math.max(
          0,
          Math.min(
            (room.width - margin * 2) / shownSize.width,
            (room.height - margin * 2) / shownSize.height,
          ),
        )
      : 0);
  const part = plan?.part ?? null;
  const picture = plan?.picture ?? null;

  /** Moves the kept part to `x`, `y` (the video's pixels), kept inside. */
  const moveTo = (x: number, y: number) => {
    if (!original || !part) return;
    const placed = placePart(original, part, Math.max(0, x), Math.max(0, y));
    if (placed.x !== part.x || placed.y !== part.y) {
      onChange({ cropX: placed.x, cropY: placed.y });
    }
  };

  /** Follows a drag of the kept part until it is let go (heard on the
   *  window, as Resize's handles are). */
  const drag = (event: PointerEvent<HTMLElement>) => {
    if (locked || event.button !== 0 || !part || !scale) return;
    event.preventDefault();
    const at = scale;
    setHeld(at);
    const start = { x: event.clientX, y: event.clientY };
    const from = { x: part.x, y: part.y };
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
      moveTo(
        from.x + (next.clientX - start.x) / at,
        from.y + (next.clientY - start.y) / at,
      );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /** Arrow keys on the kept part move it. */
  const nudge = (event: KeyboardEvent) => {
    if (locked || !part) return;
    const step = nudgeBy * (event.shiftKey ? 10 : 1);
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = by[event.key];
    if (!move) return;
    event.preventDefault();
    moveTo(part.x + move[0], part.y + move[1]);
  };

  // Where the video sits in what is shown: inside the frame under Fit, the
  // whole of it under Fill.
  const videoBox =
    picture && !fill
      ? {
          left: picture.x * scale,
          top: picture.y * scale,
          width: picture.width * scale,
          height: picture.height * scale,
        }
      : { left: 0, top: 0, width: '100%', height: '100%' };
  const motion = held === null ? animate : '';

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={stage}
        className="relative aspect-video touch-none overflow-hidden rounded-2xl select-none"
      >
        {source && (
          <div
            className={`absolute top-1/2 left-1/2 -translate-1/2 overflow-hidden bg-black ${radius} ${motion}`}
            style={
              shownSize && scale > 0
                ? {
                    width: shownSize.width * scale,
                    height: shownSize.height * scale,
                  }
                : { width: '72%', height: '72%' }
            }
          >
            <video
              {...videoProps}
              src={source.url}
              preload="auto"
              playsInline
              className={`absolute cursor-pointer object-fill ${fill ? '' : radius} ${motion}`}
              style={videoBox}
            />
            {plan && fill && part && (
              // The part kept, lit; the rest dimmed by its shadow.
              <span
                role="slider"
                tabIndex={locked ? -1 : 0}
                aria-label="Part kept: drag to move, double-click to centre"
                aria-valuenow={part.x || part.y}
                aria-valuetext={`${sizeLabel(part)} at ${part.x}, ${part.y}`}
                onPointerDown={drag}
                onKeyDown={nudge}
                onDoubleClick={() =>
                  !locked && onChange({ cropX: -1, cropY: -1 })
                }
                className={`absolute rounded-[6px] shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] ring-2 ring-white outline-none focus-visible:ring-brand ${locked ? '' : 'cursor-grab active:cursor-grabbing'} ${motion}`}
                style={{
                  left: part.x * scale,
                  top: part.y * scale,
                  width: part.width * scale,
                  height: part.height * scale,
                }}
              />
            )}
            {plan && (
              // On the frame, or under Fill on the part kept.
              <span
                className={`pointer-events-none absolute rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums ${motion}`}
                style={{
                  left: (part ? part.x * scale : 0) + 8,
                  top: (part ? part.y * scale : 0) + 8,
                }}
              >
                {sizeLabel(plan.output)}
              </span>
            )}
          </div>
        )}
        {!source && <VideoWaiting failed={failed} />}
      </div>

      {/* Under it: where it has played to, Play, and what it comes out as. */}
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
          ) : choice === 'None' ? (
            <span className="text-ink-soft">Choose an aspect ratio</span>
          ) : plan && original ? (
            <>
              <span
                className={`font-medium ${plan.upscale ? 'text-amber-700' : 'text-ink'}`}
              >
                {sizeLabel(plan.output)}
              </span>
              <span className="text-ink-soft">
                {' '}
                (
                {fill
                  ? plan.same
                    ? 'nothing cut'
                    : `cut from ${sizeLabel(original)}`
                  : barsOf(plan)}
                )
              </span>
              {plan.upscale && (
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
