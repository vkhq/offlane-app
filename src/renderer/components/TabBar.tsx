import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { TabWork } from '../busyTabs';
import { type Tab, describe, homeId, isPinned, pathOf } from './tabs';
import { type AppIcon, PanelLeft, Plus, X } from './icons';

type TabBarProps = {
  tabs: Tab[];
  activeId: string;
  /** Tabs whose tool is at work, and how it is going; their icon shows it. */
  busy: Map<string, TabWork>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Dropping a dragged tab moves it to this place in `tabs`. */
  onMove: (id: string, to: number) => void;
  /** Right-clicking a tab asks for its context menu. */
  onMenu: (id: string) => void;
  onNew: () => void;
  /** Whether the sidebar's rail is showing, for the toggle's label. */
  sidebarShown: boolean;
  onToggleSidebar: () => void;
};

/** A tab on screen: open, or closed but still shrinking away. */
type Shown = { tab: Tab; leaving: boolean };

/** A tab being dragged along the strip. */
type Drag = {
  id: string;
  /** How far it has been dragged from its place, in px. */
  dx: number;
  /**
   * Where it would land: its place among the other tabs, or null where
   * dropping it would leave it where it is.
   */
  slot: number | null;
  /** How far each other tab slides aside to make room for it, in px. */
  shifts: Record<string, number>;
  /** The room made for it, in the strip's content, in px. */
  space: { left: number; width: number };
};

/** How far the pointer moves before a press on a tab becomes a drag, in px. */
const dragThreshold = 4;

/** How near the strip's ends a drag scrolls it, and how fast, in px. */
const scrollEdge = 32;
const scrollSpeed = 8;

const clamp = (value: number, min: number, max: number) =>
  Math.max(Math.min(value, max), min);

/** Slides `node` from `dx` px along back to where it is laid out. */
const glide = (node: HTMLElement, dx: number) =>
  reducedMotion() ||
  node.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], tabMotion);

/**
 * Where a tab's left edge would be drawn at full size, in px from the
 * window's left edge: the same for a shrunk tab, which shrinks to its centre.
 */
const fullSizeLeft = (node: HTMLElement) => {
  const box = node.getBoundingClientRect();
  return box.left + box.width / 2 - node.offsetWidth / 2;
};

/**
 * The tabs to draw: the open ones in their order, plus any just closed, kept
 * just after the tab they followed until their closing animation ends.
 */
function reconcile(shown: Shown[], tabs: Tab[]): Shown[] {
  const open = new Set(tabs.map((tab) => tab.id));
  const result: Shown[] = tabs.map((tab) => ({ tab, leaving: false }));
  shown.forEach(({ tab }, at) => {
    if (open.has(tab.id)) return;
    // Behind the nearest earlier tab still drawn, closed ones included.
    let anchor = -1;
    for (let before = at - 1; before >= 0 && anchor < 0; before--) {
      const id = shown[before].tab.id;
      anchor = result.findIndex((other) => other.tab.id === id);
    }
    result.splice(anchor + 1, 0, { tab, leaving: true });
  });
  return result;
}

/**
 * The strip of open tabs above the page. It sits outside the page's scroll
 * area, so it stays put, and its empty space moves the window like a title bar.
 */
