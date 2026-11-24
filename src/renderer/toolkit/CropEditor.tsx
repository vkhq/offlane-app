import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { type FrameRect, parseRatio } from '../../shared/aspectFrame';
import {
  type BoxHandle,
  boxOf,
  dragBox,
  isWhole,
  shapeBox,
  wholeBox,
} from '../../shared/cropBox';
import { sizeLabel } from '../../shared/frameSize';
import {
  PlayButton,
  PlayClock,
  VideoWaiting,
  useEditorPlayback,
  useEditorVideo,
} from './editorVideo';
import { handleShape, handleStyle, handles } from './frameHandles';
import type { ToolEditorProps } from './standardTool';

/** Room kept around the video on the stage, for the handles, in px. */
const margin = 14;
/** How far an arrow key moves the box or an edge, in the video's pixels
 *  (ten times as far with Shift). */
const nudgeBy = 2;

/**
 * Crop Video's editor: the video on a stage, still, with the box it keeps
 * over it and the rest dimmed, and a play button under it. The box has a
 * handle at each corner and side: dragging one moves that edge (the
 * opposite one stays put); dragging inside moves the box; arrow keys do
 * the same on whichever has focus, and double-clicking the box sets it
 * back to the whole picture. A Shape other than Free holds the box to it:
 * a corner keeps the shape, and a side grows the other way about the
 * centre; choosing a shape fits the largest box of it where the box is.
 * Thirds are shown in the box while it is dragged.
 *
 * It works with the `shape` option and sets `left`, `top`, `width` and
 * `height` (the video's pixels, as it plays; a width of 0 is the whole
 * picture). The box goes back to the whole picture when a video of
 * another size comes in.
 */
