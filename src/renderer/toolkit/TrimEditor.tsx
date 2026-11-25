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
import { useTabView } from '../tabState';
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Minus,
  MoveHorizontal,
  Plus,
} from '../components/icons';
import { PlayButton, useEditorVideo } from './editorVideo';
import type { ToolEditorProps } from './standardTool';
import { iconButton, smallButton } from './styles';

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
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200,
];
/** The handles' width at rest, in px. */
const handleWidth = 12;
/** Zoomed all the way in, this many seconds fill the timeline. */
const closest = 0.5;
/** How near the timeline's edge a drag scrolls it, in px. */
const edgeZone = 28;

const round = (seconds: number) => Math.round(seconds * 100) / 100;
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** How long a frame's moment must rest (zooming, scrolling) before it is
 *  asked for, in ms. */
const frameSettle = 120;
/** How many frames are asked of the main process at once. */
const framesAtOnce = 3;
/** How many frames off either side of the timeline on show are drawn. */
const framesAside = 3;

/** Frames made, by file and then moment, as data: URLs. */
const madeFrames = new Map<string, Map<number, string>>();
/** Frames asked of the main process, made or being made, by file:moment. */
const askedFrames = new Map<string, Promise<string | null>>();
/** A frame waiting its turn, and those waiting for it. */
type FrameAsk = {
  key: string;
  mediaKey: string;
  at: number;
  start: () => void;
  listeners: Set<(image: string | null) => void>;
};
/** Waiting frames, in the order asked. */
const frameQueue: FrameAsk[] = [];
let framesAsked = 0;
/** The moment in the middle of the timeline on show (see TrimEditor): the
 *  frames nearest it are made first, those just off either side after. */
let frameFocus: { mediaKey: string; seconds: number } | null = null;

/** A pumpFrames waiting to run (see schedulePump). */
let pumpSoon: number | undefined;
/**
 * Pumps once the frames asked for together are all in the queue (they are
 * asked a few ms apart), so the nearest of them, not the first, go first.
 */
function schedulePump() {
  if (pumpSoon !== undefined) return;
  pumpSoon = window.setTimeout(() => {
    pumpSoon = undefined;
    pumpFrames();
  }, 16);
}

/** Starts the waiting frames nearest the middle of the timeline on show,
 *  a few at a time. */
function pumpFrames() {
  while (framesAsked < framesAtOnce && frameQueue.length > 0) {
    let next = frameQueue.length - 1;
    if (frameFocus) {
      const focus = frameFocus;
      const off = (ask: FrameAsk) =>
        ask.mediaKey === focus.mediaKey
          ? Math.abs(ask.at - focus.seconds)
          : Infinity;
      for (let index = 0; index < frameQueue.length; index++) {
        if (off(frameQueue[index]) < off(frameQueue[next])) next = index;
      }
    }
    frameQueue.splice(next, 1)[0].start();
  }
}

/**
 * The frame of `mediaKey` at `at` seconds, to `onFrame` once made. Asked of
 * the main process once, a few at a time, the latest first. Returns a
 * cancel: a frame no one waits for any more is never asked for.
 */
function askFrame(
  media: MediaRef,
  mediaKey: string,
  at: number,
  onFrame: (image: string | null) => void,
): () => void {
  const key = `${mediaKey}:${at}`;
  let live = true;
  const listener = (image: string | null) => live && onFrame(image);
  const asked = askedFrames.get(key);
  if (asked) {
    asked.then(listener, () => {});
    return () => {
      live = false;
    };
  }
  let waiting = frameQueue.find((ask) => ask.key === key);
  if (waiting) {
    // Asked again: to the front of the line.
    frameQueue.splice(frameQueue.indexOf(waiting), 1);
  } else {
    const ask: FrameAsk = {
      key,
      mediaKey,
      at,
      listeners: new Set(),
      start: () => {
        framesAsked++;
        const made = window.media.frame(media, at, trackHeight * 2);
        askedFrames.set(key, made);
        made
          .then(
            (image) => {
              if (image) {
                const byMoment = madeFrames.get(mediaKey) ?? new Map();
                byMoment.set(at, image);
                madeFrames.set(mediaKey, byMoment);
              }
              for (const each of ask.listeners) each(image);
            },
            // Asked again next time.
            () => askedFrames.delete(key),
          )
          .finally(() => {
            framesAsked--;
            pumpFrames();
          });
      },
    };
    waiting = ask;
  }
  waiting.listeners.add(listener);
  frameQueue.push(waiting);
  schedulePump();
  const mine = waiting;
  return () => {
    live = false;
    mine.listeners.delete(listener);
    // No one waits for it: it needn't be made at all.
    const place = frameQueue.indexOf(mine);
    if (place >= 0 && mine.listeners.size === 0) frameQueue.splice(place, 1);
  };
}