export function TabBar({
  tabs,
  activeId,
  busy,
  onSelect,
  onClose,
  onMove,
  onMenu,
  onNew,
  sidebarShown,
  onToggleSidebar,
}: TabBarProps) {
  const list = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Set as a drag ends, so the click that ends it does not count as one.
  const dragged = useRef(false);
  // Where each tab was drawn just before a drop, for them to glide from.
  const dropFrom = useRef<Map<string, number>>(null);

  // Updated while rendering, so a closed tab never drops out for a frame.
  const [shown, setShown] = useState<Shown[]>(() =>
    tabs.map((tab) => ({ tab, leaving: false })),
  );
  const [seenTabs, setSeenTabs] = useState(tabs);
  if (seenTabs !== tabs) {
    setSeenTabs(tabs);
    setShown(reconcile(shown, tabs));
  }
  const forget = (id: string) =>
    setShown((current) =>
      current.filter(({ tab, leaving }) => !(leaving && tab.id === id)),
    );

  // Tabs there at launch appear as they are; later ones grow in.
  const launched = useRef(false);
  useEffect(() => {
    launched.current = true;
  }, []);

  /** The open tabs' elements, by tab id; closing ones are left out. */
  const tabNodes = () =>
    new Map(
      [
        ...(list.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []),
      ].map((node) => [node.dataset.tabId!, node]),
    );

  /**
   * Pressing a tab and moving the pointer drags it along the strip, over the
   * others, with a divider marking the gap it will drop into. Home, which
   * has no tab in the strip, stays first; pinned tabs stay among the pinned
   * ones and the rest after them.
   * Dragging near either end scrolls the strip; Escape puts the tab back.
   */
  const startDrag = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    const strip = list.current;
    const node = event.currentTarget;
    const target = event.target as Element;
    if (!strip || event.button !== 0 || id === homeId) return;
    if (target.closest('button')) return;
    // No text selection or focus ring from the press.
    event.preventDefault();

    const from = tabs.findIndex((tab) => tab.id === id);
    const others = tabs.filter((tab) => tab.id !== id);
    const pinned = tabs.filter(isPinned).length;
    const [lowest, highest] = isPinned(tabs[from])
      ? [1, pinned - 1]
      : [pinned, others.length];
    const startX = event.clientX;
    const startScroll = strip.scrollLeft;
    // The tab stays within the strip.
    const minDx = -node.offsetLeft;
    const maxDx = strip.scrollWidth - node.offsetLeft - node.offsetWidth;

    let pointerX = startX;
    let started = false;
    let frame = 0;
    const width = node.offsetWidth;
    const home = { left: node.offsetLeft, width };
    let current: Drag = {
      id,
      dx: 0,
      slot: null,
      shifts: {},
      space: home,
    };

    const update = () => {
      const dx = clamp(
        pointerX - startX + strip.scrollLeft - startScroll,
        minDx,
        maxDx,
      );
      // The dragged tab's edges, in the strip's content.
      const dragLeft = home.left + dx;
      const dragRight = dragLeft + width;
      const nodes = tabNodes();
      // A tab to the left of its place makes room once the dragged tab's left
      // edge passes that tab's middle; one to the right, once its right edge
      // does. Measured where the tabs are laid out, not where they have slid
      // to, so the room made never moves the spot that made it.
      const passed = others.filter((tab, at) => {
        // Home is not drawn, but it is always first, so always passed.
        if (tab.id === homeId) return true;
        const other = nodes.get(tab.id);
        if (!other) return false;
        const middle = other.offsetLeft + other.offsetWidth / 2;
        return at < from ? middle <= dragLeft : middle < dragRight;
      }).length;
      const place = clamp(passed, lowest, highest);
      const slot = place === from ? null : place;
      // The tabs between its place and where it would land slide over by its
      // width, towards its place, and the room opens where they were.
      const shifts: Record<string, number> = {};
      let spaceLeft = home.left;
      others.forEach((tab, at) => {
        const passedRight = at >= from && at < place;
        const passedLeft = at >= place && at < from;
        shifts[tab.id] = passedRight ? -width : passedLeft ? width : 0;
        const size = nodes.get(tab.id)?.offsetWidth ?? 0;
        if (passedRight) spaceLeft += size;
        if (passedLeft) spaceLeft -= size;
      });
      current = {
        id,
        dx,
        slot,
        shifts,
        space: { left: spaceLeft, width },
      };
      setDrag(current);
    };

    const autoScroll = () => {
      const box = strip.getBoundingClientRect();
      const speed =
        pointerX < box.left + scrollEdge
          ? -scrollSpeed
          : pointerX > box.right - scrollEdge
            ? scrollSpeed
            : 0;
      const before = strip.scrollLeft;
      strip.scrollLeft += speed;
      if (strip.scrollLeft !== before) update();
      frame = requestAnimationFrame(autoScroll);
    };

    const onPointerMove = (move: PointerEvent) => {
      pointerX = move.clientX;
      if (!started) {
        if (Math.abs(pointerX - startX) < dragThreshold) return;
        started = true;
        // As in a browser, the tab you pick up is the one shown.
        onSelect(id);
        frame = requestAnimationFrame(autoScroll);
      }
      update();
    };

    const finish = (drop: boolean) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      cancelAnimationFrame(frame);
      if (!started) return;
      dragged.current = true;
      setTimeout(() => (dragged.current = false));
      setDrag(null);
      if (drop && current.slot !== null) {
        // The others are already where they belong; their slide just ends.
        // Every tab glides from where it is drawn now to its new place.
        dropFrom.current = new Map(
          [...tabNodes()].map(([key, tab]) => [key, fullSizeLeft(tab)]),
        );
        onMove(id, current.slot);
      } else {
        // Put back: the tab and every tab that made room glide home.
        glide(node, current.dx);
        tabNodes().forEach((other, key) => {
          const shift = current.shifts[key];
          if (shift) glide(other, shift);
        });
      }
    };
    const onPointerUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key !== 'Escape' || !started) return;
      key.preventDefault();
      key.stopPropagation();
      finish(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
  };

  // After a drop, before paint: each tab starts where it was drawn and
  // glides to its new place.
  useLayoutEffect(() => {
    const before = dropFrom.current;
    if (!before) return;
    dropFrom.current = null;
    tabNodes().forEach((node, id) => {
      const was = before.get(id);
      if (was === undefined) return;
      const dx = was - fullSizeLeft(node);
      if (Math.abs(dx) > 0.5) glide(node, dx);
    });
  }, [tabs]);

  // Keep the selected tab in view when another one is selected. New tabs,
  // shown or opened in the background, scroll themselves into view.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  return (
    <div
      // A thin strip across the top of the window, like the macOS menu bar,
      // in black and white throughout, with the page card below it. It is clear
      // but for the sidebar's light veil, so the sidebar's wash behind it (see
      // AppShell) runs on across it without a seam. Its
      // tabs are flat items level with the window's traffic lights, which it
      // clears with a wider gap than theirs; the selected one has a soft grey
      // highlight, as an open menu does.
      //
      // With the sidebar shown, the traffic lights and its toggle sit in the
      // sidebar's own top row; hidden, the bar clears the lights and takes the
      // toggle.
      className={`app-drag absolute inset-x-0 top-0 z-20 flex h-10 items-stretch bg-white/20 text-[13px] text-ink transition-[padding] duration-300 ease-out motion-reduce:transition-none ${
        sidebarShown ? 'pl-0' : 'pl-22'
      }`}
    >
      {/* Past the traffic lights, before the tabs, as in Chrome's sidebar. */}
      {!sidebarShown && (
        <span className="flex shrink-0">
          <button
            type="button"
            aria-label={sidebarShown ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={sidebarShown}
            title={`${sidebarShown ? 'Hide' : 'Show'} sidebar (⌘\\)`}
            onClick={onToggleSidebar}
            className="app-no-drag grid w-10 place-items-center hover:bg-black/5"
          >
            <PanelLeft size={16} />
          </button>
        </span>
      )}

      <div
        ref={list}
        role="tablist"
        // An ordinary mouse wheel scrolls vertically; turn that sideways.
        onWheel={(event) => {
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.currentTarget.scrollLeft += event.deltaY;
          }
        }}
        // Tabs keep their width and the strip scrolls instead.
        className="app-no-drag no-scrollbar relative flex min-w-0 items-stretch overflow-x-auto"
      >
        {drag && (
          // The room made for the dragged tab, lightly lit, sliding along as
          // the tabs move aside. Drawn first, so the tabs pass over it.
          <span
            aria-hidden
            style={{ left: drag.space.left, width: drag.space.width }}
            className="pointer-events-none absolute inset-y-0 flex px-1 py-1.5 transition-[left] duration-180 ease-[cubic-bezier(0.2,0,0,1)]"
          >
            <span className="flex-1 rounded-lg bg-black/5" />
          </span>
        )}
        {/* Home has no tab of its own here; the sidebar's Home link and
            Cmd+H show it. */}
        {shown
          .filter(({ tab }) => tab.id !== homeId)
          .map(({ tab, leaving }) => (
            <TabItem
              key={tab.id}
              tab={tab}
              active={!leaving && tab.id === activeId}
              work={leaving ? undefined : busy.get(tab.id)}
              leaving={leaving}
              animateIn={launched.current}
              dragged={drag?.id === tab.id ? drag : undefined}
              shift={
                drag && drag.id !== tab.id ? drag.shifts[tab.id] : undefined
              }
              onDragStart={startDrag}
              onSelect={(id) => dragged.current || onSelect(id)}
              onClose={onClose}
              onMenu={onMenu}
              onGone={forget}
            />
          ))}
      </div>

      {/* Highlighted on hover as a tab is, in a box the size of a tab's. */}
      <span className="flex shrink-0 px-1 py-1.5">
        <button
          type="button"
          aria-label="New tab"
          title="New tab"
          onClick={onNew}
          className="app-no-drag grid w-8 place-items-center rounded-lg hover:bg-black/8"
        >
          <Plus size={16} />
        </button>
      </span>
    </div>
  );
}

