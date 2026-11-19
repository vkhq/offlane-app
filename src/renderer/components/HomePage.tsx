import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';

import { useTabScroll, useTabState } from '../tabState';
import { useListedGroups } from '../externalTools';
import { type Tool, type ToolGroup, toolGroups } from '../tools';
import { hasModifier } from './keys';
import { RotatingPlaceholder } from './RotatingPlaceholder';
import { toolColors } from './toolColors';
import {
  ChevronLeft,
  ChevronRight,
  GalleryHorizontal,
  LayoutGrid,
  LayoutList,
  Search,
} from './icons';
import { ToolkitBadge } from './Toolkits';

/**
 * How a group's tools are laid out: one scrolling row of cards, wrapping rows
 * of cards, or a compact list, one tool to a line.
 */
type View = 'carousel' | 'grid' | 'list';

const views = [
  { view: 'carousel', label: 'Carousel view', icon: GalleryHorizontal },
  { view: 'grid', label: 'Grid view', icon: LayoutGrid },
  { view: 'list', label: 'List view', icon: LayoutList },
] as const;

// The choice is remembered on this computer.
const viewKey = 'home-view';

const savedView = (): View => {
  try {
    const saved = localStorage.getItem(viewKey);
    return views.find(({ view }) => view === saved)?.view ?? 'carousel';
  } catch {
    return 'carousel';
  }
};

