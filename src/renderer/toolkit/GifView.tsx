import {
  type CSSProperties,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { defaultDelay, gifDelays, gifPlays } from '../../shared/gif';
import { clock } from '../../shared/tools';
import { LoaderCircle, Play, X } from '../components/icons';
import { Pause } from './playerIcons';

// GIFs, played in the page: decoded frame by frame with WebCodecs'
// ImageDecoder and drawn on a canvas, so they can be paused, stepped and
// scrubbed like a video (an <img> only loops). The bytes come from the main
// process (a preview, or a finished output), so no file URL is needed.

/** What a GIF is, once read. */
export type GifInfo = {
  width: number;
  height: number;
  frames: number;
  /** When each frame shows, in ms from the start, and the whole length. */
  starts: number[];
  length: number;
  /** How many times it plays through: Infinity if it loops (see gifPlays). */
  plays: number;
};

/**
 * Plays GIF `bytes` on `canvas`: its size and frame count once read, the
 * frame shown, and play, pause and seek. Starts playing if `autoPlay`.
 * Frames are decoded as they are shown, never all at once, so a long GIF
 * takes no more memory than a short one.
 */
export function useGif(
  bytes: Uint8Array | null,
  canvas: RefObject<HTMLCanvasElement | null>,
  autoPlay = true,
) {
  const [info, setInfo] = useState<GifInfo | null>(null);
  const [failed, setFailed] = useState('');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const decoder = useRef<ImageDecoder | null>(null);
  /** The running playback loop, stopped by setting `stop`. */
  const loop = useRef<{ stop: boolean } | null>(null);
  const shown = useRef(0);
  /** Each frame's delay, as read from the GIF (see gifDelays). */
  const delays = useRef<number[] | null>(null);
  /** How many times it plays through, as its own loop setting says. */
  const plays = useRef(Infinity);

  /** Decodes and draws frame `at`; false if the GIF has gone since. */
  const draw = useCallback(
    async (at: number, from: ImageDecoder) => {
      const { image } = await from.decode({ frameIndex: at });
      try {
        if (decoder.current !== from) return null;
        const element = canvas.current;
        const context = element?.getContext('2d');
        if (element && context) {
          context.clearRect(0, 0, element.width, element.height);
          context.drawImage(image, 0, 0, element.width, element.height);
        }
        shown.current = at;
        setIndex(at);
        return (
          delays.current?.[at] ??
          (image.duration ? image.duration / 1000 : defaultDelay)
        );
      } finally {
        image.close();
      }
    },
    [canvas],
  );

  const stop = useCallback(() => {
    if (loop.current) loop.current.stop = true;
    loop.current = null;
    setPlaying(false);
  }, []);

  /** Plays from frame `from` on, as many times through as the GIF says
   *  (over and over if it loops), stopping on its last frame after the
   *  last time, or once stopped. */
  const start = useCallback(
    (from: number) => {
      const gif = decoder.current;
      const count = gif?.tracks.selectedTrack?.frameCount ?? 0;
      if (!gif || count < 1) return;
      if (loop.current) loop.current.stop = true;
      const run = { stop: false };
      loop.current = run;
      setPlaying(true);
      void (async () => {
        let at = from;
        let times = 1;
        let due = performance.now();
        while (!run.stop) {
          let delay: number | null;
          try {
            delay = await draw(at, gif);
          } catch {
            break;
          }
          if (run.stop || delay === null) break;
          // Its last frame, the last time through: it stays there.
          if (at === count - 1 && times >= plays.current) {
            if (loop.current === run) {
              loop.current = null;
              setPlaying(false);
            }
            break;
          }
          // On the GIF's own clock; after a stall, from now.
          due += Math.max(delay, 20);
          const wait = due - performance.now();
          if (wait < -250) due = performance.now();
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, wait)),
          );
          at = (at + 1) % count;
          if (at === 0) times++;
        }
      })();
    },
    [draw],
  );

  // A new GIF: read it, size the canvas, show its first frame.
  useEffect(() => {
    stop();
    setInfo(null);
    setFailed('');
    setIndex(0);
    if (!bytes) return;
    if (typeof ImageDecoder === 'undefined') {
      setFailed("GIFs can't be played here.");
      return;
    }
    const gif = new ImageDecoder({ data: bytes, type: 'image/gif' });
    decoder.current = gif;
    let live = true;
    void (async () => {
      try {
        await gif.tracks.ready;
        await gif.completed;
        const track = gif.tracks.selectedTrack;
        const { image } = await gif.decode({ frameIndex: 0 });
        const width = image.displayWidth;
        const height = image.displayHeight;
        const first = image.duration ? image.duration / 1000 : defaultDelay;
        image.close();
        if (!live) return;
        const element = canvas.current;
        if (element) {
          element.width = width;
          element.height = height;
        }
        const frames = track?.frameCount ?? 1;
        const read = gifDelays(bytes);
        const each =
          read && read.length === frames
            ? read
            : Array.from({ length: frames }, () => first);
        delays.current = each;
        plays.current = gifPlays(bytes) ?? Infinity;
        const starts: number[] = [];
        let length = 0;
        for (const delay of each) {
          starts.push(length);
          length += delay;
        }
        setInfo({
          width,
          height,
          frames,
          starts,
          length,
          plays: plays.current,
        });
        if (autoPlay) start(0);
        else await draw(0, gif);
      } catch {
        if (live) setFailed("This GIF can't be read.");
      }
    })();
    return () => {
      live = false;
      if (loop.current) loop.current.stop = true;
      loop.current = null;
      decoder.current = null;
      gif.close();
    };
    // Once per GIF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  const toggle = useCallback(() => {
    if (!info) return;
    if (loop.current) stop();
    else start((shown.current + 1) % info.frames);
  }, [info, start, stop]);

  /** Shows frame `at`, playing on from it if it was playing. */
  const seek = useCallback(
    (at: number) => {
      const gif = decoder.current;
      if (!gif || !info) return;
      const frame =
        ((Math.round(at) % info.frames) + info.frames) % info.frames;
      if (loop.current) start(frame);
      else void draw(frame, gif).catch(() => {});
    },
    [draw, info, start],
  );

  return { info, failed, index, playing, toggle, seek, stop };
}

