import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import type { PlaybackProgress, PlaybackSource } from '../../shared/types';
import {
  Captions,
  Languages,
  LoaderCircle,
  Play,
  Volume2,
  VolumeX,
  X,
} from '../components/icons';
import {
  Fullscreen,
  MoreVertical,
  Pause,
  PictureInPicture,
  Seek,
} from './playerIcons';

type State =
  | {
      kind: 'preparing';
      stage: 'remux' | 'transcode' | null;
      percent: number | null;
    }
  | { kind: 'ready'; url: string; source: PlaybackSource }
  | { kind: 'failed'; message: string };

const revealLabel = navigator.userAgent.includes('Mac')
  ? 'Show in Finder'
  : 'Show in Folder';

/** How long the pointer may rest before the controls fade, while playing. */
const idleAfter = 2500;
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** How far the skip buttons and keys move. */
const step = 15;

/**
 * A finished download, played over the page at 80% of the window: 16:9
 * for any wide video, an upright one at its own shape. The main process makes the file playable first (see
 * main/player.ts): most play at once, an MKV is rewrapped in seconds, and a
 * stream Chromium can't decode is re-encoded, with its progress shown. If
 * even that fails, it offers the system's own player.
 *
 * The controls sit along the bottom, over a shade that darkens the picture
 * towards its foot: the title and the time, a thin scrub bar that previews
 * the frame under the pointer, and a row of buttons. While it plays they
 * fade after the pointer rests, and come back when it moves.
 *
 * A file saved with subtitles shows them, and a CC button hides them
 * (or picks among several); one saved with more than one audio language
 * has a button to switch, the original among them.
 *
 * Keys: Space or K plays and pauses, ←/→ or J/L skip 15 s, ↑/↓ set the
 * volume, M mutes, C shows or hides subtitles, F goes full screen, Esc
 * closes.
 */
/**
 * What the player plays: a finished download or a tool's output, by its
 * job's id, and how to ready it, open it and show it where it was saved.
 */
export type PlayerFile = {
  id: string;
  prepare: (audioTrack?: number) => Promise<PlaybackSource>;
  cancel: () => void;
  onProgress: (cb: (progress: PlaybackProgress) => void) => () => void;
  open: () => void;
  reveal: () => void;
};

/** A finished download, for the player. */
export const downloadFile = (id: string): PlayerFile => ({
  id,
  prepare: (track) => window.downloader.preparePlayback(id, track),
  cancel: () => void window.downloader.cancelPlayback(id),
  onProgress: (cb) => window.downloader.onPlaybackProgress(cb),
  open: () => void window.downloader.openFile(id),
  reveal: () => void window.downloader.revealFile(id),
});

/** A tool's finished output, for the player. */
export const toolFile = (id: string): PlayerFile => ({
  id,
  prepare: (track) => window.tools.preparePlayback(id, track),
  cancel: () => void window.tools.cancelPlayback(id),
  onProgress: (cb) => window.tools.onPlaybackProgress(cb),
  open: () => void window.tools.open(id),
  reveal: () => void window.tools.reveal(id),
});