type TabItemProps = {
  tab: Tab;
  active: boolean;
  /**
   * Its tool is at work: the icon is ringed by how far along it is, or by
   * a spinning arc while that can't be told.
   */
  work?: TabWork;
  /** Closed, and shrinking away before it is removed. */
  leaving: boolean;
  /** Grows in from nothing when it first appears. */
  animateIn: boolean;
  /** Where the tab is while it is dragged. */
  dragged?: Pick<Drag, 'dx'>;
  /** While another tab is dragged, how far this one slides aside, in px. */
  shift?: number;
  onDragStart: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onMenu: (id: string) => void;
  /** Called once a closed tab has finished shrinking away. */
  onGone: (id: string) => void;
};

const tabMotion = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

/**
 * One tab's collapsed state: no width, so its neighbours close up around it.
 * The slot's side padding, the room around its box, closes with it; left
 * alone it would hold the slot open until the tab is removed, which then
 * jumps. The contents keep their own padding, so they hold still and are
 * clipped from the right rather than sliding.
 */
const collapsed = { width: '0px', paddingLeft: '0px', paddingRight: '0px' };

const expanded = (element: HTMLElement) => {
  const { paddingLeft, paddingRight } = getComputedStyle(element);
  return { width: `${element.offsetWidth}px`, paddingLeft, paddingRight };
};

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Runs `done` once the animation ends. A hidden window stops animations where
 * they are, so a timer finishes it anyway rather than leave the tab half-drawn.
 * Returns a cleanup that cancels the timer.
 */
