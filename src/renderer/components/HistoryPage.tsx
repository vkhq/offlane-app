import { type CSSProperties, useRef, useState } from 'react';

import type { SessionStatus, SessionSummary } from '../../shared/types';
import { useDownloads } from '../downloads';
import { clearActivities } from '../history';
import {
  type SessionState,
  statusOf,
  useOpenSession,
  useSessions,
} from '../sessions';
import { useTabScroll } from '../tabState';
import { useAllJobs } from '../toolkit/jobs';
import { tools } from '../tools';
import { Clock, ListVideo, X } from './icons';

/**
 * Every tool session as a timeline, grouped by the day it was last worked
 * on (11 Nov; 7 Oct 2025), newest first: a row each, with its
 * tool's icon on the line, what happened as its title, a small picture of
 * what it worked on, and its details (see SessionRow). The list fades out
 * at the foot of the page as it scrolls under.
 */
export function HistoryPage() {
  const sessions = useSessions();
  const openSession = useOpenSession();
  const scroller = useRef<HTMLDivElement>(null);
  useTabScroll(scroller);
  const progress = useProgress();
  const shapes = useShapes();
  const groups = byDay(sessions);

  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="relative flex-1 overflow-y-auto mask-[linear-gradient(to_bottom,#000_calc(100%-8rem),transparent)]"
      >
        <div className="mx-auto w-[calc(80%+30.4px)] max-w-[977.6px] px-10 pt-16 pb-40">
          <div className="flex items-end justify-between gap-4 pb-4">
            <div>
              <h1 className="font-serif text-[36px] leading-tight font-semibold tracking-[-0.02em]">
                History
              </h1>
              <p className="pt-2 text-[14px] text-ink/70">
                Pick up any session where you left off.
              </p>
            </div>
            {sessions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearActivities();
                  void window.sessions.clear();
                }}
                className="h-7.5 shrink-0 rounded-lg bg-group px-3 text-[13px] font-medium hover:bg-field"
              >
                Clear History
              </button>
            )}
          </div>

          {sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-1 pt-16 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-canvas text-ink-soft ring-1 ring-feed-ring">
                <Clock size={18} />
              </span>
              <p className="pt-3 text-[14px] font-medium">Nothing here yet</p>
              <p className="text-ink-soft">
                Run any tool and it will show up here.
              </p>
            </div>
          ) : (
            <div className="font-feed">
              {groups.map(({ key, label, sessions: group }) => (
                <section key={key} className="pt-8 first:pt-2">
                  <h2 className="pb-5 text-[13px] leading-5 font-medium text-feed-heading uppercase">
                    {label}
                  </h2>
                  <ol className="-mx-2 flex flex-col gap-2">
                    {group.map((session, at) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        progress={progress}
                        shape={shapeFromRuns(session, shapes)}
                        last={at === group.length - 1}
                        onOpen={() => openSession(session.id)}
                      />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/** How far along each run under way is, by id, 0–100 or null. */
function useProgress() {
  const downloads = useDownloads();
  const jobs = useAllJobs();
  const progress = new Map<string, number | null>();
  for (const job of downloads) {
    progress.set(job.id, job.progress?.percent ?? null);
  }
  for (const job of jobs) progress.set(job.id, job.progress);
  return progress;
}

/**
 * The words for how a session stands: Draft, Downloading 45%, Compressed.
 *
 * One with several runs (a playlist) leads with how it stands as a whole,
 * then how many were saved, then any others that need a word: Paused · 2
 * of 6 downloaded · 1 cancelled; Cancelled · 2 of 6 downloaded; All 6
 * downloaded; 5 of 6 downloaded · 1 failed.
 */
function statusLabel(
  session: SessionSummary,
  status: SessionState,
  progress: Map<string, number | null>,
) {
  const { meta } = session;
  const playlist = playlistSize(session);
  const runs = Object.values(meta.jobs ?? {});
  const count = (state: SessionStatus) =>
    runs.filter((run) => run === state).length;
  const done = count('done');
  // Out of the videos queued (one removed no longer counts), else all of
  // the playlist's.
  const total = runs.length || playlist || 0;
  const finished = (meta.done ?? 'done').toLowerCase();
  const several = Boolean(playlist) || runs.length > 1;

  let word: string;
  switch (status) {
    case 'draft':
      return playlist ? `Draft · ${playlist} videos` : 'Draft';
    case 'running': {
      // The runs under way, on average, once any can tell.
      const known = Object.entries(meta.jobs ?? {})
        .filter(([, state]) => state === 'running')
        .map(([id]) => progress.get(id))
        .filter((value): value is number => typeof value === 'number');
      const doing = meta.doing ?? 'In progress';
      word =
        known.length === 0
          ? doing
          : `${doing} ${Math.floor(
              known.reduce((sum, value) => sum + value, 0) / known.length,
            )}%`;
      break;
    }
    case 'paused':
      word = 'Paused';
      break;
    case 'done':
      if (!several) return meta.done ?? 'Done';
      return total === 1 ? `1 ${finished}` : `All ${total} ${finished}`;
    case 'partial':
      word = '';
      break;
    case 'failed':
      if (several && total > 1 && count('failed') === total) {
        return `All ${total} failed`;
      }
      word = 'Failed';
      break;
    case 'cancelled':
      word = 'Cancelled';
      break;
  }
  if (!several) return word;

  // The others besides those saved, unless the lead word already says so.
  const lead: Partial<Record<SessionState, SessionStatus>> = {
    paused: 'paused',
    cancelled: 'cancelled',
    failed: 'failed',
  };
  const others = (['paused', 'cancelled', 'failed'] as const)
    .filter((state) => state !== lead[status] && count(state) > 0)
    .map((state) => `${count(state)} ${state}`);
  return [word, `${done} of ${total} ${finished}`, ...others]
    .filter(Boolean)
    .join(' · ');
}

/** The shape of each finished download, by id, read from its file. */
function useShapes() {
  const shapes = new Map<string, number>();
  for (const job of useDownloads()) {
    if (job.aspect) shapes.set(job.id, job.aspect);
  }
  return shapes;
}

/** The shape of what a session's runs made, if any of them knows it. */
function shapeFromRuns(session: SessionSummary, shapes: Map<string, number>) {
  for (const id of Object.keys(session.meta.jobs ?? {})) {
    const shape = shapes.get(id);
    if (shape) return shape;
  }
  return undefined;
}

/**
 * How a session stands, as a dot and a word, in the colours of the tool
 * page's own step pills: grey to start or when stopped, purple while under
 * way (the dot pulsing), green once done, red if it failed.
 */
const statusLooks: Record<SessionState, { dot: string; text: string }> = {
  draft: { dot: 'bg-ink-faint', text: 'text-feed-meta' },
  running: { dot: 'bg-flow animate-pulse', text: 'text-flow' },
  paused: { dot: 'bg-ink-faint', text: 'text-feed-meta' },
  done: { dot: 'bg-green-600', text: 'text-green-900' },
  partial: { dot: 'bg-amber-500', text: 'text-amber-800' },
  failed: { dot: 'bg-brand', text: 'text-brand' },
  cancelled: { dot: 'bg-ink-faint', text: 'text-feed-meta' },
};

/**
 * One session on the timeline, a single line across: the time it was last
 * worked on (24-hour), joined to the next row's by the line; a picture of
 * what it worked on in a 16:9 slot (an upright one at its own shape in its
 * middle; the tool's icon when there is none); then what it
 * worked on, and under that the tool and how it stands. Every row is the
 * same height, so the times, frames and titles line up. Pressing it opens
 * the session again; the ✕ that shows on hover forgets it.
 */
function SessionRow({
  session,
  progress,
  shape,
  last,
  onOpen,
}: {
  session: SessionSummary;
  progress: Map<string, number | null>;
  /** The shape of what its runs made, when known: it outranks the rest. */
  shape: number | undefined;
  /** The day's last row: the line stops at its time. */
  last: boolean;
  onOpen: () => void;
}) {
  // An older session has no shape saved; its picture's own is read once
  // it loads.
  const [loaded, setLoaded] = useState<number>();
  const tool = tools.find((candidate) => candidate.id === session.toolId);
  if (!tool) return null;
  const Icon = tool.icon;
  const { thumbnail } = session.meta;
  // A playlist's videos: those queued (a removed one no longer counts),
  // else all of them.
  const size = playlistSize(session);
  const playlist = size
    ? Object.keys(session.meta.jobs ?? {}).length || size
    : undefined;
  const status = statusOf(session.meta.jobs);
  const look = statusLooks[status];
  const aspect = shape ?? session.meta.aspect ?? loaded;
  // Upright, or near square: the picture stands at its own shape.
  const whole = aspect !== undefined && aspect < 1.2;

  return (
    <li className="group relative">
      {/* The line, from under this time to under the next: every row is
          the same height, so it is one row's height long. */}
      {!last && (
        <span
          aria-hidden
          className="absolute top-[calc(50%+14px)] left-[29.5px] h-[calc(100%-20px)] w-px bg-feed-line"
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer items-center gap-4 rounded-[22px] p-2 pr-12 text-left outline-none transition-colors duration-150 group-hover:bg-ink/[0.035] focus-visible:bg-ink/[0.035]"
      >
        <time
          dateTime={new Date(session.updatedAt).toISOString()}
          className="w-11 shrink-0 text-center text-[13px] text-feed-meta tabular-nums"
        >
          {timeOf(session.updatedAt)}
        </time>
        {/* A 16:9 slot, so every row's text starts at the same place. A
            wide picture fills it; an upright one stands at its own shape in
            the middle of it, with nothing around it. Either way the picture
            itself has the rounded corners. */}
        <span className="grid aspect-video h-18 shrink-0 place-items-center">
          {thumbnail ? (
            <span
              style={{ '--ratio': whole ? aspect : 16 / 9 } as CSSProperties}
              className="relative aspect-(--ratio) h-full overflow-hidden rounded-[14px] bg-group ring-1 ring-black/5 [corner-shape:squircle]"
            >
              <img
                src={thumbnail}
                alt=""
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalHeight) {
                    setLoaded(image.naturalWidth / image.naturalHeight);
                  }
                }}
                className="absolute inset-0 size-full object-cover"
              />
              {playlist ? <PlaylistBadge count={playlist} /> : null}
            </span>
          ) : (
            <span className="relative grid size-full place-items-center rounded-2xl bg-group text-ink-faint ring-1 ring-black/5 [corner-shape:squircle]">
              <Icon size={22} />
              {playlist ? <PlaylistBadge count={playlist} /> : null}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] leading-snug font-medium tracking-[-0.01em] text-feed-ink">
            {session.title || tool.name}
          </span>
          <span className="flex items-center gap-2 pt-1 text-[13px] text-feed-meta">
            <span className="truncate">
              {tool.name}
              {playlist ? ' · Playlist' : ''}
            </span>
            <span
              aria-hidden
              className="size-0.75 shrink-0 rounded-full bg-feed-ring"
            />
            <span className={`flex shrink-0 items-center gap-1.5 ${look.text}`}>
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${look.dot}`}
              />
              {statusLabel(session, status, progress)}
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${session.title} from History`}
        title="Remove from History"
        onClick={() => void window.sessions.remove(session.id)}
        className="invisible absolute top-1/2 right-3 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-feed-meta group-hover:visible hover:bg-ink/5 hover:text-feed-ink focus-visible:visible"
      >
        <X size={13} />
      </button>
    </li>
  );
}

/**
 * How many videos a playlist session has, or undefined for anything else.
 * A session saved before History kept this still says so in its summary:
 * "Playlist · 6 videos · …".
 */
function playlistSize({ meta, summary }: SessionSummary) {
  if (meta.playlist) return meta.playlist;
  const said = /^Playlist · (\d+) videos?/.exec(summary ?? '');
  return said ? Number(said[1]) : undefined;
}

/** A playlist's mark on its picture: the list icon and how many videos. */
function PlaylistBadge({ count }: { count: number }) {
  return (
    <span className="absolute right-1 bottom-1 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] leading-tight font-semibold text-white tabular-nums backdrop-blur-sm">
      <ListVideo size={11} />
      {count}
    </span>
  );
}

/**
 * Sessions by the day they were last worked on, newest day first and
 * newest first within it (as they come), each by its short date: 11 Nov,
 * with the year only when it isn't this one (7 Oct 2025). A
 * session whose tool is no longer in the app is left out.
 */
function byDay(sessions: SessionSummary[]) {
  const groups = new Map<
    string,
    { key: string; label: string; sessions: SessionSummary[] }
  >();
  const now = new Date();
  for (const session of sessions) {
    if (!tools.some((tool) => tool.id === session.toolId)) continue;
    const date = new Date(session.updatedAt);
    const key = dayKey(date);
    let group = groups.get(key);
    if (!group) {
      const label = date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
      });
      group = { key, label, sessions: [] };
      groups.set(key, group);
    }
    group.sessions.push(session);
  }
  return [...groups.values()];
}

/** A local calendar day, as 2026-11-09. */
function dayKey(date: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The time of day, 24-hour: 09:42, 15:42. */
function timeOf(at: number) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
