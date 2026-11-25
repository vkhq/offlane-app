import { type ReactNode, useState } from 'react';

import { type AppIcon, Ellipsis, Play } from '../components/icons';
import { ProgressBar } from '../components/ProgressBar';
import { GifPlayerModal } from './GifView';
import { type PlayerFile, PlayerModal } from './PlayerModal';

/** What a card's Play plays, in the app's player. */
export type Playable = {
  file: PlayerFile;
  title: string;
  /** Sound only: its poster shows behind it while it plays. */
  audio?: boolean;
  poster?: string;
  /** A GIF: its bytes, for the GIF player (see GifView), which shows it
   *  in place of the video player. */
  gif?: () => Promise<Uint8Array>;
};

/**
 * One result, the same card for every tool's and every download's: a
 * picture of it flush on the left (its length on it; a play badge on hover
 * when it plays), its name, a line of what it is or how it is going (a
 * progress bar under the name while under way), and its actions: Play once
 * it plays, else the action it has now (Pause, Retry, Cancel), then a menu
 * with the rest. Among several results, What's Next? sits under its line.
 *
 * Tools never draw their own: the results section (see Results.tsx) makes
 * one for each run, so a new tool gets all of this without a line of code.
 */
export function ResultCard({
  thumbnail,
  icon: Icon,
  duration,
  title,
  hint,
  details,
  failed = false,
  progress,
  play,
  action,
  onMenu,
  next,
}: {
  /** A picture of it, as a data: URL; its kind's icon until there is one. */
  thumbnail?: string | null;
  icon: AppIcon;
  /** Seconds, shown on the picture. */
  duration?: number | null;
  title: string;
  /** The title's tooltip, when it says more than the title (a file name). */
  hint?: string;
  /** What it is (MP4 · 12 MB), or how it is going. */
  details: string;
  /** The line is an error. */
  failed?: boolean;
  /** 0–100 or null while it can't tell, to show a bar; left out for none. */
  progress?: number | null;
  /** Set once it can play in the app. */
  play?: Playable;
  /** Its one action besides Play: Pause, Resume, Retry, Cancel. */
  action?: { label: string; run: () => void; danger?: boolean };
  /** Opens its menu; `play` plays it, for a menu's Play item. */
  onMenu: (play: () => void) => void;
  /** What's Next? for it, when it is one of several. */
  next?: ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  const start = () => setPlaying(true);

  return (
    <div className="flex items-center gap-4 overflow-hidden rounded-3xl bg-canvas pr-4 shadow-card">
      {/* Flush with the card's edges; once it plays, pressing it plays it,
          with a play badge on hover. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        disabled={!play}
        onClick={start}
        className="group relative grid aspect-video w-40 shrink-0 place-items-center self-stretch overflow-hidden bg-group text-ink-faint enabled:cursor-pointer"
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <Icon size={20} />
        )}
        {duration ? (
          <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] leading-tight font-semibold text-white tabular-nums backdrop-blur-sm">
            {clock(duration)}
          </span>
        ) : null}
        {play && (
          <span className="absolute inset-0 grid place-items-center bg-black/30 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Play size={22} />
          </span>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-3">
        <span
          title={hint ?? title}
          className="truncate text-[14px] font-semibold"
        >
          {title}
        </span>
        {progress !== undefined && (
          <ProgressBar value={progress} label="Progress" />
        )}
        <span
          className={`truncate text-[12px] ${failed ? 'text-brand' : 'text-ink-soft'}`}
        >
          {details}
        </span>
        {next}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {play ? (
          <button
            type="button"
            aria-label="Play"
            title="Play"
            onClick={start}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-canvas hover:opacity-90"
          >
            <Play
              size={14}
              filled={!play.audio}
              className={play.audio ? '' : 'translate-x-px'}
            />
          </button>
        ) : (
          action && (
            <button
              type="button"
              onClick={action.run}
              className={`inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-semibold ${
                action.danger
                  ? 'text-brand hover:bg-brand/10'
                  : 'bg-well text-ink hover:bg-field'
              }`}
            >
              {action.label}
            </button>
          )
        )}
        <button
          type="button"
          aria-label="More actions"
          onClick={() => onMenu(start)}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-well hover:text-ink"
        >
          <Ellipsis size={16} />
        </button>
      </div>
      {playing && play?.gif && (
        <GifPlayerModal
          load={play.gif}
          title={play.title}
          onClose={() => setPlaying(false)}
        />
      )}
      {playing && play && !play.gif && (
        <PlayerModal
          file={play.file}
          audio={play.audio}
          title={play.title}
          poster={play.poster}
          onClose={() => setPlaying(false)}
        />
      )}
    </div>
  );
}

/** Seconds as a video's length reads: 0:42, 3:07, 1:02:09. */
export function clock(seconds: number) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The menu's label for showing a file where it was saved. */
export const revealLabel = navigator.userAgent.includes('Mac')
  ? 'Show in Finder'
  : 'Show in Folder';