export function PlayerModal({
  file,
  audio = false,
  title,
  poster,
  onClose,
}: {
  file: PlayerFile;
  /** Sound only: no picture, so its poster shows while it plays. */
  audio?: boolean;
  title: string;
  /** The video's thumbnail, shown behind an audio file while it plays. */
  poster?: string;
  onClose: () => void;
}) {
  // The latest, for effects that run once per file.
  const latest = useRef(file);
  latest.current = file;
  const [state, setState] = useState<State>({
    kind: 'preparing',
    stage: null,
    percent: null,
  });
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  // Width over height, as soon as the main process has looked at the file
  // (or the video has loaded). Until then the frame stays hidden, so it
  // never opens wide and then turns upright.
  const [known, setRatio] = useState<number | null>(null);
  // The frame's shape: an upright video's own, any wide one 16:9 (a 4:3 or
  // a 21:9 video shows whole within it, on black).
  const ratio = known !== null && known < 1 ? known : 16 / 9;
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  /** Which subtitle track shows, or -1 for none: the first to begin with,
   *  as they were chosen when downloading. */
  const [subtitle, setSubtitle] = useState(0);
  /** The last subtitle track shown, for C and the CC button to bring back. */
  const lastSubtitle = useRef(0);
  /** Where to carry on once another audio track's copy has loaded. */
  const resume = useRef<{ time: number; play: boolean } | null>(null);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number>(undefined);
  /** True while the pointer is over the panel, which then stays. */
  const overPanel = useRef(false);

  useEffect(() => {
    let live = true;
    const onProgress = (progress: PlaybackProgress) => {
      if (live && progress.id === file.id) {
        setState({
          kind: 'preparing',
          stage: progress.stage,
          percent: progress.percent,
        });
        if (progress.aspect) setRatio(progress.aspect);
      }
    };
    // Progress is only a nicety: without it, it still plays (or says why
    // it can't, below).
    let off = () => {};
    try {
      off = file.onProgress(onProgress);
    } catch {
      // No progress to show.
    }
    // Run in a promise, so even a failure before it gets going (a call the
    // app doesn't have) shows as the player's own error, not a dead click.
    Promise.resolve()
      .then(() => file.prepare())
      .then(
        (source) => {
          if (!live) return;
          // Audio has no picture: it shows its poster at 16:9. A video whose
          // shape can't be told waits for its own metadata.
          if (source.aspect) setRatio(source.aspect);
          else if (audio) setRatio(16 / 9);
          setState({ kind: 'ready', url: source.url, source });
        },
        (error: unknown) => {
          if (!live) return;
          setRatio((current) => current ?? 16 / 9);
          setState({
            kind: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    return () => {
      live = false;
      off();
      // Nothing to stop once it plays; the main process ignores it then.
      try {
        latest.current.cancel();
      } catch {
        // Nothing to stop.
      }
    };
    // Once per file, whichever object names it.
  }, [file.id, audio]);

  const source = state.kind === 'ready' ? state.source : null;
  const subtitles = source?.subtitles ?? [];
  const audioTracks = source?.audioTracks ?? [];

  // Subtitles come as text; each plays from a blob: URL of its own.
  const subtitleUrls = useMemo(
    () =>
      subtitles.map((track) =>
        URL.createObjectURL(new Blob([track.vtt], { type: 'text/vtt' })),
      ),
    [subtitles],
  );
  useEffect(
    () => () => subtitleUrls.forEach((url) => URL.revokeObjectURL(url)),
    [subtitleUrls],
  );
  // The chosen track shows; the rest stay loaded but hidden. Run again
  // once a new copy (another audio track) has its tracks.
  const showSubtitle = useCallback(() => {
    const tracks = video.current?.textTracks;
    if (!tracks) return;
    for (let index = 0; index < tracks.length; index += 1) {
      tracks[index].mode = index === subtitle ? 'showing' : 'hidden';
    }
  }, [subtitle]);
  useEffect(showSubtitle, [showSubtitle, subtitleUrls]);

  /** Shows subtitles if hidden and hides them if shown, or shows `index`. */
  const chooseSubtitle = useCallback(
    (index?: number) => {
      const next = index ?? (subtitle === -1 ? lastSubtitle.current : -1);
      if (next >= 0) lastSubtitle.current = next;
      setSubtitle(next);
    },
    [subtitle],
  );

  /** Plays audio track `index`, from where it is now. */
  const chooseAudio = async (index: number) => {
    const v = video.current;
    if (!source || index === source.audioTrack) return;
    resume.current = {
      time: v?.currentTime ?? 0,
      play: !!v && !v.paused && !v.ended,
    };
    try {
      const next = await file.prepare(index);
      setState({ kind: 'ready', url: next.url, source: next });
    } catch (error) {
      setState({
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /** Shows the controls, and fades them again later if it is playing. */
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      const v = video.current;
      if (v && !v.paused && !overPanel.current) setIdle(true);
    }, idleAfter);
  }, []);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play();
    else v.pause();
    wake();
  }, [wake]);

  const skip = useCallback(
    (seconds: number) => {
      const v = video.current;
      if (!v) return;
      v.currentTime = Math.min(
        Math.max(0, v.currentTime + seconds),
        v.duration || 0,
      );
      wake();
    },
    [wake],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen();
  }, []);

  // Focus moves into the player, so keys reach it and not the page behind.
  useEffect(() => frame.current?.focus(), []);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const v = video.current;
      // A focused button or slider in the player takes Space and the
      // arrows itself; one left focused on the page behind does not.
      const found = (event.target as HTMLElement | null)?.closest(
        'button, input',
      );
      const control = found && frame.current?.contains(found) ? found : null;
      switch (event.key) {
        case 'Escape':
          // In full screen, Esc only leaves it.
          if (!document.fullscreenElement) onClose();
          return;
        case ' ':
        case 'k':
          if (control && event.key === ' ') return;
          toggle();
          break;
        case 'ArrowLeft':
        case 'j':
          if (control?.matches('input')) return;
          skip(-step);
          break;
        case 'ArrowRight':
        case 'l':
          if (control?.matches('input')) return;
          skip(step);
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          if (!v || control?.matches('input')) return;
          v.muted = false;
          v.volume = Math.min(
            1,
            Math.max(0, v.volume + (event.key === 'ArrowUp' ? 0.1 : -0.1)),
          );
          wake();
          break;
        case 'm':
          if (v) v.muted = !v.muted;
          wake();
          break;
        case 'c':
          if (subtitles.length === 0) return;
          chooseSubtitle();
          wake();
          break;
        case 'f':
          toggleFullscreen();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    onClose,
    toggle,
    skip,
    toggleFullscreen,
    wake,
    subtitles.length,
    chooseSubtitle,
  ]);

  const openSubtitles = async () => {
    wake();
    // One track: the button just shows or hides it.
    if (subtitles.length === 1) return chooseSubtitle();
    const choice = await window.app.contextMenu([
      { id: 'off', label: `Off${subtitle === -1 ? '  ✓' : ''}` },
      null,
      ...subtitles.map((track, index) => ({
        id: String(index),
        label: `${track.label}${index === subtitle ? '  ✓' : ''}`,
      })),
    ]);
    if (choice) chooseSubtitle(choice === 'off' ? -1 : Number(choice));
  };

  const openAudio = async () => {
    wake();
    const choice = await window.app.contextMenu(
      audioTracks.map((track, index) => ({
        id: String(index),
        label: `${track.label}${track.original ? ' (Original)' : ''}${
          index === source?.audioTrack ? '  ✓' : ''
        }`,
      })),
    );
    if (choice) void chooseAudio(Number(choice));
  };

  const openMenu = async () => {
    wake();
    const choice = await window.app.contextMenu([
      ...speeds.map((value) => ({
        id: `speed:${value}`,
        label: `${value === 1 ? 'Normal speed' : `${value}×`}${
          value === speed ? '  ✓' : ''
        }`,
      })),
      null,
      { id: 'open', label: 'Open in Default App' },
      { id: 'reveal', label: revealLabel },
    ]);
    if (!choice) return;
    if (choice.startsWith('speed:') && video.current) {
      video.current.playbackRate = Number(choice.slice(6));
    }
    if (choice === 'open') {
      file.open();
      onClose();
    }
    if (choice === 'reveal') file.reveal();
  };

  const togglePip = () => {
    const v = video.current;
    if (!v) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void v.requestPictureInPicture();
  };

  const ready = state.kind === 'ready';
  // The controls show until it plays, and while the pointer moves.
  const shown = !ready || !playing || !idle;
  const fade = `transition-opacity duration-300 ${
    shown ? 'opacity-100' : 'pointer-events-none opacity-0'
  }`;

  return createPortal(
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Until its shape is known, a spinner on the dimmed page. */}
      {known === null && (
        <LoaderCircle
          size={26}
          aria-label="Loading"
          className="absolute animate-spin text-white/70"
        />
      )}
      {/* The video's shape, as large as fits in 80% of the window's width
          and height; faded and grown in once that shape is known. */}
      <div
        ref={frame}
        role="dialog"
        aria-modal
        tabIndex={-1}
        aria-label={`Playing ${title}`}
        style={{ '--ratio': ratio } as CSSProperties}
        onPointerMove={wake}
        className={`relative aspect-(--ratio) w-[min(80vw,calc(80vh*var(--ratio)))] overflow-hidden bg-black text-white shadow-popup outline-none select-none transition-[opacity,scale] duration-200 ease-out motion-reduce:transition-none ${
          shown ? '' : 'cursor-none'
        } ${known === null ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}
      >
        {ready ? (
          <video
            ref={video}
            src={state.url}
            poster={audio ? poster : undefined}
            autoPlay
            playsInline
            onClick={toggle}
            onDoubleClick={toggleFullscreen}
            onLoadedMetadata={(event) => {
              const v = event.currentTarget;
              setDuration(v.duration);
              if (v.videoWidth && v.videoHeight) {
                setRatio(v.videoWidth / v.videoHeight);
              }
              showSubtitle();
              // Another audio track: on from the same moment.
              const at = resume.current;
              if (at) {
                resume.current = null;
                v.currentTime = at.time;
                if (!at.play) v.pause();
              }
            }}
            onDurationChange={(event) =>
              setDuration(event.currentTarget.duration)
            }
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onProgress={(event) => {
              const ranges = event.currentTarget.buffered;
              if (ranges.length) setBuffered(ranges.end(ranges.length - 1));
            }}
            onPlay={() => {
              setPlaying(true);
              wake();
            }}
            onPause={() => {
              setPlaying(false);
              setIdle(false);
            }}
            onVolumeChange={(event) => {
              setVolume(event.currentTarget.volume);
              setMuted(event.currentTarget.muted);
            }}
            onRateChange={(event) => setSpeed(event.currentTarget.playbackRate)}
            onError={() =>
              setState({
                kind: 'failed',
                message: "This video can't be played in the app.",
              })
            }
            className="absolute inset-0 size-full object-contain"
          >
            {subtitles.map((track, index) => (
              <track
                key={subtitleUrls[index]}
                kind="subtitles"
                src={subtitleUrls[index]}
                srcLang={track.language || undefined}
                label={track.label}
              />
            ))}
          </video>
        ) : (
          <div className="absolute inset-0 grid place-items-center px-8 text-center">
            {state.kind === 'preparing' ? (
              <Preparing stage={state.stage} percent={state.percent} />
            ) : (
              <Failed
                message={state.message}
                onOpen={() => {
                  file.open();
                  onClose();
                }}
                onReveal={() => file.reveal()}
              />
            )}
          </div>
        )}

        <button
          type="button"
          aria-label="Close player"
          title="Close (Esc)"
          onClick={onClose}
          className={`absolute top-5 right-5 grid size-9 cursor-pointer place-items-center rounded-full bg-black/30 backdrop-blur-xl hover:bg-black/50 ${fade}`}
        >
          <X size={17} />
        </button>

        {ready && (
          <>
            {/* The shade the controls sit on, darkest at the foot. */}
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/85 via-black/40 to-transparent ${fade}`}
            />
            <div
              data-panel
              onPointerEnter={() => (overPanel.current = true)}
              onPointerLeave={() => {
                overPanel.current = false;
                wake();
              }}
              className={`absolute inset-x-0 bottom-0 flex flex-col px-10 pb-5 ${fade}`}
            >
              <div className="flex items-baseline gap-6">
                <p className="min-w-0 flex-1 truncate text-[22px] leading-tight">
                  {title}
                </p>
                <p className="shrink-0 text-[14px] font-light text-white/90 tabular-nums">
                  {clock(time, duration)} / {clock(duration, duration)}
                </p>
              </div>
              <Scrubber
                time={time}
                duration={duration}
                buffered={buffered}
                preview={audio ? undefined : state.url}
                ratio={ratio}
                onSeek={(to) => {
                  if (video.current) video.current.currentTime = to;
                  setTime(to);
                  wake();
                }}
              />
              <div className="-mx-2.5 flex items-center gap-3">
                <Control label={playing ? 'Pause' : 'Play'} onClick={toggle}>
                  {playing ? <Pause size={24} /> : <Play size={24} filled />}
                </Control>
                <Control
                  label={`Back ${step} seconds`}
                  onClick={() => skip(-step)}
                >
                  <Seek size={26} seconds={step} />
                </Control>
                <Control
                  label={`Forward ${step} seconds`}
                  onClick={() => skip(step)}
                >
                  <Seek size={26} seconds={step} forward />
                </Control>
                <span className="flex-1" />
                {/* Always there for a video, so it's plain when a file
                    has none, rather than missing. */}
                {!audio && (
                  <Control
                    label={
                      subtitles.length === 0
                        ? 'No subtitles in this file'
                        : subtitles.length > 1
                          ? 'Subtitles (C)'
                          : subtitle === -1
                            ? 'Show Subtitles (C)'
                            : 'Hide Subtitles (C)'
                    }
                    disabled={subtitles.length === 0}
                    onClick={() => void openSubtitles()}
                  >
                    <Captions
                      size={24}
                      filled={subtitles.length > 0 && subtitle !== -1}
                    />
                  </Control>
                )}
                {audioTracks.length > 1 && (
                  <Control label="Audio" onClick={() => void openAudio()}>
                    <Languages size={24} />
                  </Control>
                )}
                {document.pictureInPictureEnabled && !audio && (
                  <Control label="Picture in Picture" onClick={togglePip}>
                    <PictureInPicture size={26} />
                  </Control>
                )}
                <VolumeControl
                  volume={volume}
                  muted={muted}
                  onMute={() => {
                    if (video.current) video.current.muted = !muted;
                  }}
                  onVolume={(value) => {
                    if (!video.current) return;
                    video.current.muted = value === 0;
                    video.current.volume = value;
                  }}
                />
                <Control
                  label={fullscreen ? 'Exit Full Screen' : 'Full Screen'}
                  onClick={toggleFullscreen}
                >
                  <Fullscreen size={24} exit={fullscreen} />
                </Control>
                <Control label="More" onClick={() => void openMenu()}>
                  <MoreVertical size={24} />
                </Control>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Frosted glass over the picture: a dark smoky veil, blurred, with a soft
 *  light rim, so white text and icons read over any frame, even a white
 *  one. */
const glass =
  'bg-black/30 shadow-[inset_0_1px_0_rgb(255_255_255/0.18),inset_0_0_0_1px_rgb(255_255_255/0.1),0_8px_32px_rgb(0_0_0/0.2)] backdrop-blur-2xl backdrop-saturate-125';

/** A button in the panel's bottom row. */
function Control({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  /** Shown but not pressable, its label saying why. */
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`grid size-11 shrink-0 place-items-center rounded-full ${
        disabled
          ? 'cursor-default text-white/35'
          : 'cursor-pointer text-white hover:bg-white/15'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The time line: a hairline, played in white, with a dot at the playhead.
 * Pressing anywhere on it seeks there, and dragging scrubs. Hovering shows
 * the frame under the pointer above it, from a second, silent copy of the
 * video that seeks there.
 */
function Scrubber({
  time,
  duration,
  buffered,
  preview,
  ratio,
  onSeek,
}: {
  time: number;
  duration: number;
  buffered: number;
  /** The video's address, for the hover preview; none for audio. */
  preview?: string;
  ratio: number;
  onSeek: (time: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const still = useRef<HTMLVideoElement>(null);
  /** Where the pointer rests along the bar, 0 to 1, while it hovers. */
  const [hover, setHover] = useState<number | null>(null);
  const share = (value: number) =>
    duration ? `${Math.min(100, (value / duration) * 100)}%` : '0%';

  const at = (event: ReactPointerEvent) => {
    const box = bar.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  };

  // The preview, at the frame's shape (16:9 for any wide video, the frame
  // whole within it), kept within the bar.
  const width = 160;
  const height = Math.round(width / ratio);
  const barWidth = bar.current?.offsetWidth ?? 0;
  const left =
    hover === null
      ? 0
      : Math.min(
          Math.max(0, hover * barWidth - width / 2),
          Math.max(0, barWidth - width),
        );

  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${clock(time, duration)} of ${clock(duration, duration)}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        if (duration) onSeek(at(event) * duration);
      }}
      onPointerMove={(event) => {
        const where = at(event);
        setHover(where);
        if (still.current && duration) {
          still.current.currentTime = where * duration;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          if (duration) onSeek(where * duration);
        }
      }}
      onPointerLeave={() => setHover(null)}
      className="group/bar relative mt-3 mb-2 h-4 cursor-pointer outline-none"
    >
      {preview && (
        <div
          aria-hidden
          className={`pointer-events-none absolute bottom-full mb-2 overflow-hidden rounded-[6px] bg-black ring-[1.5px] ring-white transition-opacity duration-150 ${
            hover === null || !duration ? 'opacity-0' : 'opacity-100'
          }`}
          style={{ left, width, height }}
        >
          <video
            ref={still}
            src={preview}
            muted
            preload="auto"
            className="size-full object-contain"
          />
        </div>
      )}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 overflow-hidden rounded-full bg-white/35 transition-[height] group-hover/bar:h-[3px]">
        <div
          className="absolute inset-y-0 left-0 bg-white/30"
          style={{ width: share(buffered) }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-white"
          style={{ width: share(time) }}
        />
      </div>
      <div
        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform group-hover/bar:scale-125"
        style={{ left: share(time) }}
      />
    </div>
  );
}

/** Mute, with a volume slider that slides out on hover. */
function VolumeControl({
  volume,
  muted,
  onMute,
  onVolume,
}: {
  volume: number;
  muted: boolean;
  onMute: () => void;
  onVolume: (value: number) => void;
}) {
  const silent = muted || volume === 0;
  return (
    <div className="group/volume flex items-center">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={silent ? 0 : volume}
        aria-label="Volume"
        onChange={(event) => onVolume(Number(event.target.value))}
        className="h-1 w-0 cursor-pointer accent-white opacity-0 transition-all duration-200 group-focus-within/volume:mr-1 group-focus-within/volume:w-20 group-focus-within/volume:opacity-100 group-hover/volume:mr-1 group-hover/volume:w-20 group-hover/volume:opacity-100"
      />
      <Control label={silent ? 'Unmute' : 'Mute'} onClick={onMute}>
        {silent ? <VolumeX size={20} filled /> : <Volume2 size={20} filled />}
      </Control>
    </div>
  );
}

/** What is happening before it can play, and how far along it is. */
function Preparing({
  stage,
  percent,
}: {
  stage: 'remux' | 'transcode' | null;
  percent: number | null;
}) {
  const label =
    stage === 'transcode'
      ? 'Converting for playback'
      : stage === 'remux'
        ? 'Preparing video'
        : 'Loading';
  return (
    <div role="status" className="flex flex-col items-center gap-3">
      <LoaderCircle size={22} className="animate-spin text-white/70" />
      <p className="text-[13px] font-medium text-white/80">
        {label}
        {percent !== null && ` · ${Math.floor(percent)}%`}
      </p>
      {stage === 'transcode' && (
        <p className="text-[12px] text-white/50">
          This video's format needs converting first. It's only done once while
          the app is open.
        </p>
      )}
    </div>
  );
}

/** Why it can't play, and the ways out. */
function Failed({
  message,
  onOpen,
  onReveal,
}: {
  message: string;
  onOpen: () => void;
  onReveal: () => void;
}) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-4">
      <p className="text-[14px] font-medium">{message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-8 cursor-pointer items-center rounded-full bg-white px-3.5 text-[13px] font-semibold text-ink hover:opacity-90"
        >
          Open in Default App
        </button>
        <button
          type="button"
          onClick={onReveal}
          className={`${glass} inline-flex h-8 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-semibold hover:bg-black/40`}
        >
          {revealLabel}
        </button>
      </div>
    </div>
  );
}

/** Seconds as 1:02:32, or 2:32 when the whole video is under an hour. */
function clock(seconds: number, total: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const pad = (part: number) => String(part).padStart(2, '0');
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const rest = pad(value % 60);
  return total >= 3600
    ? `${hours}:${pad(minutes)}:${rest}`
    : `${Math.floor(value / 60)}:${rest}`;
}
