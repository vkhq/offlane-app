import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Ellipsis, LoaderCircle, Play, Repeat } from '../components/icons';
import {
  type PlayerFile,
  clock,
  speeds,
  step,
  usePlayback,
} from './PlayerModal';
import { Pause } from './playerIcons';

/** How many bars the waveform has. */
const bars = 60;

/** The one player sounding now, so starting another pauses it. */
let sounding: HTMLAudioElement | null = null;

/**
 * A finished audio file's result card, which is its player too, as music
 * players show a track: its name and details (with What's Next?
 * under them among several results) and its menu; a waveform that fills
 * in the brand colour as it plays (press or drag anywhere on it to go
 * there), and beside it Play, the time, Loop and the speed, which steps
 * through 1×, 1.25×, 1.5×, 2×, 0.5× and 0.75×. Compact, as a result
 * among others: the keys skip 15 s.
 *
 * The file is readied to play the first time it is played or sought, not
 * when the card shows, so a long list of results costs nothing until then.
 * Only one plays at a time.
 *
 * Keys, while it has focus: Space or K plays and pauses, ←/→ or J/L skip
 * 15 s, M mutes.
 */
export function AudioPlayer({
  file,
  title,
  details,
  next,
  onMenu,
}: {
  file: PlayerFile;
  title: string;
  /** What it is: WAV · 1.2 MB · the tool's note. */
  details: string;
  /** What's Next? for it, when it is one of several. */
  next?: ReactNode;
  /** Opens its menu (Open, Show in Finder, Remove). */
  onMenu: () => void;
}) {
  /** Asked to play (or seek): from then on it is readied and loaded. */
  const [wanted, setWanted] = useState(false);
  const sound = useRef<HTMLAudioElement>(null);
  /** Where to start once loaded, if sought before it was. */
  const startAt = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  /** Its loudness along its length: undefined while it is read, null for
   *  none (no sound, or no FFmpeg to read it with). */
  const [peaks, setPeaks] = useState<number[] | null>();

  // Read once per file; the main process keeps it for the next time.
  useEffect(() => {
    const ref = file.media;
    if (!ref) return setPeaks(null);
    let live = true;
    window.media
      .waveform(ref, bars)
      .then((found) => live && setPeaks(found))
      .catch(() => live && setPeaks(null));
    return () => {
      live = false;
    };
  }, [file.id]);

  // Gone from the page: quiet, and no longer the one sounding.
  useEffect(
    () => () => {
      if (sounding === sound.current) sounding = null;
    },
    [],
  );

  const toggle = () => {
    const s = sound.current;
    if (!s) return setWanted(true);
    if (s.paused || s.ended) void s.play();
    else s.pause();
  };

  const skip = (seconds: number) => {
    const s = sound.current;
    if (!s) return;
    s.currentTime = Math.min(
      Math.max(0, s.currentTime + seconds),
      s.duration || 0,
    );
  };

  /** Goes to `share` (0–1) of the way through, loading it first if need be. */
  const seek = (share: number) => {
    const s = sound.current;
    if (s && s.duration) {
      s.currentTime = share * s.duration;
      setTime(s.currentTime);
    } else {
      startAt.current = share;
      setWanted(true);
    }
  };

  const nextSpeed = () => {
    const order = [1, 1.25, 1.5, 2, 0.5, 0.75].filter((value) =>
      speeds.includes(value),
    );
    const value = order[(order.indexOf(speed) + 1) % order.length];
    setSpeed(value);
    if (sound.current) sound.current.playbackRate = value;
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const onButton = (event.target as HTMLElement).closest('button');
    switch (event.key) {
      case ' ':
        // A focused button takes Space itself.
        if (onButton) return;
        toggle();
        break;
      case 'k':
        toggle();
        break;
      case 'ArrowLeft':
      case 'j':
        skip(-step);
        break;
      case 'ArrowRight':
      case 'l':
        skip(step);
        break;
      case 'm':
        if (sound.current) sound.current.muted = !sound.current.muted;
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      role="group"
      aria-label={`${title}, audio`}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2.5 rounded-3xl bg-canvas px-4 py-3 shadow-card select-none"
    >
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span title={title} className="truncate text-[14px] font-semibold">
            {title}
          </span>
          <span title={details} className="truncate text-[12px] text-ink-soft">
            {details}
          </span>
          {next}
        </div>
        <button
          type="button"
          aria-label="More actions"
          onClick={onMenu}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-well hover:text-ink"
        >
          <Ellipsis size={16} />
        </button>
      </div>

      {wanted && (
        <Loader
          file={file}
          sound={sound}
          loop={loop}
          speed={speed}
          onLoaded={(s) => {
            setDuration(s.duration);
            if (startAt.current !== null) {
              s.currentTime = startAt.current * s.duration;
              startAt.current = null;
            }
          }}
          onTime={setTime}
          onDuration={setDuration}
          onPlaying={setPlaying}
        />
      )}

      {/* One row: Play, the waveform, the time, then Loop and speed. */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          onClick={toggle}
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-canvas transition-[opacity,scale] hover:opacity-90 active:scale-95"
        >
          {playing ? (
            <Pause size={16} />
          ) : (
            <Play size={16} filled className="translate-x-px" />
          )}
        </button>
        <Waveform peaks={peaks} time={time} duration={duration} onSeek={seek} />
        <span className="min-w-[4.5rem] shrink-0 text-right text-[11px] font-medium text-ink-soft tabular-nums">
          {clock(time, duration)} /{' '}
          {duration ? clock(duration, duration) : '–:––'}
        </span>
        <Control
          label={loop ? 'Loop: On' : 'Loop: Off'}
          pressed={loop}
          onClick={() => setLoop((value) => !value)}
        >
          <Repeat size={15} />
        </Control>
        <Control label={`Speed: ${speed}×`} onClick={nextSpeed}>
          <span className="text-[11px] font-semibold tabular-nums">
            {speed}×
          </span>
        </Control>
      </div>
    </div>
  );
}

/**
 * Readies the file once it is first wanted, then holds its <audio>, which
 * starts playing at once (unless it was only sought). Says how readying is
 * going, or why it can't play, in place of nothing.
 */
function Loader({
  file,
  sound,
  loop,
  speed,
  onLoaded,
  onTime,
  onDuration,
  onPlaying,
}: {
  file: PlayerFile;
  sound: RefObject<HTMLAudioElement | null>;
  loop: boolean;
  speed: number;
  onLoaded: (sound: HTMLAudioElement) => void;
  onTime: (time: number) => void;
  onDuration: (duration: number) => void;
  onPlaying: (playing: boolean) => void;
}) {
  const [state] = usePlayback(file);
  const [error, setError] = useState('');

  if (state.kind === 'failed' || error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-group px-4 py-3">
        <p className="text-[12px] font-medium">
          {error || state.kind !== 'failed' ? error : state.message}
        </p>
        <button
          type="button"
          onClick={file.open}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full bg-ink px-3.5 text-[13px] font-semibold text-canvas hover:opacity-90"
        >
          Open in Default App
        </button>
      </div>
    );
  }
  if (state.kind === 'preparing') {
    return (
      <p
        role="status"
        className="flex items-center gap-1.5 text-[12px] text-ink-soft"
      >
        <LoaderCircle size={13} className="animate-spin" />
        {state.stage === 'transcode' ? 'Converting for playback' : 'Loading'}
        {state.percent !== null && ` · ${Math.floor(state.percent)}%`}
      </p>
    );
  }
  return (
    <audio
      ref={sound}
      src={state.url}
      autoPlay
      loop={loop}
      onLoadedMetadata={(event) => {
        event.currentTarget.playbackRate = speed;
        onLoaded(event.currentTarget);
      }}
      onDurationChange={(event) => onDuration(event.currentTarget.duration)}
      onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
      onPlay={(event) => {
        // One at a time: another card's sound stops.
        if (sounding && sounding !== event.currentTarget) sounding.pause();
        sounding = event.currentTarget;
        onPlaying(true);
      }}
      onPause={() => onPlaying(false)}
      onEnded={() => onPlaying(false)}
      onError={() => {
        onPlaying(false);
        setError("This file can't be played in the app.");
      }}
    />
  );
}

/**
 * The sound's loudness as a row of rounded bars, played ones in the brand
 * colour, and those up to the pointer tinted while it hovers. Pressing
 * anywhere goes there, and dragging scrubs. Flat, pulsing bars stand in
 * while it is read; flat ones stay for a file it can't be read from.
 */
function Waveform({
  peaks,
  time,
  duration,
  onSeek,
}: {
  peaks: number[] | null | undefined;
  time: number;
  duration: number;
  /** Where to go, as a share (0–1) of the way through. */
  onSeek: (share: number) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  /** Where the pointer rests along it, 0 to 1, while it hovers. */
  const [hover, setHover] = useState<number | null>(null);
  const played = duration ? time / duration : 0;
  const loudest = Math.max(0.01, ...(peaks ?? []));
  const heights = Array.from({ length: bars }, (_, index) =>
    // Quiet parts still show as a short bar, as music players draw them.
    peaks ? 12 + 88 * Math.min(1, (peaks[index] ?? 0) / loudest) : 12,
  );

  const at = (event: ReactPointerEvent) => {
    const box = row.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  };

  return (
    <div
      ref={row}
      role="slider"
      tabIndex={-1}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${clock(time, duration)} of ${clock(duration, duration)}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onSeek(at(event));
      }}
      onPointerMove={(event) => {
        const where = at(event);
        setHover(where);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          onSeek(where);
        }
      }}
      onPointerLeave={() => setHover(null)}
      className={`flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-between gap-px ${
        peaks === undefined ? 'animate-pulse' : ''
      }`}
    >
      {heights.map((height, index) => {
        const middle = (index + 0.5) / bars;
        const tone =
          middle <= played
            ? 'bg-brand'
            : hover !== null && middle <= hover
              ? 'bg-brand/35'
              : 'bg-ink/15';
        return (
          <span
            key={index}
            className={`w-[2px] shrink-0 rounded-full transition-colors duration-150 ${tone}`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

/** A round button in the row of controls; `pressed` for a toggle that is
 *  on (Loop), shown in the brand colour. */
function Control({
  label,
  onClick,
  pressed,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-7 shrink-0 cursor-pointer place-items-center rounded-full disabled:cursor-default disabled:opacity-40 ${
        pressed
          ? 'bg-brand/10 text-brand'
          : 'text-ink-soft enabled:hover:bg-well enabled:hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