export function CropEditor({
  media,
  values,
  onChange,
  locked,
}: ToolEditorProps) {
  const stage = useRef<HTMLDivElement>(null);
  const { source, failed, mediaKey } = useEditorVideo(media);
  const { shown, time, duration, playing, toggle, videoProps } =
    useEditorPlayback(mediaKey);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  /** The stage's scale while the box is held, so it follows the pointer;
   *  also shows the thirds. */
  const [held, setHeld] = useState<number | null>(null);

  const original = source?.size ?? shown;
  const sourceKey = original ? sizeLabel(original) : '';
  const shape = String(values.shape ?? 'Free');
  const ratio = parseRatio(shape);
  const box: FrameRect | null = original
    ? boxOf(original, {
        left: Number(values.left) || 0,
        top: Number(values.top) || 0,
        width: Number(values.width) || 0,
        height: Number(values.height) || 0,
      })
    : null;
  const whole = !!original && !!box && isWhole(original, box);

  /** Sets the box. */
  const setBox = (next: FrameRect) =>
    onChange({
      left: next.x,
      top: next.y,
      width: next.width,
      height: next.height,
    });

  // The stage's size, for the video's scale.
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

  // Choosing a shape fits the largest box of it where the box is.
  const lastShape = useRef(shape);
  useEffect(() => {
    const before = lastShape.current;
    lastShape.current = shape;
    if (locked || before === shape || !original || !box || !ratio) return;
    setBox(shapeBox(original, box, ratio));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  // A video of another size: the whole picture again. Not when the page
  // opens, nor while the size isn't known (as while it is got ready).
  const lastSize = useRef(sourceKey);
  useEffect(() => {
    if (!sourceKey) return;
    const before = lastSize.current;
    lastSize.current = sourceKey;
    if (locked || !before || before === sourceKey) return;
    onChange({ left: 0, top: 0, width: 0, height: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const scale =
    held ??
    (original
      ? Math.max(
          0,
          Math.min(
            (room.width - margin * 2) / original.width,
            (room.height - margin * 2) / original.height,
          ),
        )
      : 0);

  /** Follows a drag of the box (`move`) or a handle until it is let go
   *  (heard on the window, as Resize's handles are). */
  const drag =
    (handle: BoxHandle | 'move') => (event: PointerEvent<HTMLElement>) => {
      if (locked || event.button !== 0 || !original || !box || !scale) return;
      event.preventDefault();
      event.stopPropagation();
      const at = scale;
      setHeld(at);
      const start = { x: event.clientX, y: event.clientY };
      const from = box;
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
        setBox(
          dragBox(
            original,
            from,
            handle,
            (next.clientX - start.x) / at,
            (next.clientY - start.y) / at,
            ratio,
          ),
        );
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    };

  /** Arrow keys move the box, or the edge of the handle with focus. */
  const nudge = (handle: BoxHandle | 'move') => (event: KeyboardEvent) => {
    if (locked || !original || !box) return;
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
    setBox(dragBox(original, box, handle, move[0], move[1], ratio));
  };

  /** Back to the whole picture (or the largest box of the shape). */
  const reset = () => {
    if (locked || !original) return;
    if (ratio) setBox(shapeBox(original, wholeBox(original), ratio));
    else onChange({ left: 0, top: 0, width: 0, height: 0 });
  };

  const onScreen = (rect: FrameRect) => ({
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={stage}
        className="relative aspect-video touch-none overflow-hidden rounded-2xl select-none"
      >
        {source && (
          <div
            className="absolute top-1/2 left-1/2 -translate-1/2 rounded-[10px] bg-black"
            style={
              original && scale > 0
                ? {
                    width: original.width * scale,
                    height: original.height * scale,
                  }
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
            {box && scale > 0 && (
              <>
                {/* What is cut away, dimmed: the box's shadow, kept to the
                    video. */}
                <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[10px]">
                  <span
                    className="absolute shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]"
                    style={onScreen(box)}
                  />
                </span>
                {/* The box: dragged to move it, its handles to size it. */}
                <span
                  role="slider"
                  tabIndex={locked ? -1 : 0}
                  aria-label="Crop box: drag to move, double-click for the whole picture"
                  aria-valuenow={box.x}
                  aria-valuetext={`${sizeLabel(box)} at ${box.x}, ${box.y}`}
                  onPointerDown={drag('move')}
                  onKeyDown={nudge('move')}
                  onDoubleClick={reset}
                  className={`absolute ring-1 ring-white/90 outline-none focus-visible:ring-2 focus-visible:ring-brand ${locked ? '' : 'cursor-move'}`}
                  style={onScreen(box)}
                >
                  {held !== null && (
                    // Thirds, to line things up by.
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                    >
                      <span className="absolute inset-y-0 left-1/3 w-px bg-white/50" />
                      <span className="absolute inset-y-0 left-2/3 w-px bg-white/50" />
                      <span className="absolute inset-x-0 top-1/3 h-px bg-white/50" />
                      <span className="absolute inset-x-0 top-2/3 h-px bg-white/50" />
                    </span>
                  )}
                  <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                    {sizeLabel(box)}
                  </span>
                  {!locked &&
                    handles.map((handle) => (
                      <span
                        key={handle.name}
                        role="slider"
                        tabIndex={0}
                        aria-label={`${handle.name}: drag to resize`}
                        aria-valuenow={box.width}
                        aria-valuetext={sizeLabel(box)}
                        onPointerDown={drag(handle)}
                        onKeyDown={nudge(handle)}
                        className={`absolute border-brand bg-brand outline-none drop-shadow-sm before:absolute before:-inset-2 focus-visible:ring-2 focus-visible:ring-brand/50 ${handleShape(handle)} ${handle.cursor}`}
                        style={handleStyle(handle, 0)}
                      />
                    ))}
                </span>
              </>
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
          {box && original ? (
            whole ? (
              <span className="text-ink-soft">
                Drag the edges to choose what to keep
              </span>
            ) : (
              <>
                <span className="font-medium text-ink">{sizeLabel(box)}</span>
                <span className="text-ink-soft">
                  {' '}
                  (cut from {sizeLabel(original)})
                </span>
              </>
            )
          ) : null}
        </span>
      </div>
    </div>
  );
}