/** Seconds into the GIF at frame `index`, and its whole length. */
export const gifTimes = (info: GifInfo, index: number) => ({
  at: (info.starts[index] ?? 0) / 1000,
  total: info.length / 1000,
});

/**
 * A thin bar along a GIF's frames: how far it has played, and a press or
 * drag anywhere on it goes to that frame.
 */
export function GifScrubber({
  info,
  index,
  onSeek,
  tone = 'light',
}: {
  info: GifInfo;
  index: number;
  onSeek: (frame: number) => void;
  /** Light on a card, dark over a picture. */
  tone?: 'light' | 'dark';
}) {
  const bar = useRef<HTMLDivElement>(null);
  const frameAt = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect();
    if (!box || !box.width) return 0;
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    // The frame showing at that moment.
    const moment = share * info.length;
    let frame = 0;
    while (frame + 1 < info.frames && info.starts[frame + 1] <= moment) {
      frame++;
    }
    return frame;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    onSeek(frameAt(event.clientX));
    const move = (next: globalThis.PointerEvent) =>
      onSeek(frameAt(next.clientX));
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };
  const last = info.starts[info.frames - 1] ?? 0;
  const share = last > 0 ? (info.starts[index] ?? 0) / last : 1;
  const { at, total } = gifTimes(info, index);
  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={-1}
      aria-label="Frame"
      aria-valuemin={1}
      aria-valuemax={info.frames}
      aria-valuenow={index + 1}
      aria-valuetext={`Frame ${index + 1} of ${info.frames}, ${clock(at)} of ${clock(total)}`}
      onPointerDown={onPointerDown}
      className="group relative flex h-4 min-w-0 flex-1 cursor-pointer touch-none items-center"
    >
      <span
        className={`h-1 w-full overflow-hidden rounded-full ${tone === 'dark' ? 'bg-white/25' : 'bg-line'}`}
      >
        <span
          className={`block h-full ${tone === 'dark' ? 'bg-white' : 'bg-ink'}`}
          style={{ width: `${share * 100}%` }}
        />
      </span>
      <span
        className={`absolute size-3 -translate-x-1/2 rounded-full opacity-0 shadow-sm transition-opacity group-hover:opacity-100 ${tone === 'dark' ? 'bg-white' : 'bg-ink'}`}
        style={{ left: `${share * 100}%` }}
      />
    </div>
  );
}

