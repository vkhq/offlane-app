import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { clock } from '../../shared/tools';
import type { MediaRef } from '../../shared/types';
import { ChevronLeft, ChevronRight, LoaderCircle } from '../components/icons';
import { PlayButton, useEditorVideo } from './editorVideo';
import type { ToolEditorProps } from './standardTool';

/** The shortest part that can be kept, in seconds. */
const shortest = 0.1;
/** The video track's height, and its frames', in px. */
const trackHeight = 56;

/** A ruler label: whole seconds as "0:05", or "0:02.5" between them. */
const rulerLabel = (seconds: number) => {
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const h = Math.floor(m / 60);
  const ss = String(whole % 60).padStart(2, '0');
  const tenth = Math.round((seconds - whole) * 10);
  const base = h
    ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}`
    : `${m}:${ss}`;
  return tenth ? `${base}.${tenth}` : base;
};

/** Steps between ruler labels, in seconds: the first leaving ~72px. */
const rulerSteps = [
  0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200,
];

const round = (seconds: number) => Math.round(seconds * 100) / 100;
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** Frames by file, moment and height, asked of the main process once. */
const frames = new Map<string, Promise<string | null>>();

/**
 * Trim Video's editor, in the manner of a video editor's timeline: the
 * video on top, and under it a play button and a track of its frames,
 * with the part to keep framed by a handle at each end. Dragging a handle
 * sets Start or End (the `start` and `end` options, in seconds) and shows
 * that moment in the video while it is held, leaving the playhead where
 * it is; the playhead, a line across the track with its time on top,
 * moves on its own and shows its moment too.
 *
 * Play (or Space) plays from the playhead, stopping at End if it starts
 * before it (from the beginning if the playhead is at the very end).
 * Left and Right move the playhead 5 seconds; Up and Down move it to the
 * next or previous of the video's start, Start, End and the video's end.
 * Once the tool has run, the handles are fixed, as the record of the cut.
 */
export function TrimEditor({
  media,
  values,
  onChange,
  locked,
}: ToolEditorProps) {
  const video = useRef<HTMLVideoElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const { source, failed, mediaKey } = useEditorVideo(media);
  const [duration, setDuration] = useState<number | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [width, setWidth] = useState(0);

  /** Whether playing stops at End: only if it started before it. */
  const stopAtEnd = useRef(true);

  // A new file starts from its beginning, its length not yet known.
  useEffect(() => {
    setDuration(null);
    setTime(0);
  }, [mediaKey]);
  useEffect(() => {
    if (source?.aspect) setAspect(source.aspect);
  }, [source]);

  // The track's width, for their frames, ruler and handles.
  useLayoutEffect(() => {
    const element = lane.current;
    if (!element) return;
    const watch = new ResizeObserver(() => setWidth(element.clientWidth));
    watch.observe(element);
    setWidth(element.clientWidth);
    return () => watch.disconnect();
  }, []);

  const start = Number(values.start ?? 0);
  const end = Number(values.end ?? 0);
  const keep = (next: { start: number; end: number }) =>
    onChange({ start: round(next.start), end: round(next.end) });

  // Once its length is known: a fresh editor keeps the whole video, and
  // a range from another video is fitted to this one.
  useEffect(() => {
    if (!duration || locked) return;
    const fresh = start === 0 && end === 10 && duration !== 10;
    if (fresh || end > duration || start >= end) {
      const fittedStart = start < duration - shortest ? start : 0;
      keep({
        start: fittedStart,
        end: fresh || end > duration || end <= fittedStart ? duration : end,
      });
    }
    // Only when the length becomes known, not on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  // Times typed into the options are fitted to the video: End no later
  // than its end, and Start at least the shortest part before End.
  useEffect(() => {
    if (!duration || locked) return;
    const fittedEnd = clamp(end, shortest, duration);
    const fittedStart = clamp(start, 0, fittedEnd - shortest);
    if (fittedEnd !== end || fittedStart !== start) {
      keep({ start: fittedStart, end: fittedEnd });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  // The playhead follows the video while it plays, and it stops at End
  // if it started before it.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const element = video.current;
      // Paused (by a handle's peek, say), its moment isn't the playhead's.
      if (!element || element.paused) return;
      if (stopAtEnd.current && element.currentTime >= end) {
        element.pause();
        element.currentTime = end;
      }
      setTime(element.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, end]);

  /** A moment asked for while the video was still seeking to another. */
  const queued = useRef<number | null>(null);
  /**
   * Puts the video at `seconds`, one seek at a time: while one is under
   * way, only the latest moment asked for is kept, and gone to once it
   * lands (onSeeked). A handle dragged fast would otherwise start dozens
   * of seeks at once, which can leave the picture black.
   */
  const goTo = (seconds: number) => {
    const element = video.current;
    if (!element) return;
    if (element.seeking) {
      queued.current = seconds;
      return;
    }
    queued.current = null;
    element.currentTime = seconds;
  };
  const onSeeked = () => {
    const next = queued.current;
    if (next === null || !video.current) return;
    queued.current = null;
    video.current.currentTime = next;
  };

  /** How many times the picture has been brought back (see recover). */
  const recoveries = useRef(0);
  /**
   * Reloads the video at the playhead if it has failed or has no picture
   * (still seeking, or nothing decoded); a couple of times at most, so a
   * file that can't play doesn't reload forever.
   */
  const recover = () => {
    const element = video.current;
    if (!element || recoveries.current >= 3) return;
    recoveries.current++;
    const at = element.paused ? time : element.currentTime;
    queued.current = null;
    element.addEventListener(
      'loadeddata',
      () => {
        element.currentTime = at;
      },
      { once: true },
    );
    element.load();
  };
  /** Checks the picture a moment after a handle is let go. */
  const watch = useRef<number | undefined>(undefined);
  const checkSoon = () => {
    window.clearTimeout(watch.current);
    watch.current = window.setTimeout(() => {
      const element = video.current;
      if (
        element &&
        (element.error || element.seeking || element.readyState < 2)
      ) {
        recover();
      }
    }, 2000);
  };
  useEffect(() => () => window.clearTimeout(watch.current), []);

  const seek = (seconds: number) => {
    const at = clamp(seconds, 0, duration ?? 0);
    setTime(at);
    // Playing on from before End still stops there; from after it, not.
    stopAtEnd.current = at < end - 0.05;
    goTo(at);
  };

  /** Shows the frame at `seconds` without moving the playhead (a handle's
   *  moment, while it is moved); the next play or seek goes back to it. */
  const peek = (seconds: number) => {
    const element = video.current;
    if (!element) return;
    if (!element.paused) {
      // The playhead stays where playing had got to.
      element.pause();
      setTime(element.currentTime);
    }
    goTo(clamp(seconds, 0, duration ?? 0));
  };

  /** Back to the playhead's frame after a peek (if not playing). */
  const unpeek = () => {
    const element = video.current;
    if (!element) return;
    if (
      element.paused &&
      (queued.current !== null || element.currentTime !== time)
    ) {
      goTo(time);
    }
    checkSoon();
  };

  const toggle = () => {
    const element = video.current;
    if (!element || !duration) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    // From the playhead; at the very end, from the beginning.
    seek(time >= duration - 0.05 ? 0 : time);
    void element.play().catch(() => {});
  };

  /** The keys the editor answers anywhere on the page: Space plays and
   *  pauses; Left and Right move the playhead 5 seconds; Up and Down move
   *  it to the next or previous of 0, Start, End and the video's end. */
  const onKey = (event: globalThis.KeyboardEvent) => {
    if (!duration) return;
    const element = video.current;
    // Where the playhead is: the video's moment while it plays.
    const now = element && !element.paused ? element.currentTime : time;
    switch (event.key) {
      case ' ':
        if (event.repeat) return;
        toggle();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        seek(now + (event.key === 'ArrowLeft' ? -5 : 5));
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        const stops = [0, start, end, duration];
        const next =
          event.key === 'ArrowUp'
            ? stops.filter((at) => at > now + 0.01).sort((a, b) => a - b)[0]
            : stops.filter((at) => at < now - 0.01).sort((a, b) => b - a)[0];
        if (next !== undefined) seek(next);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const listen = (event: globalThis.KeyboardEvent) => {
      // Not if a handle (nudged by its arrows) or a field, button or menu
      // has it, nor with a modifier.
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, button, a, [contenteditable="true"], [role="menu"], [role="listbox"], [role="dialog"], [aria-label="Start"], [aria-label="End"]',
        )
      ) {
        return;
      }
      onKeyRef.current(event);
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, []);

  const x = (seconds: number) =>
    duration ? (clamp(seconds, 0, duration) / duration) * width : 0;
  const timeAt = (clientX: number) => {
    const box = lane.current?.getBoundingClientRect();
    if (!box || !duration || !box.width) return 0;
    return clamp(((clientX - box.left) / box.width) * duration, 0, duration);
  };

  /**
   * Follows a drag from `event` until the button is let go. Its moves and
   * release are heard on the window, wherever the pointer goes (even if
   * the element loses hold of it), and a move with no button held ends it
   * too: a drag whose release was missed must never follow the pointer.
   */
  const follow = (
    event: PointerEvent<HTMLElement>,
    move: (seconds: number) => void,
    done?: () => void,
  ) => {
    if (event.button !== 0 || !duration) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const id = event.pointerId;
    try {
      target.setPointerCapture(id);
    } catch {
      // Without it the window still hears the drag.
    }
    move(timeAt(event.clientX));
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      done?.();
    };
    const onMove = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== id) return;
      if ((next.buttons & 1) === 0) return end();
      move(timeAt(next.clientX));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /** Drags one handle: Start can't pass End, nor End Start. */
  const dragHandle =
    (which: 'start' | 'end') => (event: PointerEvent<HTMLElement>) => {
      if (locked || !duration) return;
      follow(
        event,
        (seconds) => {
          const next =
            which === 'start'
              ? { start: clamp(seconds, 0, end - shortest), end }
              : { start, end: clamp(seconds, start + shortest, duration) };
          // The options show it as it moves.
          keep(next);
          // The video shows the moment the handle is at, while it is held.
          peek(next[which]);
        },
        // Then the playhead's moment again.
        unpeek,
      );
    };

  /** Arrow keys nudge a handle by a tenth of a second, a second with Shift. */
  const nudge = (which: 'start' | 'end') => (event: KeyboardEvent) => {
    if (locked || !duration) return;
    const by =
      event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!by) return;
    event.preventDefault();
    const step = by * (event.shiftKey ? 1 : 0.1);
    const next =
      which === 'start'
        ? { start: clamp(start + step, 0, end - shortest), end }
        : { start, end: clamp(end + step, start + shortest, duration) };
    keep(next);
    peek(next[which]);
  };

  const length = Math.max(0, end - start);
  const tileWidth = trackHeight * aspect;
  const tiles = duration && width ? Math.ceil(width / tileWidth) : 0;
  const step = duration
    ? (rulerSteps.find((candidate) => (candidate / duration) * width >= 72) ??
      rulerSteps.at(-1)!)
    : 0;
  const marks = step && duration ? Math.floor(duration / step + 1e-6) + 1 : 0;
  // The playhead's time sits on its top, kept inside the track.
  const tagWidth = (duration ?? 0) >= 3600 ? 78 : 60;
  const tagLeft =
    clamp(x(time) - tagWidth / 2, 0, Math.max(0, width - tagWidth)) - x(time);

  return (
    <div className="flex flex-col gap-3">
      {/* The video. */}
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
        {source && (
          <video
            ref={video}
            src={source.url}
            preload="auto"
            playsInline
            onClick={toggle}
            onLoadedMetadata={(event) => {
              const element = event.currentTarget;
              if (Number.isFinite(element.duration)) {
                setDuration(element.duration);
              }
              if (element.videoWidth && element.videoHeight) {
                setAspect(element.videoWidth / element.videoHeight);
              }
            }}
            onSeeked={onSeeked}
            onError={recover}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            className="size-full cursor-pointer object-contain"
          />
        )}
        {!source && (
          <span className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-white/70">
            {failed ? (
              failed
            ) : (
              <span className="flex items-center gap-2">
                <LoaderCircle size={14} className="animate-spin" />
                Getting the video ready…
              </span>
            )}
          </span>
        )}
      </div>

      {/* The timeline: where the playhead is, and what is kept. */}
      <div className="rounded-2xl bg-canvas px-3 pt-2.5 pb-3 shadow-card">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-1 pb-1.5 text-[12px] tabular-nums">
          <span>
            <span className="font-semibold">{clock(time)}</span>
            <span className="text-ink-faint">
              {' '}
              / {duration ? clock(duration) : '–:––.––'}
            </span>
          </span>
          <PlayButton
            playing={playing}
            disabled={!source || !duration}
            onClick={toggle}
          />
          {duration ? (
            <span className="justify-self-end text-ink-soft">
              {clock(start)} – {clock(end)}
              <span className="text-ink-faint"> · </span>
              <span className="font-medium text-ink">{clock(length)}</span>
            </span>
          ) : null}
        </div>
        <div className="flex">
          <div
            ref={lane}
            // Dragging anywhere but a handle moves the playhead.
            onPointerDown={(event) => follow(event, seek)}
            className="relative flex min-w-0 flex-1 cursor-pointer touch-none flex-col gap-1.5 select-none"
          >
            {/* The ruler. */}
            <div className="relative h-7 text-[11px] font-medium text-ink-soft tabular-nums">
              {Array.from({ length: marks }, (_, index) => {
                const at = index * step;
                const left = x(at);
                // A label too near the right edge would be cut off.
                const labelled = left < width - 32;
                return (
                  <span key={at}>
                    <span
                      className="absolute bottom-0 h-2.5 w-px bg-ink-faint"
                      style={{ left }}
                    />
                    {step / 2 >= 0.5 && x(at + step / 2) < width && (
                      <span
                        className="absolute bottom-0 h-1.5 w-px bg-line"
                        style={{ left: x(at + step / 2) }}
                      />
                    )}
                    {labelled && (
                      <span
                        className={`absolute top-1 leading-none ${index === 0 ? '' : '-translate-x-1/2'}`}
                        style={{ left }}
                      >
                        {rulerLabel(at)}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>

            {/* The video track: frames along its length. */}
            <div className="relative flex h-14 overflow-hidden rounded-lg bg-group">
              {media &&
                duration &&
                Array.from({ length: tiles }, (_, index) => (
                  <Frame
                    key={`${mediaKey}:${index}:${tiles}`}
                    media={media}
                    mediaKey={mediaKey}
                    width={tileWidth}
                    seconds={Math.min(
                      duration - 0.05,
                      (((index + 0.5) * tileWidth) / width) * duration,
                    )}
                  />
                ))}
            </div>

            {/* What is cut, washed out, and the part kept, framed by its
                handles. */}
            {duration ? (
              <div className="pointer-events-none absolute inset-x-0 top-8.5 bottom-0">
                <span
                  className="absolute inset-y-0 left-0 rounded-l-lg bg-canvas/70"
                  style={{ width: x(start) }}
                />
                <span
                  className="absolute inset-y-0 right-0 rounded-r-lg bg-canvas/70"
                  style={{ width: width - x(end) }}
                />
                <div
                  className="absolute inset-y-0 rounded-lg border-y-2 border-brand"
                  style={{ left: x(start), width: x(end) - x(start) }}
                >
                  <Handle
                    side="start"
                    seconds={start}
                    locked={locked}
                    onPointerDown={dragHandle('start')}
                    onKeyDown={nudge('start')}
                    onBlur={unpeek}
                  />
                  <Handle
                    side="end"
                    seconds={end}
                    locked={locked}
                    onPointerDown={dragHandle('end')}
                    onKeyDown={nudge('end')}
                    onBlur={unpeek}
                  />
                </div>
              </div>
            ) : null}

            {/* The playhead, across the ruler and the track, its time on
                top (where it is dragged from). */}
            {duration ? (
              <div
                className="pointer-events-none absolute inset-y-0 w-0"
                style={{ left: x(time) }}
              >
                <span className="absolute top-4 bottom-0 left-[-1px] w-0.5 bg-accent" />
                <span
                  role="slider"
                  tabIndex={0}
                  aria-label="Playhead"
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={time}
                  aria-valuetext={clock(time)}
                  // Its keys are the editor's (see onKey).
                  onPointerDown={(event) => follow(event, seek)}
                  className="pointer-events-auto absolute top-0 grid h-5 cursor-ew-resize place-items-center rounded-md bg-accent text-[11px] font-semibold text-accent-ink tabular-nums shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  style={{ left: tagLeft, width: tagWidth }}
                >
                  {clock(time)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One end of the part kept: a tab across the track, to drag. */
function Handle({
  side,
  seconds,
  locked,
  onPointerDown,
  onKeyDown,
  onBlur,
}: {
  side: 'start' | 'end';
  seconds: number;
  locked: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onBlur: () => void;
}) {
  const Chevron = side === 'start' ? ChevronLeft : ChevronRight;
  return (
    <span
      role="slider"
      tabIndex={locked ? -1 : 0}
      aria-label={side === 'start' ? 'Start' : 'End'}
      aria-valuetext={clock(seconds)}
      aria-valuenow={seconds}
      aria-disabled={locked}
      title={`${side === 'start' ? 'Start' : 'End'} ${clock(seconds)}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={`pointer-events-auto absolute -inset-y-0.5 grid w-3 place-items-center bg-brand text-white outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
        side === 'start' ? '-left-0.5 rounded-l-lg' : '-right-0.5 rounded-r-lg'
      } ${locked ? 'cursor-default' : 'cursor-ew-resize'}`}
    >
      <Chevron size={12} strokeWidth={3} />
    </span>
  );
}

/** One frame along the video track, asked for once. */
function Frame({
  media,
  mediaKey,
  width,
  seconds,
}: {
  media: MediaRef;
  mediaKey: string;
  width: number;
  seconds: number;
}) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // To the tenth of a second: near enough, and shared between widths.
    const at = Math.round(seconds * 10) / 10;
    const key = `${mediaKey}:${at}`;
    let found = frames.get(key);
    if (!found) {
      found = window.media.frame(media, at, trackHeight * 2);
      found.catch(() => frames.delete(key));
      frames.set(key, found);
    }
    found.then(
      (made) => live && setImage(made),
      () => {},
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey, seconds]);
  return (
    <span
      className="h-full shrink-0 border-r border-black/20 bg-group bg-cover bg-center last:border-r-0"
      style={{
        width,
        backgroundImage: image ? `url("${image}")` : undefined,
      }}
    />
  );
}
