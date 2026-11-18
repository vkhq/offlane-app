import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { useActivities } from '../history';
import { isToolOn, useExternalTools } from '../externalTools';
import { type ToolGroup, featuredTools, toolGroups, tools } from '../tools';
import {
  CaretDown,
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  Plus,
  SlidersHorizontal,
  type AppIcon,
  Clock,
  House,
  Search,
} from './icons';
import { ToolkitBadge } from './Toolkits';

export const pages: { to: string; name: string; icon: AppIcon }[] = [
  { to: '/', name: 'Home', icon: House },
  { to: '/history', name: 'History', icon: Clock },
  { to: '/settings', name: 'Settings', icon: SlidersHorizontal },
];

/** The group the page at `path` belongs to, if it is a tool. */
const groupOf = (path: string) =>
  toolGroups.find((group) =>
    group.tools.some((tool) => `/${tool.id}` === path),
  );

/** How many recently used tools the sidebar lists. */
const recentLimit = 8;

// Rows run edge to edge across the panel, with no gaps between them. They keep
// their height when the panel is shorter than its list, so it scrolls instead
// and `place` measures the list's full height.
const row =
  'group flex h-9 w-full shrink-0 items-center gap-3 px-4 text-[13.5px]';

// The same brand tint as the rail's selected tile.
const link = ({ isActive }: { isActive: boolean }) =>
  `${row} ${
    isActive
      ? 'bg-brand-soft font-semibold text-brand'
      : 'font-medium text-ink/75 hover:bg-ink/5 hover:text-ink'
  }`;

/** Icons take the row's colour: dark like its name, brand on the selected one. */
const icon = 'shrink-0';

/**
 * A sidebar row's look: a rounded band inset from the sidebar's edges. The
 * selected one, or the group whose panel is open, is shaded grey; others shade
 * lighter on hover.
 */
const navRow = (selected: boolean) =>
  `app-no-drag flex h-8.5 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
    selected ? 'bg-ink/10' : 'hover:bg-ink/5'
  }`;

