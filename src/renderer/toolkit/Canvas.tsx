import {
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Maximize2, Minus, Plus } from '../components/icons';
import { useTabStash } from '../tabState';

/**
 * Where the canvas is looked at from: `x` is where, across the window, the
 * middle of the content is (the first stage's middle, as every branch is
 * laid out under it); `y` where its top is; `z` how far it is zoomed.
 */
type Camera = { x: number; y: number; z: number };

type Box = { w: number; h: number };

type CanvasApi = {
  /**
   * Glides the canvas so `element` is in view: its top near the window's
   * top (`start`), its bottom near the bottom (`end`), or only as far as it
   * must to be whole (`nearest`). Centred across, if it isn't in view
   * across.
   */
  reveal: (element: Element, place?: 'start' | 'end' | 'nearest') => void;
};

const CanvasContext = createContext<CanvasApi | null>(null);

/** The canvas a page is drawn on; null on a page without one. */
export const useCanvas = () => useContext(CanvasContext);

/** Said to the window when the canvas moves, so a menu floating by a
 *  button on it can close (see NextSteps' and SelectMenu's menus). */
export const canvasMoveEvent = 'canvas-move';

const minZoom = 0.25;
const maxZoom = 1.5;
/** Kept clear at the sides, and the bottom, of content bigger than the
 *  window; and the most it can be pulled in from them. */
const side = 48;
const bottom = 96;
/** Where the content's top sits, as on a page: a fifth of the way down,
 *  so a page of one stage is nearer the middle than the top. */
const topOf = (height: number) => Math.max(48, height * 0.18);
/** How long a glide to something revealed takes, in ms. */
const glideTime = 380;

/**
 * Keeps the content where it can be seen, as a page scrolls: across, in
 * the middle while it fits and otherwise no further than its edges; down,
 * from its usual top while it fits and otherwise from its top to its
 * bottom. So it pans only once it is bigger than the window, as stages
 * branch out.
 */
function clamp(camera: Camera, view: Box, box: Box): Camera {
  const z = Math.min(maxZoom, Math.max(minZoom, camera.z));
  const width = box.w * z;
  const height = box.h * z;
  const x =
    width + side * 2 <= view.w
      ? view.w / 2
      : Math.min(
          side + width / 2,
          Math.max(view.w - side - width / 2, camera.x),
        );
  const top = topOf(view.h);
  const y =
    top + height + bottom <= view.h
      ? top
      : Math.min(top, Math.max(view.h - bottom - height, camera.y));
  return { x, y, z };
}

/**
 * Whether a wheel turn over `target` belongs to something on the canvas
 * that scrolls by itself (a strip of thumbnails, a long list), as it can
 * still scroll that way; else it pans the canvas.
 */
function scrollsItself(
  target: EventTarget | null,
  stop: Element,
  dx: number,
  dy: number,
) {
  const across = Math.abs(dx) > Math.abs(dy);
  for (
    let element = target instanceof Element ? target : null;
    element && element !== stop;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (across) {
      if (!/(auto|scroll)/.test(style.overflowX)) continue;
      const room = element.scrollWidth - element.clientWidth;
      if (room <= 1) continue;
      if (dx > 0 ? element.scrollLeft < room - 1 : element.scrollLeft > 0) {
        return true;
      }
    } else {
      if (!/(auto|scroll)/.test(style.overflowY)) continue;
      const room = element.scrollHeight - element.clientHeight;
      if (room <= 1) continue;
      if (dy > 0 ? element.scrollTop < room - 1 : element.scrollTop > 0) {
        return true;
      }
    }
  }
  return false;
}

/** Whether a press on `target` grabs the canvas: anywhere but on a card
 *  or a control. */
const onBackground = (target: EventTarget | null) =>
  target instanceof Element &&
  !target.closest(
    '[data-canvas-node],button,a,input,textarea,select,label,[role="menu"],[role="listbox"]',
  );

/** Whether a key press is the page's, not a field's or a button's. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName));

/**
 * A tool page's canvas, as in a design tool: its content (the page's
 * stages, branching out below one another) sits on a dotted board that
 * pans with two fingers on a trackpad (or the wheel, or by dragging an
 * empty part of it, or anywhere with Space held) and zooms with a pinch
 * or its zoom buttons. It pans only as far as there is content to see:
 * while it all fits, it stays put, like a page. Where it was panned to is
 * kept with its tab.
 */
