import { useEffect, useRef, useState } from 'react';

import { Plus } from '../components/icons';
import { type Tool, toolGroups, tools } from '../tools';
import { useConnectedIds } from './jobs';
import { type StepInput, useSteps } from './steps';

/** How many tools show as chips; the rest are under More…. */
const shown = 3;

const chip =
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ring-1 ring-black/10 ring-inset hover:bg-ink/5';

/**
 * The tools a run's outputs can go on to: picking one adds a step below, on
 * the same page, with these outputs as its input (it runs once per output,
 * as for several dropped files). Tools that work first, then those in the
 * same group as the tool that made them, then by name. Outputs of mixed
 * kinds offer what takes the first one's kind, for those of that kind.
 */
function useNext(all: StepInput[], from?: Tool) {
  const steps = useSteps();
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

  const start = (tool: Tool) => steps.add(tool.id, outputs);
  const more = async () => {
    const choice = await window.app.contextMenu(
      next.slice(shown).map((tool) => ({ id: tool.id, label: tool.name })),
    );
    const tool = next.find((candidate) => candidate.id === choice);
    if (tool) start(tool);
  };
  /** Whether a step already works on these outputs. */
  const taken = steps.steps.some((step) =>
    step.inputs.some((input) =>
      outputs.some((output) => output.jobId === input.jobId),
    ),
  );
  return { next, start, more, taken, outputs };
}

function Chips({
  next,
  start,
  more,
}: Pick<NonNullable<ReturnType<typeof useNext>>, 'next' | 'start' | 'more'>) {
  return (
    <>
      {next.slice(0, shown).map((tool) => {
        const Icon = tool.icon;
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => start(tool)}
            className={chip}
          >
            <Icon size={14} />
            {tool.name}
          </button>
        );
      })}
      {next.length > shown && (
        <button type="button" onClick={() => void more()} className={chip}>
          More…
        </button>
      )}
    </>
  );
}

/** The next tools as chips in a line, under one of several results. */
export function NextSteps({
  outputs,
  from,
}: {
  outputs: StepInput[];
  /** The tool that made them, whose group comes first. */
  from?: Tool;
}) {
  const next = useNext(outputs, from);
  if (!next) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="pr-0.5 text-xs text-ink-soft">Do more with it:</span>
      <Chips {...next} />
    </div>
  );
}

/**
 * The next tools as a workflow step of their own, under a single result:
 * the flow runs on to a black What's Next? button, which opens a list of
 * the tools that take these outputs as their input: a search field, and the
 * tools by group, each with what it does. Picking one adds
 * its step right below, starting with these outputs, in this one's place.
 */
export function NextStepNode({
  outputs,
  from,
}: {
  outputs: StepInput[];
  from?: Tool;
}) {
  const next = useNext(outputs, from);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // A press outside the list, or Escape, closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!next || next.taken) return null;
  return (
    <div className="flex flex-col items-center pt-1.5">
      <span className="flow-joint" />
      <span className="flow-line h-6 animate-grow-down" />
      <div ref={wrapper} className="flex flex-col items-center">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((shown) => !shown)}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-linear-to-b from-neutral-600 to-neutral-950 px-4 text-[13px] font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_6px_16px_rgb(0_0_0/0.22)] ring-4 ring-ink/8 transition-[filter,scale] hover:brightness-125 active:scale-[0.98]"
        >
          <Plus size={14} strokeWidth={2.25} />
          What’s next?
        </button>
        {open && (
          <NextToolsMenu
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
}: {
  tools: Tool[];
  onPick: (tool: Tool) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  /** Brings it whole into view, once it has settled where it opens. */
  const reveal = () =>
    panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

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
  return (
    <div
      ref={panel}
      role="menu"
      aria-label="Tools to use next"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) reveal();
      }}
      // In the page's flow, with 150px clear below it, so the page can
      // always scroll it whole into view.
      className="mt-3 mb-[150px] flex max-h-[26rem] w-72 origin-top animate-pop-in scroll-mb-[150px] flex-col overflow-hidden rounded-[22px] bg-neutral-800 text-left text-white shadow-popup"
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
}