/** A sidebar row: its icon, then its name. */
function NavItem({ icon: Icon, label }: { icon: AppIcon; label: string }) {
  return (
    <>
      <Icon size={19} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
}

/** The signed-in person's name, once the desktop app has told us it. */
function useUserName() {
  const [name, setName] = useState('');
  useEffect(() => {
    let current = true;
    // An app started before this existed has no such bridge call yet.
    window.app
      ?.userName?.()
      .then((value) => current && setName(value))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  return name;
}

/** A small heading that folds away the list under it, as Finder's do. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [folded, setFolded] = useState(false);
  return (
    <section className="pt-5">
      <button
        type="button"
        aria-expanded={!folded}
        onClick={() => setFolded(!folded)}
        className="app-no-drag flex h-7 w-full items-center gap-1 rounded-lg px-2.5 text-left text-[13px] text-ink-soft hover:bg-ink/5 hover:text-ink"
      >
        {title}
        <CaretDown
          size={14}
          className={`transition-transform duration-150 ${
            folded ? '-rotate-90' : ''
          }`}
        />
      </button>
      {!folded && <div className="flex flex-col pt-1">{children}</div>}
    </section>
  );
}

/** The square chrome buttons beside the traffic lights. */
const chrome =
  'app-no-drag grid size-7 place-items-center rounded-md text-ink/70 hover:bg-ink/5 hover:text-ink';

/** How long the panel waits before closing, to cross the gap to it. */
const closeDelay = 200;

/** The panel's least distance from the sidebar's top and bottom, in px. */
const edgeGap = 8;

type SidebarProps = {
  /** Whether the sidebar is on screen; hidden, it folds away to the left. */
  shown: boolean;
  /** Hides the sidebar, as Cmd+\\ does. */
  onHide: () => void;
  /** Whether the floating tool panel is showing. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens quick search, the same popup as Cmd+P. */
  onSearch: () => void;
  /** Opens quick search to pick a page for a new tab, as Cmd+T does. */
  onNew: () => void;
  /** Steps back or forward through the current tab's pages. */
  onStep: (direction: 1 | -1) => void;
};

/**
 * Docked down the window's left side, full height: chrome buttons beside the
 * traffic lights, the pages, then sections for the tool groups, the pinned
 * favourites and the tools used lately, each of which folds away. Hovering or clicking a group opens a panel floating
 * beside the sidebar with that group's tools. It stays open while the pointer
 * is on the group or the panel, and closes when it leaves them, on Escape, or
 * once a tool is picked.
 */
export function Sidebar({
  shown,
  onHide,
  open,
  onOpenChange,
  onSearch,
  onNew,
  onStep,
}: SidebarProps) {
  const { pathname } = useLocation();
  const activities = useActivities();
  const name = useUserName();
  // Each tool once, most recently used first. Pinned tools are already listed
  // above, so they are left out.
  // A tool waiting to be turned on in Settings isn't listed anywhere.
  const external = useExternalTools();
  const listed = (tool: (typeof tools)[number]) => isToolOn(tool, external);
  const recent = [...new Set(activities.map((activity) => activity.toolId))]
    .filter((id) => !featuredTools.some((tool) => tool.id === id))
    .map((id) => tools.find((tool) => tool.id === id))
    .filter((tool): tool is (typeof tools)[number] => !!tool && listed(tool))
    .slice(0, recentLimit);
  const current = groupOf(pathname);
  // The group the panel lists. It starts as the current page's group.
  const [section, setSection] = useState<ToolGroup>(current ?? toolGroups[0]);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const aside = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  // Whether the panel was already showing when it was last placed, so a
  // switch between groups glides to the new place and size, while opening
  // starts right there.
  const placed = useRef(false);
  // The rail entry the panel was opened from, which it lines up with.
  const anchor = useRef<HTMLElement>(null);

  const stayOpen = () => clearTimeout(closing.current);
  const closeSoon = () => {
    stayOpen();
    closing.current = setTimeout(() => onOpenChange(false), closeDelay);
  };
  const show = (group: ToolGroup, from: HTMLElement) => {
    stayOpen();
    anchor.current = from;
    setSection(group);
    onOpenChange(true);
  };
  const hide = () => {
    stayOpen();
    onOpenChange(false);
  };

  // Picking a tool, or any other page, closes the panel.
  useEffect(() => hide(), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => stayOpen, []);

  // Where the panel goes, from the strongest rule to the weakest: whole inside
  // the sidebar; reaching past the entry it was opened from at both ends, so
  // that entry is always beside it; within the middle 60% of the sidebar's
  // height; and centred on the entry, as far as those allow.
  const place = () => {
    const box = aside.current?.getBoundingClientRect();
    const from = anchor.current?.getBoundingClientRect();
    const node = panel.current;
    const frame = card.current;
    if (!box || !from || !node || !frame || !list.current) return;
    // The height it is heading for, not the one it may be animating through:
    // its whole list and padding, up to its 1rem-short-of-the-sidebar cap.
    const style = getComputedStyle(frame);
    const padding =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const height = Math.min(
      list.current.scrollHeight + padding,
      box.height - 16,
    );
    const clamp = (value: number, min: number, max: number) =>
      Math.max(Math.min(value, max), min);
    const entryTop = from.top - box.top;
    const entryBottom = from.bottom - box.top;

    let top = (entryTop + entryBottom) / 2 - height / 2;
    // The middle band; a panel taller than it is centred on it instead.
    const bandTop = box.height * 0.2;
    const bandBottom = box.height * 0.8;
    top =
      height <= bandBottom - bandTop
        ? clamp(top, bandTop, bandBottom - height)
        : box.height / 2 - height / 2;
    // A panel shorter than the entry cannot reach past it, so it is centred
    // on it instead, wholly beside it.
    top =
      height >= entryBottom - entryTop
        ? clamp(top, entryBottom - height, entryTop)
        : (entryTop + entryBottom) / 2 - height / 2;
    top = clamp(top, edgeGap, box.height - height - edgeGap);

    // Set inline, so they win over the classes: top and height animate only
    // when moving from one group to another.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const glide = placed.current && !still;
    // The card fades, not the panel: a backdrop blur sees nothing behind a
    // fading ancestor, so it would only show once the fade had finished.
    node.style.transitionProperty = still
      ? 'none'
      : glide
        ? 'translate, top'
        : 'translate';
    frame.style.transitionProperty = still
      ? 'none'
      : glide
        ? 'opacity, height'
        : 'opacity';
    node.style.top = `${top}px`;
    frame.style.height = `${height}px`;
    placed.current = true;
  };

  // Before paint, so it never shows in the wrong place; and again whenever
  // the window resizes or the rail scrolls the entry along.
  useLayoutEffect(() => {
    if (!open) {
      placed.current = false;
      return;
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, section]);

  // The page you are on is the one marked. A tool's group is not shaded but
  // takes a dot; the grey is for the group whose panel is showing.
  const isSelected = (item: { to: string }) => item.to === pathname;

  // Shared by the page rows: going to a page closes the panel, so the page
  // is the one marked. Not on click: the app's tab routing swallows link
  // clicks before React sees them.
  const closeOnGo = {
    onMouseEnter: hide,
    onMouseDown: (event: React.MouseEvent) => {
      if (event.button === 0) onOpenChange(false);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') onOpenChange(false);
    },
  };

  return (
    // Docked beside the page, the full height of the window. Hiding folds
    // its width to nothing, sliding the card out past the left edge; it
    // stays mounted so it can slide back in, but inert. Its card clips
    // itself, so the tool panel can float past its edge.
    <aside
      ref={aside}
      inert={!shown}
      className={`relative shrink-0 transition-[width] duration-300 ease-out motion-reduce:transition-none ${
        shown ? 'w-55' : 'w-0'
      }`}
    >
      {/* Pinned to the aside's right edge, so it slides as the width folds. */}
      <div className="sidebar-glass absolute inset-y-0 right-0 flex w-55 flex-col overflow-hidden">
        {/* Level with the tab bar: room for the traffic lights, then the
            sidebar toggle and back and forward. The rest of it drags the
            window. */}
        <div className="app-drag flex h-10 shrink-0 items-center gap-0.5 pl-22">
          <button
            type="button"
            aria-label="Hide sidebar"
            title="Hide sidebar (⌘\\)"
            onClick={onHide}
            className={chrome}
          >
            <PanelLeft size={17} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Back"
            title="Back (⌘[)"
            onClick={() => onStep(-1)}
            className={chrome}
          >
            <ChevronLeft size={17} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Forward"
            title="Forward (⌘])"
            onClick={() => onStep(1)}
            className={chrome}
          >
            <ChevronRight size={17} strokeWidth={1.75} />
          </button>
        </div>

        <nav
          onScroll={() => open && place()}
          className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-3 pb-4"
        >
          <button
            type="button"
            onClick={onNew}
            onMouseEnter={hide}
            title="New tab (⌘T)"
            className={navRow(false)}
          >
            <NavItem icon={Plus} label="New tab" />
          </button>
          <button
            type="button"
            onClick={onSearch}
            onMouseEnter={hide}
            title="Search (⌘P)"
            className={navRow(false)}
          >
            {/* Opens a popup rather than a page, so it is never selected. */}
            <NavItem icon={Search} label="Search" />
          </button>

          {pages.map(({ to, name, icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              draggable={false}
              className={navRow(isSelected({ to }))}
              {...closeOnGo}
            >
              <NavItem icon={icon} label={name} />
            </NavLink>
          ))}

          <Section title="Tools">
            {toolGroups.map((group) => (
              <button
                key={group.name}
                type="button"
                onMouseEnter={(event) => show(group, event.currentTarget)}
                onMouseLeave={closeSoon}
                // For keyboards and taps, which have no hover.
                onClick={(event) => show(group, event.currentTarget)}
                aria-expanded={open && group === section}
                // Shaded only while its panel shows; the page's group is
                // marked by a dot instead.
                className={navRow(open && group === section)}
              >
                <NavItem icon={group.icon} label={group.name} />
                {group === current && (
                  <span className="ml-auto size-1.5 shrink-0 rounded-full bg-brand">
                    <span className="sr-only">(current tool)</span>
                  </span>
                )}
              </button>
            ))}
          </Section>

          <Section title="Pinned">
            {featuredTools.filter(listed).map((tool) => (
              <NavLink
                key={tool.id}
                to={`/${tool.id}`}
                draggable={false}
                className={navRow(isSelected({ to: `/${tool.id}` }))}
                {...closeOnGo}
              >
                <NavItem icon={tool.icon} label={tool.name} />
                <ToolkitBadge tool={tool} />
              </NavLink>
            ))}
          </Section>

          <Section title="Recents">
            {recent.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[13px] text-ink-soft">
                Tools you run show up here.
              </p>
            ) : (
              recent.map((tool) => (
                <NavLink
                  key={tool.id}
                  to={`/${tool.id}`}
                  draggable={false}
                  className={navRow(isSelected({ to: `/${tool.id}` }))}
                  {...closeOnGo}
                >
                  <span className="truncate">{tool.name}</span>
                </NavLink>
              ))
            )}
          </Section>
        </nav>

        {/* Who is using the app: their initial in a grey circle, then their
            name. A plain browser has no way to know, so it shows nothing. */}
        {name && (
          <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink/10 text-[13px] font-medium text-ink/75">
              {name[0].toUpperCase()}
            </span>
            <span className="truncate text-[14px]">{name}</span>
          </div>
        )}
      </div>

      {/* Floats over the page just past the rail, as tall as its list and
          lined up with the entry it was opened from (see `place`). Rounded and
          frosted like the quick search popup, with a shadow to lift it off
          the page. The gap between it and the rail is a transparent part of
          it, so the pointer crossing it, or resting there, keeps it open.
          It stays mounted so it can slide and fade out as well as in; closed,
          it is transparent, tucked towards the rail, and inert. */}
      <div
        ref={panel}
        inert={!open}
        onMouseEnter={stayOpen}
        onMouseLeave={closeSoon}
        className={`absolute left-full z-20 flex max-h-[calc(100%-1rem)] flex-col pl-2 transition-[translate] duration-200 ease-out motion-reduce:transition-none ${
          open
            ? 'pointer-events-auto translate-x-0'
            : 'pointer-events-none -translate-x-2'
        }`}
      >
        {/* Its height is set by `place`, so it can animate between groups.
            It does the fading, so its blur shows all the way through. */}
        <div
          ref={card}
          className={`flex min-h-0 w-55 flex-col overflow-hidden rounded-2xl bg-popup/65 py-2 shadow-popup backdrop-blur-2xl backdrop-saturate-150 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <nav
            ref={list}
            // A new list for each group, so its entries fade in on a switch.
            key={section.name}
            // No visible heading; the group's name is announced instead.
            aria-label={section.name}
            className="flex min-h-0 animate-fade-in flex-col overflow-y-auto motion-reduce:animate-none"
          >
            {section.tools.filter(listed).map((tool) => (
              <NavLink
                key={tool.id}
                to={`/${tool.id}`}
                draggable={false}
                className={link}
              >
                {({ isActive }) => (
                  <>
                    {/* Solid when selected, as in the rail. */}
                    <tool.icon size={19} filled={isActive} className={icon} />
                    <span className="truncate">{tool.name}</span>
                    <ToolkitBadge tool={tool} />
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </aside>
  );
}
