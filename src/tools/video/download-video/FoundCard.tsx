import {
  type CSSProperties,
  Fragment,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import type { ProbeResult } from '../../../shared/types';
import { RoundCheckbox } from '../../ui';

export type Found = ProbeResult & { probeToken: string };

/**
 * Thumbnails by lookup, kept in memory rather than with the tab: inlined, a
 * thumbnail is a few hundred KB, too much to save with every tab. After a
 * reload the card shows a grey frame instead.
 */
const images = new Map<string, string>();

/** Keeps a lookup's thumbnail, returning the lookup without it. */
export function keepThumbnail(found: Found): Found {
  if (found.thumbnailImage) images.set(found.probeToken, found.thumbnailImage);
  return { ...found, thumbnailImage: null };
}

/** A lookup's kept thumbnail, if there is one (none after a reload). */
export const thumbnailOf = (found: Found) => images.get(found.probeToken);

/** A playlist's videos' pictures, by lookup and place, once fetched. */
const entryImages = new Map<string, string | null>();
const entryFetches = new Map<string, Promise<string | null>>();

/**
 * The picture of video `index` of a playlist lookup, fetched by the main
 * process when first `wanted`, then kept; null until then, or if it has
 * none.
 */
function useEntryImage(token: string, index: number, wanted: boolean) {
  const key = `${token}:${index}`;
  const [image, setImage] = useState(() => entryImages.get(key) ?? null);
  useEffect(() => {
    if (!wanted) return;
    if (entryImages.has(key)) {
      setImage(entryImages.get(key) ?? null);
      return;
    }
    let live = true;
    let fetching = entryFetches.get(key);
    if (!fetching) {
      fetching = window.downloader
        .entryThumbnail(token, index)
        .catch(() => null)
        .then((found) => {
          entryImages.set(key, found);
          entryFetches.delete(key);
          return found;
        });
      entryFetches.set(key, fetching);
    }
    void fetching.then((found) => live && setImage(found));
    return () => {
      live = false;
    };
  }, [key, token, index, wanted]);
  return image;
}

/**
 * The card's shape: 9:16 for an upright video (a reel, a Short), else
 * 16:9, whatever the video's exact shape; 16:9 too when the site doesn't
 * say, and for a playlist.
 */
function shapeOf(found: Found) {
  const ratio = found.kind === 'video' ? found.aspectRatio : null;
  return ratio && Number.isFinite(ratio) && ratio < 1 ? 9 / 16 : 16 / 9;
}

/** The site, as people know it: YouTube rather than yt-dlp's "Youtube". */
function siteName(extractor: string) {
  const known: Record<string, string> = {
    youtube: 'YouTube',
    youtubetab: 'YouTube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    twitter: 'X',
    vimeo: 'Vimeo',
    facebook: 'Facebook',
    reddit: 'Reddit',
    twitch: 'Twitch',
    twitchvod: 'Twitch',
    dailymotion: 'Dailymotion',
    soundcloud: 'SoundCloud',
  };
  const key = extractor.toLowerCase().replace(/[^a-z]/g, '');
  return known[key] ?? extractor.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** A small pill of smoked glass, for the card's top corners: it reads on any picture. */
const glass =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-black/35 px-2.5 text-[12px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-xl backdrop-saturate-150 ring-inset';

/**
 * What the lookup found, at 16:9 or upright 9:16 (see shapeOf), 384px wide,
 * or 400px tall when it stands upright, as a cinematic card: the thumbnail
 * filling squircle corners with a fine inner rim, easing in closer under
 * the pointer. Frosted glass pills sit in its top corners (the site, or
 * LIVE; the length, or a playlist's count), and over its blurred, shaded
 * foot the title, with the channel and how long ago it was posted beneath.
 */
/** Which of a playlist's videos are ticked to download, by place. */
export type Selection = {
  ticked: (index: number) => boolean;
  toggle: (index: number) => void;
  /** Shown but not changed, once its downloads have started. */
  locked: boolean;
};

export function FoundCard({
  found,
  selection,
}: {
  found: Found;
  /** A playlist's videos to download; all of them without one. */
  selection?: Selection;
}) {
  // A playlist shows one of its videos, the first to begin with, picked
  // from the strip of them under the card.
  const [selected, setSelected] = useState(0);
  const playlist = found.kind === 'playlist' && found.entries.length > 0;
  const videos = found.kind === 'playlist' ? found.entries.length : 0;

  // ← and → pick the video before or after, from anywhere on the page;
  // not while typing, in an open menu, or with the player up, which take
  // the arrows themselves.
  useEffect(() => {
    if (!playlist) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="menu"]',
        ) ||
        document.querySelector(
          '[aria-modal="true"], [role="dialog"], [role="listbox"][tabindex="-1"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      setSelected((current) =>
        Math.min(videos - 1, Math.max(0, current + step)),
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playlist, videos]);
  const entry = playlist ? found.entries[selected] : undefined;
  const picked = useEntryImage(found.probeToken, selected, playlist);
  // Until its picture arrives, the playlist's own.
  const thumbnail = picked ?? images.get(found.probeToken);
  const detailsId = useId();
  const length =
    found.kind === 'video' && !found.isLive && found.duration
      ? formatDuration(found.duration)
      : null;
  const ratio = shapeOf(found);
  const live = found.kind === 'video' && found.isLive;
  const count =
    found.kind === 'playlist'
      ? `${found.entries.length} video${found.entries.length === 1 ? '' : 's'}`
      : null;
  const byline = [
    found.uploader,
    found.kind === 'video' && found.uploadedAt != null
      ? ago(found.uploadedAt)
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const card = (
    <div
      tabIndex={0}
      aria-describedby={detailsId}
      style={{ '--ratio': ratio } as CSSProperties}
      className={`group relative mx-auto outline-none ${
        ratio >= 1 ? 'w-96' : 'w-[calc(25rem*var(--ratio))]'
      }`}
    >
      {/* Its own colours glowing softly behind it, as album art does in a
          music app: a blurred, brightened copy, larger than the card. */}
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute -inset-x-6 -inset-y-4 size-[calc(100%+3rem)] max-w-none animate-[fade-in_600ms_ease-out] object-cover opacity-25 blur-3xl saturate-125"
        />
      )}
      {/* Lifted on a drop shadow, which follows the card's corners. The
          corners are a squircle by corner-shape, not the squircle mask,
          which would stretch with a box that isn't square. */}
      <div className="drop-shadow-[0_12px_14px_rgb(0_0_0/0.16)]">
        <div className="relative aspect-(--ratio) overflow-hidden rounded-[48px] bg-group">
          {thumbnail && (
            <div className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none">
              <img
                src={thumbnail}
                alt=""
                draggable={false}
                className="absolute inset-0 size-full object-cover"
              />
              {/* The lower part blurred as the home page's cards are: a
                  blurred copy over the sharp picture, fading in from a
                  third of the way down to solid over the lowest third.
                  Only under words: a playlist's card has none. */}
              {!playlist && (
                <img
                  src={thumbnail}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 size-full scale-110 object-cover blur-2xl mask-[linear-gradient(to_bottom,transparent_35%,#000_72%)]"
                />
              )}
            </div>
          )}
          {/* Shaded towards the bottom so the words read on any picture,
              and lightly at the top behind the pills. */}
          {!playlist && (
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-black/80 via-black/40 to-transparent" />
          )}
          <div className="absolute inset-x-0 top-0 h-1/4 bg-linear-to-b from-black/25 to-transparent" />

          {/* The pills, inset clear of the curved corners. */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-5">
            <span className={glass}>
              {live && (
                <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
              )}
              {live ? 'LIVE' : siteName(found.extractor)}
            </span>
            {(length ?? count) && (
              <span className={`${glass} tabular-nums`}>{length ?? count}</span>
            )}
          </div>

          {/* The title, and who posted it when, inset 24px. A playlist's
              video is named under the card instead. */}
          {!playlist && (
            <div className="absolute inset-x-0 bottom-0 p-6 text-white">
              <p className="line-clamp-2 text-[17px] leading-snug font-semibold tracking-[-0.015em] text-balance">
                {found.title}
              </p>
              {byline && (
                <p className="truncate pt-1 text-[13px] text-white/75">
                  {byline}
                </p>
              )}
            </div>
          )}

          {/* A fine inner rim, so its edge stays crisp on any picture. */}
          <div className="pointer-events-none absolute inset-0 rounded-[48px] ring-1 ring-white/12 ring-inset" />
        </div>
      </div>
      <Details id={detailsId} found={found} length={length} />
    </div>
  );
  if (!playlist) return card;
  return (
    <div className="flex w-full flex-col items-center gap-4">
      {card}
      {/* The video shown, named under the picture rather than over it,
          a little narrower than the card. */}
      <p
        title={entry?.title}
        className="w-[22rem] max-w-full truncate text-center text-[15px] leading-snug font-semibold tracking-[-0.01em] text-ink"
      >
        {entry?.title}
      </p>
      <Strip
        found={found}
        selected={selected}
        onSelect={setSelected}
        selection={selection}
      />
    </div>
  );
}

/**
 * A playlist's videos as a row of small thumbnails under its card, wider
 * than it (the page's whole column), scrolling sideways, the one shown above outlined; pressing one shows it
 * above. Pictures load as they scroll into view, so a long playlist costs
 * nothing until it is looked through.
 */
function Strip({
  found,
  selected,
  onSelect,
  selection,
}: {
  found: Found & { kind: 'playlist' };
  selected: number;
  onSelect: (index: number) => void;
  selection?: Selection;
}) {
  const row = useRef<HTMLDivElement>(null);
  // The video shown is always in view, however it was picked; not when the
  // strip first appears, while the page scrolls to the options.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    row.current?.querySelector(`[data-place="${selected}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selected]);
  return (
    // Faded at both ends, so it shows there is more to either side.
    <div
      ref={row}
      role="listbox"
      aria-label="Videos in this playlist"
      className="no-scrollbar flex w-full gap-2 overflow-x-auto px-3 py-1.5 [mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%-12px),transparent)]"
    >
      {found.entries.map((entry, index) => (
        <Thumb
          key={`${index}-${entry.url}`}
          token={found.probeToken}
          index={index}
          title={entry.title}
          duration={entry.duration}
          chosen={index === selected}
          ticked={selection?.ticked(index) ?? true}
          locked={!selection || selection.locked}
          row={row}
          onSelect={() => onSelect(index)}
          onToggle={() => selection?.toggle(index)}
        />
      ))}
    </div>
  );
}

/**
 * One video in the strip: its picture, once near view, pressed to show it
 * above; and in its corner a round checkbox, ticked to download it. An
 * unticked one is dimmed.
 */
function Thumb({
  token,
  index,
  title,
  duration,
  chosen,
  ticked,
  locked,
  row,
  onSelect,
  onToggle,
}: {
  token: string;
  index: number;
  title: string;
  /** Seconds, if the playlist says. */
  duration: number | null;
  /** Shown in the card above. */
  chosen: boolean;
  /** To be downloaded. */
  ticked: boolean;
  locked: boolean;
  row: RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  // Its picture is asked for once it comes within a few thumbnails of view.
  useEffect(() => {
    const element = button.current;
    if (!element || near) return;
    const watch = new IntersectionObserver(
      ([seen]) => {
        if (seen?.isIntersecting) setNear(true);
      },
      { root: row.current, rootMargin: '0px 300px' },
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, [near, row]);
  const image = useEntryImage(token, index, near);

  return (
    // Two buttons side by side, as one can't hold the other: the picture,
    // and the checkbox over its corner.
    <div data-place={index} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        role="option"
        aria-selected={chosen}
        title={`${index + 1}. ${title}`}
        onClick={onSelect}
        className={`relative block aspect-video w-[88px] cursor-pointer overflow-hidden rounded-[10px] bg-group transition-[opacity,box-shadow] ${
          chosen
            ? 'ring-2 ring-flow ring-offset-2 ring-offset-canvas'
            : 'opacity-80 hover:opacity-100'
        }`}
      >
        {image && (
          <img
            src={image}
            alt=""
            draggable={false}
            className={`absolute inset-0 size-full object-cover transition-opacity ${
              ticked ? '' : 'opacity-40 grayscale'
            }`}
          />
        )}
        {/* Its length, in the corner opposite the checkbox. */}
        {duration ? (
          <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] leading-tight font-semibold text-white tabular-nums">
            {formatDuration(duration)}
          </span>
        ) : null}
      </button>
      <RoundCheckbox
        checked={ticked}
        label={`Download ${title}`}
        disabled={locked}
        onToggle={onToggle}
        className="absolute bottom-1 left-1"
      />
    </div>
  );
}

/**
 * Everything the lookup found, for screen readers: the full title, then the
 * channel, when it was posted, and its length (or that it is live, or how
 * many videos a playlist has). The card itself shows the same at a glance.
 */
function Details({
  id,
  found,
  length,
}: {
  id: string;
  found: Found;
  length: string | null;
}) {
  const rows: [string, string][] = [];
  if (found.uploader) rows.push(['Channel', found.uploader]);
  if (found.kind === 'video') {
    if (found.uploadedAt != null) {
      rows.push([
        'Posted',
        `${ago(found.uploadedAt)} · ${date.format(found.uploadedAt)}`,
      ]);
    }
    if (found.isLive) rows.push(['Duration', 'Live now']);
    else if (length) rows.push(['Duration', length]);
  } else {
    rows.push(['Videos', String(found.entries.length)]);
  }

  return (
    <div id={id} className="sr-only">
      <p>{found.title}</p>
      {rows.length > 0 && (
        <dl>
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

// In US English, as the app's text is.
const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

/** How long ago, in the largest whole unit: "16 hours ago", "3 months ago". */
function ago(time: number) {
  const seconds = (time - Date.now()) / 1000;
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ] as const;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return relative.format(0, 'minute');
}

/** A length in seconds as 1:02:03 or 2:03. */
function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const pad = (part: number) => String(part).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(total % 60)}`
    : `${minutes}:${pad(total % 60)}`;
}
