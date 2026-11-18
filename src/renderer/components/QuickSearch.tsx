import { useMemo, useState } from 'react';

import { useListedGroups } from '../externalTools';
import { type ToolGroup, toolGroups } from '../tools';
import { type AppIcon, ChevronRight, Ellipsis, Search } from './icons';
import { pages } from './Sidebar';

/** Something the popup can open. */
type LinkRow = {
  kind: 'link';
  to: string;
  name: string;
  icon: AppIcon;
  /** Other words the row is found by, after its name. */
  keywords?: string[];
  /** Draws a chevron at the end of the row. */
  more?: true;
};

/** A line in the popup: a link, or a "Show All" that expands a group. */
type Row = LinkRow | { kind: 'expand'; group: string };

type Section = { heading?: string; rows: Row[]; divided?: true };

// How many tools a group shows before its "Show All" row.
const preview = 5;

const pageRows: LinkRow[] = pages.map((page) => ({ kind: 'link', ...page }));

type ToolRows = { name: string; rows: LinkRow[] }[];

/** Each group's tools as rows: only those listed now (see externalTools). */
const rowsOf = (groups: ToolGroup[]): ToolRows =>
  groups.map((group) => ({
    name: group.name,
    rows: group.tools.map(
      (tool): LinkRow => ({
        kind: 'link',
        to: `/${tool.id}`,
        name: tool.name,
        icon: tool.icon,
        keywords: tool.keywords,
      }),
    ),
  }));

/** With nothing typed: each group's first few tools, then the pages. */
function browse(toolRows: ToolRows, expanded: string[]): Section[] {
  return [
    ...toolRows.map(({ name, rows }): Section => {
      const all = expanded.includes(name) || rows.length <= preview;
      return {
        heading: name,
        rows: all
          ? rows
          : [...rows.slice(0, preview), { kind: 'expand', group: name }],
      };
    }),
    {
      divided: true,
      rows: pageRows.map((row) => ({ ...row, more: true })),
    },
  ];
}

/**
 * Names that start with the query first, then names that contain it, then
 * rows with a keyword that contains it.
 */
function search(toolRows: ToolRows, needle: string): Section[] {
  const rows = [...pageRows, ...toolRows.flatMap((group) => group.rows)]
    .map((row) => {
      const name = row.name.toLowerCase();
      // Names and keywords are searched, not groups or descriptions.
      const rank = name.startsWith(needle)
        ? 0
        : name.includes(needle)
          ? 1
          : row.keywords?.some((word) => word.toLowerCase().includes(needle))
            ? 2
            : -1;
      return { row, rank };
    })
    .filter((match) => match.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((match) => match.row);
  return [{ heading: 'Results', rows }];
}

/**
 * The Cmd+P popup: type to filter, Up and Down to move, Return or a click to
 * open. It is mounted only while open, so it always starts empty.
 */
type QuickSearchProps = {
  onClose: () => void;
  /** Called with the picked page, and whether Cmd was held while picking. */
  onOpen: (path: string, withModifier: boolean) => void;
  /** The shortcut that opened the popup, shown beside the field. */
  hint: string;
};

export function QuickSearch({ onClose, onOpen, hint }: QuickSearchProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]);

  const needle = query.trim().toLowerCase();
  const listed = useListedGroups(toolGroups);
  const toolRows = useMemo(() => rowsOf(listed), [listed]);
  const sections = needle
    ? search(toolRows, needle)
    : browse(toolRows, expanded);
  const rows = sections.flatMap((section) => section.rows);

  const activate = (row: Row, newTab: boolean) => {
    if (row.kind === 'expand') {
      // The selection stays put, landing on the first newly shown tool.
      setExpanded((current) => [...current, row.group]);
    } else {
      onClose();
      onOpen(row.to, newTab);
    }
  };

  const move = (step: number) =>
    setSelected((current) => (current + step + rows.length) % rows.length);

  // Rows are numbered in reading order across every section.
  let index = -1;
  const renderSection = (section: Section) => (
    <div
      key={section.heading ?? 'pages'}
      role="group"
      aria-label={section.heading ?? 'Pages'}
      className={section.divided ? 'border-t border-ink/10 pt-2' : ''}
    >
      {section.heading && (
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-ink-faint">
          {section.heading}
        </p>
      )}
      {section.rows.map((row) => {
        index += 1;
        const position = index;
        const active = position === selected;
        const Icon = row.kind === 'link' ? row.icon : Ellipsis;
        return (
          <div
            key={row.kind === 'link' ? row.to : row.group}
            id={`quick-search-${position}`}
            role="option"
            aria-selected={active}
            // Keeps the arrow-key selection on screen.
            ref={
              active
                ? (item) => item?.scrollIntoView({ block: 'nearest' })
                : undefined
            }
            onMouseMove={() => setSelected(position)}
            onClick={(event) => activate(row, event.metaKey || event.ctrlKey)}
            className={`flex h-9.25 items-center gap-2.5 rounded-lg px-2.5 text-[15px] ${
              active ? 'bg-ink/8' : ''
            }`}
          >
            <Icon size={17} className="shrink-0 text-ink-soft" />
            <span className="flex-1 overflow-hidden whitespace-nowrap">
              {row.kind === 'link' ? row.name : 'Show All'}
            </span>
            {(row.kind === 'expand' || row.more) && (
              <ChevronRight size={17} className="shrink-0 text-ink-faint" />
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-20 flex items-start justify-center pt-28"
    >
      <div
        role="dialog"
        aria-label="Quick search"
        onMouseDown={(event) => event.stopPropagation()}
        className="flex h-100 w-150 flex-col rounded-2xl bg-popup/65 shadow-popup backdrop-blur-2xl backdrop-saturate-150"
      >
        <label className="flex h-14 shrink-0 items-center gap-3 pr-5 pl-5.5 border-b border-ink/10">
          <Search size={19} className="shrink-0 text-ink-soft" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="quick-search-results"
            aria-activedescendant={rows[selected] && `quick-search-${selected}`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') return onClose();
              if (rows.length === 0) return;
              if (event.key === 'ArrowDown') move(1);
              else if (event.key === 'ArrowUp') move(-1);
              else if (event.key === 'Enter')
                activate(rows[selected], event.metaKey || event.ctrlKey);
              else return;
              event.preventDefault();
            }}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-[17px] caret-accent outline-none select-text placeholder:text-ink-faint"
          />
          <kbd className="font-sans text-[17px] text-ink-faint">{hint}</kbd>
        </label>

        <div
          id="quick-search-results"
          role="listbox"
          className="flex min-h-0 flex-col"
        >
          <div className="no-scrollbar overflow-y-auto px-2.5">
            {sections.filter((section) => !section.divided).map(renderSection)}
            {rows.length === 0 && (
              <p className="py-6 text-center text-[15px] text-ink-soft">
                No Results
              </p>
            )}
          </div>
          {/* The pages stay pinned under the list. */}
          <div className="shrink-0 px-2.5 pb-2.5">
            {sections.filter((section) => section.divided).map(renderSection)}
          </div>
        </div>
      </div>
    </div>
  );
}