function afterAnimation(animation: Animation, done: () => void) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done();
  };
  animation.onfinish = finish;
  const timer = setTimeout(() => {
    animation.finish();
    finish();
  }, tabMotion.duration + 100);
  return () => clearTimeout(timer);
}

/**
 * A tab grows from its left edge when opened and shrinks back into it when
 * closed, as in Chrome: its contents stay put and are clipped, not squashed.
 */
function TabItem({
  tab,
  active,
  work,
  leaving,
  animateIn,
  dragged,
  shift,
  onDragStart,
  onSelect,
  onClose,
  onMenu,
  onGone,
}: TabItemProps) {
  const element = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const { name, icon: Icon } = describe(pathOf(tab));
  // Pinned tabs, Home among them, are just their icon: no name or close button.
  const pinned = isPinned(tab);

  // While the tab is narrower than its contents, they keep their width and
  // are clipped, rather than the name being cut short.
  const holdContent = () => {
    const inner = content.current;
    if (inner) inner.style.minWidth = `${inner.offsetWidth}px`;
  };

  // A new tab, even one opened in the background with Cmd+Click, is brought
  // into view: the strip heads for it as it starts to grow, and once it is
  // full width the whole of it is shown.
  useLayoutEffect(() => {
    const node = element.current;
    if (!node || !animateIn) return;
    const reveal = (behavior: ScrollBehavior) =>
      node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
    if (reducedMotion()) return reveal('instant');
    reveal('smooth');
    holdContent();
    const animation = node.animate([collapsed, expanded(node)], tabMotion);
    return afterAnimation(animation, () => {
      content.current?.style.removeProperty('min-width');
      reveal('smooth');
    });
    // Only on first appearance.
  }, []);

  useLayoutEffect(() => {
    const node = element.current;
    if (!leaving || !node) return;
    if (reducedMotion()) return onGone(tab.id);
    holdContent();
    const animation = node.animate([expanded(node), collapsed], {
      ...tabMotion,
      fill: 'forwards',
    });
    const stop = afterAnimation(animation, () => onGone(tab.id));
    return () => {
      stop();
      animation.cancel();
    };
  }, [leaving]);

  return (
    <div
      ref={element}
      // A closing tab is only a picture of one: it cannot be used or read out.
      role={leaving ? undefined : 'tab'}
      aria-hidden={leaving || undefined}
      aria-selected={leaving ? undefined : active}
      tabIndex={leaving ? -1 : 0}
      data-tab-id={leaving ? undefined : tab.id}
      title={dragged ? undefined : work ? `${name} — ${work.label}` : name}
      // Follows the pointer while dragged; no transition, so it keeps up.
      style={
        dragged
          ? { translate: `${dragged.dx}px 0` }
          : shift
            ? { translate: `${shift}px 0` }
            : undefined
      }
      onPointerDown={(event) => !leaving && onDragStart(event, tab.id)}
      onClick={() => onSelect(tab.id)}
      // A middle click closes the tab, as in a browser.
      onAuxClick={(event) =>
        event.button === 1 && tab.id !== homeId && onClose(tab.id)
      }
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(tab.id);
      }}
      onKeyDown={(event) => event.key === 'Enter' && onSelect(tab.id)}
      // The tab's slot in the strip: room around it, above and below
      // it and between it and its neighbours.
      className={`group app-no-drag relative flex shrink-0 overflow-hidden px-1 py-1.5 whitespace-nowrap outline-none ${
        // As wide as its name, up to a limit past which the name is cut.
        pinned ? '' : 'max-w-56'
      } ${leaving ? 'pointer-events-none' : ''} ${active ? 'z-10' : ''} ${
        // Lifted over the others while dragged.
        // The move has no transition, so it keeps up with the pointer.
        dragged ? 'z-30 cursor-grabbing' : ''
      } ${
        // Slides aside, and back, while another tab is dragged; only then, so
        // dropping leaves it in its new place without a second slide.
        shift === undefined
          ? ''
          : 'transition-[translate] duration-180 ease-[cubic-bezier(0.2,0,0,1)]'
      }`}
    >
      {/* The tab itself: a softly rounded box, clear until hovered and
          shaded when selected. It shrinks with its slot as the tab opens and
          closes, clipping its contents. */}
      <div
        className={`flex min-w-0 flex-1 overflow-hidden rounded-lg ${
          dragged
            ? 'tab-dragging shadow-float'
            : active
              ? 'bg-black/10'
              : 'group-hover:bg-black/8'
        }`}
      >
        <div
          ref={content}
          className={`flex min-w-0 flex-1 shrink-0 items-center gap-2 ${
            pinned ? 'px-2.5' : 'pr-1 pl-3'
          }`}
        >
          {work ? (
            <WorkIcon icon={Icon} work={work} />
          ) : (
            <Icon size={15} className="shrink-0" />
          )}
          {!pinned && (
            <>
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <button
                type="button"
                aria-label={`Close ${name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                className="grid size-5 shrink-0 place-items-center rounded-md hover:bg-black/10"
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The ring's circumference, for drawing a share of it. */
const ring = 2 * Math.PI * 8.5;

/**
 * A tab's icon while its tool is at work: smaller, in the workflow's
 * purple, inside a ring that fills as the work goes on, or with an arc
 * running round it while how far along it is can't be told.
 */
function WorkIcon({ icon: Icon, work }: { icon: AppIcon; work: TabWork }) {
  const known = work.progress !== null;
  const share = known ? Math.max(0.04, (work.progress ?? 0) / 100) : 0.27;
  return (
    <span
      role="img"
      aria-label={work.label}
      className="relative grid size-[18px] shrink-0 place-items-center text-flow"
    >
      <svg
        viewBox="0 0 20 20"
        aria-hidden
        className={`absolute inset-0 size-full -rotate-90 ${
          known
            ? ''
            : 'animate-spin [animation-duration:1.1s] motion-reduce:animate-none'
        }`}
      >
        <circle
          cx="10"
          cy="10"
          r="8.5"
          fill="none"
          strokeWidth="1.75"
          className="stroke-flow/20"
        />
        <circle
          cx="10"
          cy="10"
          r="8.5"
          fill="none"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeDasharray={`${share * ring} ${ring}`}
          className="stroke-flow transition-[stroke-dasharray] duration-500 ease-out"
        />
      </svg>
      <Icon size={10} />
    </span>
  );
}