/** The frame already made nearest to `at`, to show until its own is. */
function nearestFrame(mediaKey: string, at: number): string | null {
  let best: string | null = null;
  let distance = Infinity;
  for (const [moment, image] of madeFrames.get(mediaKey) ?? []) {
    const off = Math.abs(moment - at);
    if (off < distance) {
      distance = off;
      best = image;
    }
  }
  return best;
}

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
  clip,
}: ToolEditorProps & {
  /**
   * Seconds a fresh editor keeps from the middle of the video (all of a
   * shorter one), zoomed in so that part fills half the timeline, as
   * Video to GIF starts. Without it, a fresh editor keeps the whole video.
   */
  clip?: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  /** The track's whole length, zoomed; it scrolls inside `viewport`. */
  const lane = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  /** The timeline's card: a pinch anywhere on it zooms the timeline. */
  const timelineCard = useRef<HTMLDivElement>(null);
  const { source, failed, mediaKey } = useEditorVideo(media);
  const [duration, setDuration] = useState<number | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** The part of the track on show, in px, and how far along it is. */
  const [viewWidth, setViewWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  /** How many times longer the track is than the part on show. */
  const [zoom, setZoom] = useState(1);
  /** The zoom just asked for, ahead of the render that shows it. */
  const zoomNow = useRef(1);
  /** The handle being dragged: it thins to a line, to see what's under. */
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const width = viewWidth * zoom;
  /** How the timeline was left in this tab: kept while another tab shows. */
  const tabView = useTabView<{ zoom: number; center: number; time: number }>(
    `timeline:${mediaKey}`,
  );

  /** Whether playing stops at End: only if it started before it. */
  const stopAtEnd = useRef(true);

  // A new file starts from its beginning, its length not yet known, and
  // all of it on show.
  useEffect(() => {
    setDuration(null);
    setTime(0);
    setZoom(1);
    zoomNow.current = 1;
  }, [mediaKey]);
  useEffect(() => {
    if (source?.aspect) setAspect(source.aspect);
  }, [source]);

  // The width on show, for the frames, ruler and handles.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const watch = new ResizeObserver(() => setViewWidth(element.clientWidth));
    watch.observe(element);
    setViewWidth(element.clientWidth);
    return () => watch.disconnect();
  }, []);

  const start = Number(values.start ?? 0);
  const end = Number(values.end ?? 0);
  const keep = (next: { start: number; end: number }) =>
    onChange({ start: round(next.start), end: round(next.end) });

  // Once its length is known: a fresh editor keeps the whole video (or,
  // with `clip`, that much from its middle, zoomed in on), and a range
  // from another video is fitted to this one. Then the timeline is put
  // back as it was left in this tab, or, coming back with nothing to put
  // back (as after a reload), zoomed in on the part kept.
  useEffect(() => {
    if (!duration) return;
    let from = start;
    let to = end;
    if (!locked) {
      // Still the options' defaults: nothing set on this video yet.
      const untouched = start === 0 && end === 10;
      if (clip && untouched && duration > clip) {
        from = round(duration / 2 - clip / 2);
        keep({ start: from, end: from + clip });
        zoomToRange(from, from + clip, 0.5);
        // The playhead at its start: the video shows it, and Play plays it.
        seek(from);
        return;
      }
      const fresh = untouched && duration !== 10;
      if (fresh || end > duration || start >= end) {
        from = start < duration - shortest ? start : 0;
        to = fresh || end > duration || end <= from ? duration : end;
        keep({ start: from, end: to });
      }
    }
    const saved = tabView.read();
    if (saved) {
      zoomAround(saved.zoom, saved.center);
      seek(saved.time);
    } else if (to - from < duration - shortest) {
      zoomToRange(from, to, 0.5);
      seek(from);
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
        jumped.current = true;
        seek(now + (event.key === 'ArrowLeft' ? -5 : 5));
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        const stops = [0, start, end, duration];
        const next =
          event.key === 'ArrowUp'
            ? stops.filter((at) => at > now + 0.01).sort((a, b) => a - b)[0]
            : stops.filter((at) => at < now - 0.01).sort((a, b) => b - a)[0];
        if (next !== undefined) {
          jumped.current = true;
          seek(next);
        }
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

  /** Zoomed all the way in, `closest` seconds fill the part on show. */
  const maxZoom = duration
    ? Math.max(1, Math.min(1000, duration / closest))
    : 1;
  /** The moment to keep in place as the zoom changes, and where it was on
   *  show, in px; put back once the new length is laid out. */
  const anchor = useRef<{ seconds: number; offset: number } | null>(null);
  /**
   * Zooms to `next`, keeping a moment where it is on show: the one under
   * `clientX` (a pinch's pointer), else the playhead if it is on show, else
   * the one in the middle.
   */
  const zoomTo = (next: number, clientX?: number) => {
    const view = viewport.current;
    if (!view || !duration || !viewWidth) return;
    const current = zoomNow.current;
    const z = clamp(next, 1, maxZoom);
    if (Math.abs(z - current) < 1e-3) return;
    // Several turns of a pinch before a render keep the first's moment.
    if (!anchor.current) {
      const box = view.getBoundingClientRect();
      const lengthNow = viewWidth * current;
      let offset: number;
      if (clientX !== undefined) {
        offset = clamp(clientX - box.left, 0, box.width);
      } else {
        const playhead = (time / duration) * lengthNow - view.scrollLeft;
        offset =
          playhead >= 0 && playhead <= box.width ? playhead : box.width / 2;
      }
      anchor.current = {
        seconds: ((view.scrollLeft + offset) / lengthNow) * duration,
        offset,
      };
    }
    zoomNow.current = z;
    setZoom(z);
  };
  useLayoutEffect(() => {
    const view = viewport.current;
    const kept = anchor.current;
    anchor.current = null;
    if (!view || !kept || !duration) return;
    view.scrollLeft = (kept.seconds / duration) * width - kept.offset;
    setScrollLeft(view.scrollLeft);
    // Once the new length is laid out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  /** Zooms so the part kept fills most of the timeline, in the middle. */
  const zoomToSelection = () => zoomToRange(start, end, 0.8);
  /** Zooms to `next` with the moment `center` in the middle of the
   *  timeline, as it was left (see tabView). */
  const zoomAround = (next: number, center: number) => {
    if (!duration || !viewWidth) return;
    const z = clamp(next, 1, maxZoom);
    if (Math.abs(z - zoomNow.current) < 1e-3) return;
    anchor.current = { seconds: center, offset: viewWidth / 2 };
    zoomNow.current = z;
    setZoom(z);
  };
  // The middle of what is on show: its frames are made first.
  useEffect(() => {
    if (!duration || !viewWidth || !width) return;
    frameFocus = {
      mediaKey,
      seconds: ((scrollLeft + viewWidth / 2) / width) * duration,
    };
  }, [mediaKey, scrollLeft, viewWidth, width, duration]);

  // How the timeline is left, for when it comes back in this tab.
  useEffect(() => {
    if (!duration || !viewWidth || !width) return;
    tabView.write({
      zoom,
      center: ((scrollLeft + viewWidth / 2) / width) * duration,
      time,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, scrollLeft, viewWidth, duration, time]);
  /** Zooms so `from` to `to` fills `share` of the timeline, in the middle
   *  (all of the video, at least). */
  const zoomToRange = (from: number, to: number, share: number) => {
    if (!duration || !viewWidth) return;
    const middle = (from + to) / 2;
    const z = clamp(
      (duration / Math.max(to - from, shortest)) * share,
      1,
      maxZoom,
    );
    if (Math.abs(z - zoomNow.current) < 1e-3) {
      const view = viewport.current;
      if (view) view.scrollLeft = (middle / duration) * width - viewWidth / 2;
      return;
    }
    anchor.current = { seconds: middle, offset: viewWidth / 2 };
    zoomNow.current = z;
    setZoom(z);
  };

  // A pinch on a trackpad (a wheel turn with Control), or Command with a
  // mouse's wheel, anywhere on the timeline's card (its ruler, track, the
  // margin around them) zooms the timeline about the pointer, not the
  // canvas.
  const zoomAt = useRef(zoomTo);
  zoomAt.current = zoomTo;
  useEffect(() => {
    const view = timelineCard.current;
    if (!view) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      zoomAt.current(
        zoomNow.current * Math.exp(-event.deltaY * scale * 0.01),
        event.clientX,
      );
    };
    view.addEventListener('wheel', onWheel, { passive: false });
    return () => view.removeEventListener('wheel', onWheel);
  }, []);

  /** The playhead was moved by a key, maybe out of view (see onKey). */
  const jumped = useRef(false);
  // Zoomed in, the playhead is kept on show as it plays, or when a key
  // moves it; not when the timeline is put back as it was left, which
  // keeps its own view.
  useEffect(() => {
    const view = viewport.current;
    const moved = jumped.current;
    jumped.current = false;
    if (!view || zoom <= 1 || !duration || dragging) return;
    if (!playing && !moved) return;
    const at = x(time);
    if (at < view.scrollLeft || at > view.scrollLeft + view.clientWidth - 4) {
      view.scrollLeft = at - view.clientWidth * 0.1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);
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
    let pointerX = event.clientX;
    // Zoomed in, held near (or past) an edge of the timeline, it scrolls
    // that way, faster the further out, and the drag goes on with it.
    let scrolling = 0;
    const scrollAtEdge = () => {
      const view = viewport.current;
      if (ended || !view) return;
      const box = view.getBoundingClientRect();
      const over =
        pointerX < box.left + edgeZone
          ? pointerX - (box.left + edgeZone)
          : pointerX > box.right - edgeZone
            ? pointerX - (box.right - edgeZone)
            : 0;
      if (over && view.scrollWidth > view.clientWidth) {
        const before = view.scrollLeft;
        view.scrollLeft += clamp(over * 0.5, -40, 40);
        if (view.scrollLeft !== before) move(timeAt(pointerX));
      }
      scrolling = requestAnimationFrame(scrollAtEdge);
    };
    scrolling = requestAnimationFrame(scrollAtEdge);
    const end = () => {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(scrolling);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      done?.();
    };
    const onMove = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== id) return;
      if ((next.buttons & 1) === 0) return end();
      pointerX = next.clientX;
      move(timeAt(next.clientX));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /** Drags one handle: Start can't pass End, nor End Start. */
  const dragHandle =
    (which: 'start' | 'end') => (event: PointerEvent<HTMLElement>) => {
      if (locked || !duration || event.button !== 0) return;
      setDragging(which);
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
        // Then the playhead's moment again, and the handles as they were.
        () => {
          setDragging(null);
          unpeek();
        },
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
  // Only what is on show (and a little either side) is drawn, so a long
  // video zoomed far in draws no more than one that fits.
  const shownFrom = scrollLeft - viewWidth / 2;
  const shownTo = scrollLeft + viewWidth * 1.5;
  // Frames: those on show and a few either side, ready as it scrolls.
  const firstTile = Math.max(
    0,
    Math.floor(scrollLeft / tileWidth) - framesAside,
  );
  const lastTile = Math.min(
    tiles - 1,
    Math.ceil((scrollLeft + viewWidth) / tileWidth) + framesAside,
  );
  const pxPerMark = duration ? (step / duration) * width : 0;
  const firstMark = pxPerMark
    ? Math.max(0, Math.floor(shownFrom / pxPerMark))
    : 0;
  const lastMark = pxPerMark
    ? Math.min(marks - 1, Math.ceil(shownTo / pxPerMark))
    : -1;
  // Too narrow for both handles side by side, they sit outside the part
  // kept, so neither covers the other.
  const narrow = x(end) - x(start) < handleWidth * 2 + 4;
  const zoomLabel =
    zoom < 10 ? `${Math.round(zoom * 10) / 10}×` : `${Math.round(zoom)}×`;
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
      <div
        ref={timelineCard}
        className="rounded-2xl bg-canvas px-3 pt-2.5 pb-3 shadow-card"
      >
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
        <div
          ref={viewport}
          onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
          // Zoomed in, it scrolls along (two fingers, or the bar).
          // Room below for the handles, which stand a little proud of the track.
          className="overflow-x-auto overflow-y-hidden pb-1"
        >
          <div
            ref={lane}
            // Dragging anywhere but a handle moves the playhead.
            onPointerDown={(event) => follow(event, seek)}
            className="relative flex cursor-pointer touch-none flex-col gap-1.5 select-none"
            style={{ width: width || '100%' }}
          >
            {/* The ruler. */}
            <div className="relative h-7 text-[11px] font-medium text-ink-soft tabular-nums">
              {Array.from(
                { length: Math.max(0, lastMark - firstMark + 1) },
                (_, offset) => {
                  const index = firstMark + offset;
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
                      {x(at + step / 2) < width && (
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
                },
              )}
            </div>

            {/* The video track: frames along its length. */}
            <div className="relative h-14 overflow-hidden rounded-lg bg-group">
              {media &&
                duration &&
                Array.from(
                  { length: Math.max(0, lastTile - firstTile + 1) },
                  (_, offset) => {
                    const index = firstTile + offset;
                    return (
                      <Frame
                        // By place, not zoom: zooming keeps each frame's
                        // picture on show until a better one is made.
                        key={`${mediaKey}:${index}`}
                        media={media}
                        mediaKey={mediaKey}
                        left={index * tileWidth}
                        width={tileWidth}
                        seconds={Math.min(
                          duration - 0.05,
                          (((index + 0.5) * tileWidth) / width) * duration,
                        )}
                      />
                    );
                  },
                )}
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
                    thin={dragging !== null}
                    outside={narrow}
                    onPointerDown={dragHandle('start')}
                    onKeyDown={nudge('start')}
                    onBlur={unpeek}
                  />
                  <Handle
                    side="end"
                    seconds={end}
                    locked={locked}
                    thin={dragging !== null}
                    outside={narrow}
                    onPointerDown={dragHandle('end')}
                    onKeyDown={nudge('end')}
                    onBlur={unpeek}
                  />
                </div>
                {/* The moment the handle held is at, over the ruler. */}
                {dragging && (
                  <span
                    className="absolute -top-6 h-5 -translate-x-1/2 rounded-md bg-brand px-1.5 text-[11px] leading-5 font-semibold text-white tabular-nums shadow-sm"
                    style={{
                      left: clamp(
                        x(dragging === 'start' ? start : end),
                        30,
                        Math.max(30, width - 30),
                      ),
                    }}
                  >
                    {clock(dragging === 'start' ? start : end)}
                  </span>
                )}
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
                  className={`pointer-events-auto absolute top-0 grid h-5 cursor-ew-resize place-items-center rounded-md bg-accent text-[11px] font-semibold text-accent-ink tabular-nums shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                    dragging ? 'opacity-0' : ''
                  }`}
                  style={{ left: tagLeft, width: tagWidth }}
                >
                  {clock(time)}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Zooming the timeline in, to set the ends to the frame. */}
        {duration ? (
          <div className="flex items-center justify-end gap-1 pt-1 text-[12px] text-ink-soft">
            {zoom > 1 && (
              <button
                type="button"
                onClick={() => zoomTo(1)}
                title="Show the whole video"
                className={smallButton}
              >
                Whole Video
              </button>
            )}
            <button
              type="button"
              onClick={zoomToSelection}
              title="Zoom to the part kept"
              className={smallButton}
            >
              <MoveHorizontal size={13} />
              Fit Selection
            </button>
            <span aria-hidden className="mx-1 h-4 w-px bg-line" />
            <button
              type="button"
              aria-label="Zoom Out"
              title="Zoom out (or pinch)"
              disabled={zoom <= 1}
              onClick={() => zoomTo(zoom / 2)}
              className={`${iconButton} disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`}
            >
              <Minus size={14} />
            </button>
            <span
              aria-live="polite"
              title="Timeline zoom"
              className="w-11 text-center font-medium tabular-nums"
            >
              {zoomLabel}
            </span>
            <button
              type="button"
              aria-label="Zoom In"
              title="Zoom in (or pinch)"
              disabled={zoom >= maxZoom}
              onClick={() => zoomTo(zoom * 2)}
              className={`${iconButton} disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`}
            >
              <Plus size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Video to GIF's timeline: Trim Video's, starting on 5 seconds from the
 * middle of the video, zoomed in on, rather than on all of it.
 */
export function GifClipEditor(props: ToolEditorProps) {
  return <TrimEditor {...props} clip={5} />;
}

/**
 * One end of the part kept: a tab across the track, to drag. While either
 * is dragged both thin to a line, so the frames at the ends show; when the
 * part kept is too narrow for both side by side, they sit outside it.
 */
function Handle({
  side,
  seconds,
  locked,
  thin,
  outside,
  onPointerDown,
  onKeyDown,
  onBlur,
}: {
  side: 'start' | 'end';
  seconds: number;
  locked: boolean;
  thin: boolean;
  outside: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onBlur: () => void;
}) {
  const Chevron = side === 'start' ? ChevronLeft : ChevronRight;
  const start = side === 'start';
  const place = thin
    ? `w-[3px] rounded-full ${start ? '-left-[2px]' : '-right-[2px]'}`
    : `w-3 ${start ? 'rounded-l-lg' : 'rounded-r-lg'} ${
        outside
          ? start
            ? '-left-3'
            : '-right-3'
          : start
            ? '-left-0.5'
            : '-right-0.5'
      }`;
  return (
    <span
      role="slider"
      tabIndex={locked ? -1 : 0}
      aria-label={start ? 'Start' : 'End'}
      aria-valuetext={clock(seconds)}
      aria-valuenow={seconds}
      aria-disabled={locked}
      title={`${start ? 'Start' : 'End'} ${clock(seconds)}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={`pointer-events-auto absolute -inset-y-0.5 grid place-items-center bg-brand text-white outline-none transition-[width] duration-100 focus-visible:ring-2 focus-visible:ring-brand/50 ${place} ${
        locked ? 'cursor-default' : 'cursor-ew-resize'
      }`}
    >
      {!thin && <Chevron size={12} strokeWidth={3} />}
    </span>
  );
}

/**
 * One frame along the video track. Until its own moment's picture is made,
 * it shows the nearest one already made (never nothing, once any is), and
 * it asks for its own only once its moment has rested, so zooming or
 * scrolling doesn't ask for frames that are gone a moment later.
 */
function Frame({
  media,
  mediaKey,
  left,
  width,
  seconds,
}: {
  media: MediaRef;
  mediaKey: string;
  left: number;
  width: number;
  seconds: number;
}) {
  // To a twentieth of a second: near enough even zoomed all the way in,
  // and shared between frames that land on the same moment.
  const at = Math.round(seconds * 20) / 20;
  const [image, setImage] = useState<string | null>(() =>
    nearestFrame(mediaKey, at),
  );
  useEffect(() => {
    const own = madeFrames.get(mediaKey)?.get(at);
    if (own) {
      setImage(own);
      return;
    }
    const near = nearestFrame(mediaKey, at);
    if (near) setImage(near);
    let cancel = () => {};
    const timer = window.setTimeout(() => {
      cancel = askFrame(media, mediaKey, at, (made) => {
        if (made) setImage(made);
      });
    }, frameSettle);
    return () => {
      window.clearTimeout(timer);
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey, at]);
  return (
    <span
      className="absolute inset-y-0 border-r border-black/20 bg-group bg-cover bg-center"
      style={{
        left,
        width,
        backgroundImage: image ? `url("${image}")` : undefined,
      }}
    />
  );
}