export function Canvas({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stash = useTabStash<Camera>('camera');
  const [camera, setCamera] = useState<Camera | null>(null);
  /** Easing to where it was asked to go (see reveal), not following a
   *  finger. */
  const [gliding, setGliding] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const space = useRef(false);

  const measure = () => {
    const view = viewport.current;
    const box = content.current;
    return {
      view: { w: view?.clientWidth ?? 0, h: view?.clientHeight ?? 0 },
      box: { w: box?.offsetWidth ?? 0, h: box?.offsetHeight ?? 0 },
    };
  };
  /** Moves the camera, kept where the content can be seen. */
  const move = (change: (camera: Camera) => Camera, glide = false) => {
    setGliding(glide);
    setCamera((current) => {
      if (!current) return current;
      const { view, box } = measure();
      return clamp(change(current), view, box);
    });
  };
  // Stable across renders, for the listeners below and the context.
  const moveRef = useRef(move);
  moveRef.current = move;

  // Placed before it is first painted: where it was, or at the start.
  useLayoutEffect(() => {
    const { view, box } = measure();
    setCamera(clamp(stash.read() ?? { x: 0, y: 0, z: 1 }, view, box));
    // Once, when it mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kept with the tab, and menus floating by the canvas told it moved.
  const shown = useRef<Camera | null>(null);
  useEffect(() => {
    const was = shown.current;
    if (
      !camera ||
      (was && was.x === camera.x && was.y === camera.y && was.z === camera.z)
    ) {
      return;
    }
    shown.current = camera;
    stash.write(camera);
    if (was) window.dispatchEvent(new Event(canvasMoveEvent));
  });

  // Held in view as the window or the content changes size: a stage
  // added or removed, results arriving.
  useEffect(() => {
    const observer = new ResizeObserver(() => moveRef.current((c) => c));
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);

  // A glide ends on its own.
  useEffect(() => {
    if (!gliding) return;
    const timer = setTimeout(() => setGliding(false), glideTime);
    return () => clearTimeout(timer);
  }, [gliding, camera]);

  // Two fingers pan; a pinch (which Chromium sends as a wheel turn with
  // Control) zooms about the pointer. Not passive, so the window itself
  // never scrolls.
  useEffect(() => {
    const view = viewport.current;
    if (!view) return;
    /** A gesture that began on something scrolling by itself stays with
     *  it, momentum and all, rather than spilling onto the canvas. */
    let latched: { until: number; inner: boolean } | null = null;
    const onWheel = (event: WheelEvent) => {
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const dx = event.deltaX * scale;
      const dy = event.deltaY * scale;
      if (event.ctrlKey) {
        event.preventDefault();
        const rect = view.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        moveRef.current((c) => {
          const z = Math.min(
            maxZoom,
            Math.max(minZoom, c.z * Math.exp(-dy * 0.01)),
          );
          const k = z / c.z;
          return { x: px - (px - c.x) * k, y: py - (py - c.y) * k, z };
        });
        return;
      }
      const now = performance.now();
      if (!latched || now > latched.until) {
        latched = {
          until: 0,
          inner: scrollsItself(event.target, view, dx, dy),
        };
      }
      latched.until = now + 180;
      if (latched.inner) return;
      event.preventDefault();
      moveRef.current((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
    };
    view.addEventListener('wheel', onWheel, { passive: false });
    return () => view.removeEventListener('wheel', onWheel);
  }, []);

  // Anything that scrolls the canvas the browser's way (an element focused
  // or scrolled into view) pans it instead, so the camera stays the one
  // place it is moved.
  useEffect(() => {
    const view = viewport.current;
    if (!view) return;
    const onScroll = () => {
      const dx = view.scrollLeft;
      const dy = view.scrollTop;
      if (!dx && !dy) return;
      view.scrollLeft = 0;
      view.scrollTop = 0;
      moveRef.current((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
    };
    view.addEventListener('scroll', onScroll);
    return () => view.removeEventListener('scroll', onScroll);
  }, []);

  // Space held grabs the canvas anywhere, as in a design tool.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      // Only the page's own: not the player's or a menu's, drawn over it.
      const target = event.target;
      const ours =
        target === document.body ||
        (target instanceof Node && viewport.current?.contains(target));
      if (
        event.code !== 'Space' ||
        event.repeat ||
        !ours ||
        typing(target) ||
        document.querySelector('[aria-modal="true"]')
      ) {
        return;
      }
      event.preventDefault();
      space.current = true;
      setSpaceHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      space.current = false;
      setSpaceHeld(false);
    };
    const blur = () => {
      space.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const api = useMemo<CanvasApi>(
    () => ({
      reveal: (element, place = 'nearest') => {
        const view = viewport.current;
        if (!view) return;
        const v = view.getBoundingClientRect();
        const e = element.getBoundingClientRect();
        const margin = side;
        let dy = 0;
        const fromTop = v.top + margin - e.top;
        const fromBottom = v.bottom - margin - e.bottom;
        if (place === 'start') dy = fromTop;
        else if (place === 'end') dy = fromBottom;
        else if (e.top < v.top + margin || e.height > v.height - margin * 2) {
          dy = fromTop;
        } else if (e.bottom > v.bottom - margin) dy = fromBottom;
        const dx =
          e.left < v.left + margin || e.right > v.right - margin
            ? v.left + v.width / 2 - (e.left + e.width / 2)
            : 0;
        if (!dx && !dy) return;
        moveRef.current((c) => ({ ...c, x: c.x + dx, y: c.y + dy }), true);
      },
    }),
    [],
  );

  // Focus moved (by Tab) onto something out of view brings it in.
  // Not for what's drawn over the page from it (menus, the player): React
  // passes their events up to here too.
  const onFocus = (event: ReactFocusEvent) => {
    const target = event.target;
    // Only focus moved by the keyboard: a click is on something in view.
    if (
      !viewport.current?.contains(target) ||
      !target.matches(':focus-visible')
    ) {
      return;
    }
    requestAnimationFrame(() => api.reveal(target, 'nearest'));
  };

  /** Drags the canvas: from its background, with the middle button, or
   *  anywhere with Space held. */
  const onPointerDown = (event: ReactPointerEvent) => {
    if (
      !(event.target instanceof Node) ||
      !viewport.current?.contains(event.target)
    ) {
      return;
    }
    const grab =
      event.button === 1 ||
      (event.button === 0 && (space.current || onBackground(event.target)));
    if (!grab) return;
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    setGrabbing(true);
    let last = { x: event.clientX, y: event.clientY };
    const onMove = (next: PointerEvent) => {
      const dx = next.clientX - last.x;
      const dy = next.clientY - last.y;
      last = { x: next.clientX, y: next.clientY };
      moveRef.current((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
    };
    const onUp = () => {
      setGrabbing(false);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
  };

  /** Zooms by `factor` about the window's middle. */
  const zoomBy = (factor: number) => {
    const view = viewport.current;
    if (!view) return;
    const px = view.clientWidth / 2;
    const py = view.clientHeight / 2;
    move((c) => {
      const z = Math.min(maxZoom, Math.max(minZoom, c.z * factor));
      const k = z / c.z;
      return { x: px - (px - c.x) * k, y: py - (py - c.y) * k, z };
    }, true);
  };
  /** Zoomed to show it all, never past its own size. */
  const fit = () => {
    const { view, box } = measure();
    if (!box.w || !box.h) return;
    const z = Math.min(
      1,
      (view.w - side * 2) / box.w,
      (view.h - topOf(view.h) - bottom) / box.h,
    );
    move(() => ({ x: view.w / 2, y: topOf(view.h), z }), true);
  };

  const z = camera?.z ?? 1;
  // The dots move and scale with the content, as on a design tool's board,
  // every other one dropping out as it zooms out, so they never crowd.
  let dot = 20 * z;
  while (dot < 12) dot *= 2;
  const background = camera
    ? {
        backgroundSize: `${dot}px ${dot}px`,
        backgroundPosition: `${camera.x % dot}px ${camera.y % dot}px`,
      }
    : undefined;

  return (
    <CanvasContext value={api}>
      <div
        ref={viewport}
        onPointerDown={onPointerDown}
        onFocus={onFocus}
        style={background}
        className={`flow-canvas relative flex-1 touch-none overflow-hidden select-none ${
          grabbing ? 'cursor-grabbing' : spaceHeld ? 'cursor-grab' : ''
        }`}
      >
        <div
          // The camera: placed, then scaled from the content's top middle.
          style={{
            transform: camera
              ? `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`
              : undefined,
            visibility: camera ? undefined : 'hidden',
            transition: gliding
              ? `transform ${glideTime}ms cubic-bezier(0.22, 1, 0.36, 1)`
              : undefined,
          }}
          className="absolute top-0 left-0 origin-top-left will-change-transform"
        >
          <div
            ref={content}
            className="absolute top-0 left-0 w-max -translate-x-1/2 select-text"
          >
            {children}
          </div>
        </div>
        <ZoomControls
          zoom={z}
          onZoomOut={() => zoomBy(1 / 1.25)}
          onZoomIn={() => zoomBy(1.25)}
          onReset={() => zoomBy(1 / z)}
          onFit={fit}
        />
      </div>
    </CanvasContext>
  );
}

const zoomButton =
  'grid size-7 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-ink/5 hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

/** In the canvas's corner: zoom out, the zoom (press for 100%), zoom in,
 *  and fit everything in view. */
function ZoomControls({
  zoom,
  onZoomOut,
  onZoomIn,
  onReset,
  onFit,
}: {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
  onFit: () => void;
}) {
  return (
    <div
      data-canvas-node
      className="absolute right-4 bottom-4 flex items-center gap-0.5 rounded-full bg-canvas p-1 shadow-card"
    >
      <button
        type="button"
        aria-label="Zoom Out"
        title="Zoom Out"
        disabled={zoom <= minZoom + 0.001}
        onClick={onZoomOut}
        className={zoomButton}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        title="Actual Size"
        onClick={onReset}
        className="h-7 w-12 cursor-pointer rounded-full text-[12px] font-medium text-ink-soft tabular-nums hover:bg-ink/5 hover:text-ink"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Zoom In"
        title="Zoom In"
        disabled={zoom >= maxZoom - 0.001}
        onClick={onZoomIn}
        className={zoomButton}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        aria-label="Zoom to Fit"
        title="Zoom to Fit"
        onClick={onFit}
        className={zoomButton}
      >
        <Maximize2 size={13} />
      </button>
    </div>
  );
}
