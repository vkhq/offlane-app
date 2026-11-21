import {
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { ArrowRight } from '../components/icons';
import { type Tool, toolGroups, tools } from '../tools';
import { canvasMoveEvent } from './Canvas';
import { useConnectedIds } from './jobs';
import { StageContext, type StepInput, useSteps } from './steps';

/** The black What's Next? button under a single result: a step of the
 *  flow in its own right. */
const nextButton =
  'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-linear-to-b from-neutral-600 to-neutral-950 px-4 text-[13px] font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_6px_16px_rgb(0_0_0/0.22)] ring-4 ring-ink/8 transition-[filter,scale] hover:brightness-125 active:scale-[0.98]';
/** Under each of several results: a plain chip, quiet in its row. */
const chip =
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-ink-soft ring-1 ring-black/10 ring-inset hover:bg-ink/5 hover:text-ink aria-expanded:bg-ink/5 aria-expanded:text-ink';

/** Marks a What's Next? list, wherever it is drawn. */
const menuAttribute = 'data-next-menu';

/**
 * Whether a What's Next? menu is open, and the element its button lives in:
 * a press outside both, or Escape, closes it. It also closes when the
 * page scrolls or the canvas moves, as it would no longer sit by its
 * button.
 */
function useMenu() {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (wrapper.current?.contains(target) ||
        (target instanceof Element
          ? target.closest(`[${menuAttribute}]`)
          : target.parentElement?.closest(`[${menuAttribute}]`)));
    const onDown = (event: PointerEvent) => {
      if (!inside(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onMove = (event: Event) => {
      if (!inside(event.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    const onCanvas = () => setOpen(false);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    window.addEventListener(canvasMoveEvent, onCanvas);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener(canvasMoveEvent, onCanvas);
    };
  }, [open]);
  return { open, setOpen, wrapper };
}

/**
 * The tools a run's outputs can go on to: picking one adds a step as a
 * branch below the stage they came from, with these outputs as its input (it runs once per output,
 * as for several dropped files). Tools that work first, then those in the
 * same group as the tool that made them, then by name. Outputs of mixed
 * kinds offer what takes the first one's kind, for those of that kind.
 */
function useNext(all: StepInput[], from?: Tool) {
  const steps = useSteps();
  const stage = useContext(StageContext);
  const connected = useConnectedIds() ?? [];
  const kind = all[0]?.kind;
  const outputs = all.filter((output) => output.kind === kind);
  if (!steps || !kind) return null;

  const rank = (tool: Tool) =>
    (connected.includes(tool.id) ? 0 : 2) +
    (tool.group === from?.group ? 0 : 1);
  const next = tools
    .filter((tool) => tool.accepts?.includes(kind))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  if (next.length === 0) return null;

  const start = (tool: Tool) => steps.add(tool.id, outputs, stage);
  return { next, start, outputs };
}

/**
 * Under one of several results: a What's Next? chip, which opens the same
 * list as the button under a single result does, floating over the page so
 * the results stay as they are. Picking a tool adds its step below,
 * working on this result's outputs.
 */
export function NextSteps({
  outputs,
  from,
}: {
  outputs: StepInput[];
  /** The tool that made them, whose group comes first. */
  from?: Tool;
}) {
  const next = useNext(outputs, from);
  const { open, setOpen, wrapper } = useMenu();
  const button = useRef<HTMLButtonElement>(null);
  if (!next) return null;
  return (
    <div ref={wrapper} className="pt-2">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className={chip}
      >
        What’s next?
        <ArrowRight size={12} strokeWidth={2.25} />
      </button>
      {open && (
        <NextToolsMenu
          anchor={button}
          tools={next.next}
          onPick={(tool) => {
            setOpen(false);
            next.start(tool);
          }}
        />
      )}
    </div>
  );
}

/**
 * The next tools as a workflow step of their own, under a stage's results:
 * the flow runs on to a black What's Next? button, which opens a list of
 * the tools that take these outputs as their input: a search field, and the
 * tools by group. Picking one adds its step as a branch below, starting
 * with these outputs. It stays once there are branches, to add another:
 * they fork from it.
 */
export function NextStepNode({
  outputs,
  from,
}: {
  outputs: StepInput[];
  from?: Tool;
}) {
  const next = useNext(outputs, from);
  const { open, setOpen, wrapper } = useMenu();
  const button = useRef<HTMLButtonElement>(null);

  if (!next) return null;
  return (
    <div className="flex flex-col items-center pt-1.5">
      <span className="flow-joint" />
      <span className="flow-line h-6 animate-grow-down" />
      <div ref={wrapper} className="flex flex-col items-center">
        <button
          ref={button}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((shown) => !shown)}
          className={nextButton}
        >
          What’s next?
          <ArrowRight size={14} strokeWidth={2.25} />
        </button>
        {open && (
          <NextToolsMenu
            anchor={button}
            tools={next.next}
            onPick={(tool) => {
              setOpen(false);
              next.start(tool);
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The list a What's Next? button opens, as a dark popover: a plain search
 * line over a rule, then every tool that takes these outputs in one list,
 * under quiet labels for their categories (Video, Audio…), each its icon
 * and name. Typing narrows it. The row under the pointer, or
 * picked with the arrow keys, is lit softly; Return picks it.
 */
function NextToolsMenu({
  tools: offered,
  onPick,
  anchor,
}: {
  tools: Tool[];
  onPick: (tool: Tool) => void;
  /** The button it opens from: it floats beside it, over the page. */
  anchor: RefObject<HTMLElement | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  // It opens to the right of its button, so it's clear which
  // one opened it: its top level with the button's, moved up only as far
  // as it must to stay in the window, and shorter (its list scrolling) if
  // the window is shorter than it.
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  useLayoutEffect(() => {
    const button = anchor.current;
    if (!button || !panel.current) return;
    // At least this far from every edge of the window.
    const margin = 36;
    const gap = 8;
    const at = button.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = panel.current;
    // Its own cap (max-h-[26rem]) still holds: measured under it, it must
    // not then grow past it.
    const cap = Number.parseFloat(getComputedStyle(panel.current).maxHeight);
    const maxHeight = Math.min(
      Number.isFinite(cap) ? cap : height,
      window.innerHeight - margin * 2,
    );
    const shown = Math.min(height, maxHeight);
    setPlace({
      // In a window too narrow for it beside the button, as far right as
      // it can go.
      left: Math.max(
        margin,
        Math.min(at.right + gap, window.innerWidth - width - margin),
      ),
      top: Math.max(
        margin,
        Math.min(at.top, window.innerHeight - shown - margin),
      ),
      maxHeight,
    });
  }, [anchor]);

  const needle = query.trim().toLowerCase();
  const matching = offered.filter((tool) =>
    [tool.name, tool.description, ...(tool.keywords ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
  // Under their categories (Video, Audio…), the likeliest first, as they
  // are offered.
  const sections = [...new Set(matching.map((tool) => tool.group))].map(
    (id) => ({
      id,
      name: toolGroups.find((group) => group.id === id)?.name ?? id,
      tools: matching.filter((tool) => tool.group === id),
    }),
  );
  const rows = sections.flatMap((section) => section.tools);
  const lit = Math.min(active, rows.length - 1);

  // The lit row stays in view as the arrow keys move it: the list scrolls,
  // never the page.
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector<HTMLElement>('[data-lit="true"]');
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (
      row.offsetTop + row.offsetHeight >
      box.scrollTop + box.clientHeight
    ) {
      box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
    }
  }, [lit]);

  const row = (on: boolean) =>
    `flex h-10 w-full cursor-default items-center gap-3 rounded-[12px] px-3 text-left text-[14px] ${
      on ? 'bg-white/10' : ''
    }`;
  const menu = (
    <div
      ref={panel}
      role="menu"
      aria-label="Tools to use next"
      {...{ [menuAttribute]: '' }}
      // Hidden until it has been placed.
      style={
        place
          ? { left: place.left, top: place.top, maxHeight: place.maxHeight }
          : { left: 0, top: 0, visibility: 'hidden' }
      }
      className="fixed z-50 flex max-h-[26rem] w-72 origin-left animate-pop-in flex-col overflow-hidden rounded-[22px] bg-neutral-800 text-left text-white shadow-popup"
    >
      <div className="shrink-0 px-5 pt-4">
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (rows.length === 0) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((lit + step + rows.length) % rows.length);
            } else if (event.key === 'Enter' && rows[lit]) {
              event.preventDefault();
              onPick(rows[lit]);
            }
          }}
          placeholder="Search tools…"
          aria-label="Search tools"
          className="h-9 w-full bg-transparent text-[14px] text-white outline-none placeholder:text-white/45"
        />
        <div className="mt-2 h-px bg-white/10" />
      </div>
      <div
        ref={list}
        className="relative min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-white/45">
            No tools match “{query.trim()}”.
          </p>
        ) : (
          sections.map((section) => (
            <section key={section.id} className="pb-1">
              <p className="px-3 pt-1.5 pb-1.5 text-[12px] text-white/45">
                {section.name}
              </p>
              {section.tools.map((tool) => {
                const at = rows.indexOf(tool);
                const Icon = tool.icon;
                const on = at === lit;
                return (
                  <div
                    key={tool.id}
                    role="menuitem"
                    tabIndex={-1}
                    data-lit={on}
                    onPointerMove={() => setActive(at)}
                    onClick={() => onPick(tool)}
                    className={row(on)}
                  >
                    <Icon size={16} className="shrink-0 text-white/85" />
                    <span className="truncate">{tool.name}</span>
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
  // Drawn over everything, so nothing on the page clips or scales it.
  return createPortal(menu, document.body);
}