/** The landing page: a colourful welcome, then every tool, group by group. */
export function HomePage() {
  const [query, setQuery] = useTabState('query', '');
  const [view, setView] = useState(savedView);

  const chooseView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(viewKey, next);
    } catch {
      // Storage is unavailable; the choice still holds for this session.
    }
  };

  const searchField = useRef<HTMLInputElement>(null);
  // Whether the search field is focused, kept in state rather than left to
  // :focus-within. The field autofocuses, so it starts out focused and is
  // drawn lifted from the first frame; :focus-within only matches once the
  // focus lands, a moment after the page shows, which animated it in.
  const [searchFocused, setSearchFocused] = useState(true);
  useEffect(() => {
    setSearchFocused(document.activeElement === searchField.current);
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  useTabScroll(scroller);

  // Cmd+F jumps to the search field and selects what is in it, as Find does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const field = searchField.current;
      if (!hasModifier(event) || event.shiftKey || event.altKey) return;
      if (event.code !== 'KeyF' || !field) return;
      event.preventDefault();
      field.focus();
      field.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const needle = query.trim().toLowerCase();

  // Searching narrows every row to the tools whose name matches.
  // A tool waiting to be turned on in Settings isn't listed.
  const listed = useListedGroups(toolGroups);
  const groups = listed
    .map((group) => ({
      ...group,
      tools: group.tools.filter((tool) =>
        tool.name.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.tools.length > 0);
  const count = listed.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    // Plain white: the window frame around it carries the app's colour.
    <main className="relative flex min-w-0 flex-1 flex-col">
      <div ref={scroller} className="relative flex-1 overflow-y-auto pb-10">
        <div className="relative flex h-72 flex-col items-center justify-end px-10 pb-8 text-center">
          <h1 className="font-serif text-[36px] leading-tight font-semibold tracking-[-0.02em]">
            What would you like to do?
          </h1>
          <p className="pt-2 text-[14px] text-ink/70">
            {count} tools for video, audio, images, PDFs and text, all in one
            place.
          </p>
          {/* Borderless like the cards below it: a faint grey fill at rest,
              solid white and lifted on a shadow while focused. */}
          <label
            className={`mt-6 flex h-12 w-full max-w-110 items-center gap-2.5 rounded-full px-4 text-ink-soft transition-[background-color,box-shadow] duration-500 ease-out motion-reduce:transition-none ${
              searchFocused ? 'bg-canvas shadow-float' : 'bg-ink/5'
            }`}
          >
            <Search size={17} className="shrink-0" />
            <span className="relative flex min-w-0 flex-1 self-stretch">
              {query === '' && <RotatingPlaceholder />}
              <input
                ref={searchField}
                type="search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                aria-label="Search tools"
                className="relative min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none select-text"
              />
            </span>
          </label>
        </div>

        {/* The column every row sits in, centred. For cards it is sized so
            they come out at 80% of the width four would have filling the
            space between the 40px gutters: with the 72px of gaps that is 80%
            of the space plus 30.4px, at most 977.6px, cards 206px across. The
            list is at most 752px, so a tool's name and description stay
            close. The side gutter lives here, so rows run edge to edge
            inside it. */}
        <div
          className={`relative mx-auto px-10 ${
            view === 'list'
              ? 'w-full max-w-208'
              : 'w-[calc(80%+30.4px)] max-w-[977.6px]'
          }`}
        >
          {/* The view toggle rides on the first group's heading line rather
              than a row of its own, so the rows start close under search. */}
          {groups.map((group, index) => (
            <ToolGroupSection
              key={group.name}
              group={group}
              view={view}
              aside={
                index === 0 && (
                  <div
                    role="radiogroup"
                    aria-label="View"
                    className="flex gap-0.5 rounded-lg bg-group p-0.5"
                  >
                    {views.map(({ view: option, label, icon: Icon }) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={view === option}
                        aria-label={label}
                        title={label}
                        onClick={() => chooseView(option)}
                        className={`grid h-7 w-8 place-items-center rounded-md ${
                          view === option
                            ? 'bg-canvas shadow-float'
                            : 'text-ink-soft hover:text-ink'
                        }`}
                      >
                        <Icon size={16} />
                      </button>
                    ))}
                  </div>
                )
              }
            />
          ))}
          {groups.length === 0 && (
            <p className="pt-16 text-center text-ink-soft">
              No tools match &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

const arrow =
  'grid size-7 place-items-center rounded-full bg-group text-ink-soft hover:bg-field hover:text-ink';

function ToolGroupSection({
  group,
  view,
  aside,
}: {
  group: ToolGroup;
  view: View;
  /** Shown at the end of the heading line, before any arrows. */
  aside?: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  // A row shows four cards, so only a longer carousel has anywhere to scroll.
  const scrolls = view === 'carousel' && group.tools.length > 4;

  // One click moves a whole page: the four cards showing, plus the 24px gap,
  // less the track's 16px padding on either side.
  const scroll = (direction: 1 | -1) =>
    track.current?.scrollBy({
      left: direction * (track.current.clientWidth - 32 + 24),
      behavior: 'smooth',
    });

  return (
    <section className="pt-8">
      {/* The minimum height keeps headings level with or without arrows. */}
      {/* Raised, so the carousel's padding below cannot cover the arrows. */}
      <div className="relative z-10 flex min-h-10 items-center gap-2 pb-3">
        <h2 className="flex-1 text-[15px] font-semibold">
          {group.name}
          <span className="pl-2 font-medium text-ink-faint">
            {group.tools.length}
          </span>
        </h2>
        {aside && <div className={scrolls ? 'mr-2' : ''}>{aside}</div>}
        {scrolls && (
          <>
            <button
              type="button"
              aria-label={`Scroll ${group.name} back`}
              onClick={() => scroll(-1)}
              className={arrow}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label={`Scroll ${group.name} forward`}
              onClick={() => scroll(1)}
              className={arrow}
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>

      {view === 'list' ? (
        <div className="flex flex-col">
          {group.tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </div>
      ) : (
        // The carousel scrolls sideways, which clips it top and bottom too, so
        // it is padded, and pulled back out by as much, to leave room for a
        // hovered card's scale and shadow. The sides take 16px, less than the
        // 24px gap, so no sliver of the next card shows past the fourth.
        <div
          ref={track}
          className={
            view === 'grid'
              ? 'flex flex-wrap gap-6'
              : 'no-scrollbar -mx-4 -mt-4 -mb-10 flex snap-x scroll-px-4 gap-6 overflow-x-auto px-4 pt-4 pb-10'
          }
        >
          {group.tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * A tool's card: its banner filling a tall frame, softly blurred and shaded
 * at the bottom, with its name and description laid over it.
 */
function ToolCard({ tool }: { tool: Tool }) {
  // The banner loads lazily, as its card nears the screen. Until it has
  // loaded the card is a plain light grey, so it is never an empty frame; the
  // banner then fades in over it, with the text, and the grey goes once it
  // has. White text over the grey would not read, so it waits too.
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [bannerShown, setBannerShown] = useState(false);
  // A banner already in the cache, as on coming back to Home, is ready before
  // the first paint: show it at once rather than fading it in again.
  const banner = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (banner.current?.complete && banner.current.naturalWidth > 0) {
      setBannerLoaded(true);
      setBannerShown(true);
    }
  }, []);
  const onBannerLoad = () => {
    setBannerLoaded(true);
    // With reduced motion there is no fade, so no transitionend to wait for.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setBannerShown(true);
    }
  };

  return (
    <Link
      to={`/${tool.id}`}
      draggable={false}
      style={toolColors(tool)}
      // A quarter of the row, less its share of the three 24px gaps. Under
      // the pointer, or in focus, it grows slightly and lifts on a shadow,
      // faded in from a clear one of the same shape so the filter animates.
      className="group w-[calc((100%-72px)/4)] shrink-0 snap-start drop-shadow-[0_12px_14px_rgb(0_0_0/0)] transition-[scale,filter] duration-300 ease-out outline-none hover:scale-[1.03] hover:drop-shadow-card-hover focus-visible:scale-[1.03] focus-visible:drop-shadow-card-hover motion-reduce:transition-none"
    >
      {/* Shaped by a squircle mask, which clips the image. The grey shows
          only until a banner has faded in, so it cannot fringe the image's
          curved edge. A tool with no banner shows its gradient instead. */}
      <div
        className={`squircle relative aspect-square overflow-hidden ${
          !tool.banner
            ? 'bg-linear-to-br from-(--gradient-from) to-(--gradient-to)'
            : bannerShown
              ? ''
              : 'bg-group'
        }`}
      >
        {tool.banner && (
          <img
            src={tool.banner}
            alt=""
            draggable={false}
            ref={banner}
            loading="lazy"
            decoding="async"
            onLoad={onBannerLoad}
            onTransitionEnd={() => setBannerShown(true)}
            className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ease-out motion-reduce:transition-none ${
              bannerLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        {/* The banner carries its own blur and shade, baked in by npm run
            banners in a deep tone of its colours. A card with no banner
            shades its gradient here so the text still reads. */}
        {!tool.banner && (
          <div className="absolute inset-x-0 bottom-0 h-3/4 bg-linear-to-t from-black/80 via-black/50 to-transparent" />
        )}

        {/* Inset 20px: the squircle curves in past a 16px inset near its
            corners, which would clip the description. */}
        <div
          className={`absolute inset-x-0 bottom-0 p-5 text-white transition-opacity duration-300 ease-out motion-reduce:transition-none ${
            !tool.banner || bannerLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <p className="truncate text-[14px] leading-tight font-semibold tracking-[-0.01em]">
            {tool.name}
          </p>
          {/* Always three lines tall (3 x the 1.375 line height), however
              many it fills, so every card's name sits at the same height. */}
          <p className="line-clamp-3 h-[4.125em] box-content pt-1 text-[12px] leading-snug text-white/90">
            {tool.description}
          </p>
        </div>
      </div>
    </Link>
  );
}

/** A tool in the list view: its icon, name and description on one line. */
function ToolRow({ tool }: { tool: Tool }) {
  const Icon = tool.icon;

  return (
    <Link
      to={`/${tool.id}`}
      draggable={false}
      className="group flex h-10 items-center gap-2.5 rounded-lg px-2 hover:bg-ink/3"
    >
      <Icon size={17} className="shrink-0 text-ink-soft group-hover:text-ink" />
      <span className="w-56 shrink-0 truncate text-[14px] font-semibold">
        {tool.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] text-ink-soft">
        {tool.description}
      </span>
      <ToolkitBadge tool={tool} />
      <ChevronRight
        size={14}
        className="shrink-0 text-ink-faint opacity-0 group-hover:opacity-100"
      />
    </Link>
  );
}