/**
 * A GIF over the page, as the video player shows a video, but with only
 * what a GIF needs: it loops on its own, with Play and Pause, a bar to
 * scrub its frames, and its time. Space or K plays and pauses; ← and →
 * step a frame (pausing it); Esc closes, as does a click outside it.
 */
export function GifPlayerModal({
  load,
  title,
  onClose,
}: {
  /** The GIF's bytes, asked for when the player opens. */
  load: () => Promise<Uint8Array>;
  title: string;
  onClose: () => void;
}) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loadFailed, setLoadFailed] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const gif = useGif(bytes, canvas);
  const { info, index, playing, toggle, seek, stop } = gif;
  const failed = loadFailed || gif.failed;

  useEffect(() => {
    let live = true;
    load().then(
      (found) => live && setBytes(found),
      (error: unknown) =>
        live &&
        setLoadFailed(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus moves into the player, so keys reach it and not the page behind.
  useEffect(() => frame.current?.focus(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const onButton =
        event.target instanceof Element && event.target.closest('button');
      switch (event.key) {
        case 'Escape':
          onClose();
          break;
        case ' ':
        case 'k':
          if (onButton && event.key === ' ') return;
          toggle();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (!info) return;
          stop();
          seek(index + (event.key === 'ArrowLeft' ? -1 : 1));
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, toggle, seek, stop, info, index]);

  const ratio = info ? info.width / info.height : 16 / 9;
  const times = info ? gifTimes(info, index) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {!info && !failed && (
        <LoaderCircle
          size={26}
          aria-label="Loading"
          className="absolute animate-spin text-white/70"
        />
      )}
      <div
        ref={frame}
        role="dialog"
        aria-modal
        tabIndex={-1}
        aria-label={`Playing ${title}`}
        style={{ '--ratio': ratio } as CSSProperties}
        // Never larger than 80% of the window, nor than twice its own size.
        className={`flex max-w-[80vw] flex-col overflow-hidden rounded-2xl bg-black text-white shadow-popup outline-none select-none transition-[opacity,scale] duration-200 ease-out motion-reduce:transition-none ${
          info || failed ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <div
          className="relative aspect-(--ratio) w-[min(80vw,calc((80vh-56px)*var(--ratio)))]"
          style={info ? { maxWidth: info.width * 2 } : undefined}
        >
          <canvas
            ref={canvas}
            onClick={toggle}
            className="absolute inset-0 size-full cursor-pointer object-contain [image-rendering:auto]"
          />
          {failed && (
            <p className="absolute inset-0 grid place-items-center px-8 text-center text-[14px] text-white/80">
              {failed}
            </p>
          )}
          <button
            type="button"
            aria-label="Close player"
            title="Close (Esc)"
            onClick={onClose}
            className="absolute top-3 right-3 grid size-8 cursor-pointer place-items-center rounded-full bg-black/40 backdrop-blur-xl hover:bg-black/60"
          >
            <X size={16} />
          </button>
        </div>
        {info && times && (
          <div className="flex h-14 items-center gap-3 px-3">
            <button
              type="button"
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
              onClick={toggle}
              className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-white/15"
            >
              {playing ? (
                <Pause size={20} />
              ) : (
                <Play size={20} filled className="translate-x-px" />
              )}
            </button>
            <GifScrubber
              info={info}
              index={index}
              tone="dark"
              onSeek={(at) => {
                stop();
                seek(at);
              }}
            />
            <span className="shrink-0 text-[12px] text-white/80 tabular-nums">
              {clock(times.at)} / {clock(times.total)}
            </span>
            <span
              title={title}
              className="hidden max-w-48 shrink truncate text-[12px] text-white/60 sm:block"
            >
              {title}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
