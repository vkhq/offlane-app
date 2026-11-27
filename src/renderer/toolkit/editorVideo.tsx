import { type SyntheticEvent, useEffect, useRef, useState } from 'react';

import type { FrameSize } from '../../shared/frameSize';
import { clock } from '../../shared/tools';
import type { MediaRef, PlaybackSource } from '../../shared/types';
import { LoaderCircle, Play } from '../components/icons';
import { Pause } from './playerIcons';

/** A file as an editor keys it: the same file is the same key, whatever
 *  object names it. */
export const mediaKeyOf = (ref: MediaRef | null) =>
  !ref ? '' : ref.source === 'file' ? ref.token : `${ref.jobId}:${ref.index}`;

/**
 * An editor's file, made playable in the page (rewrapped or converted first
 * if Chromium can't play it as it is), once per file; the preparing is
 * cancelled when the file changes or the editor goes. `failed` says why it
 * can't be played.
 */
export function useEditorVideo(media: MediaRef | null) {
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [failed, setFailed] = useState('');
  const key = mediaKeyOf(media);

  useEffect(() => {
    if (!media) return;
    let live = true;
    setSource(null);
    setFailed('');
    window.media
      .play(media)
      .then((made) => {
        if (live) setSource(made);
      })
      .catch((error: unknown) => {
        if (live) {
          setFailed(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      live = false;
      void window.media.cancelPlay(media).catch(() => {});
    };
    // Once per file: a new object for the same file is the same file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { source, failed, mediaKey: key };
}

/**
 * Playing an editor's video: where it has played to, how long it is,
 * whether it is playing, and its size as the element reports it (for when
 * the player didn't say). Space plays and pauses anywhere on the page but
 * in a field, button or menu. Spread `videoProps` on the <video>; a new
 * file (`mediaKey`) starts from its beginning.
 */
export function useEditorPlayback(mediaKey: string) {
  const video = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState<FrameSize | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setShown(null);
    setDuration(null);
    setTime(0);
    setPlaying(false);
  }, [mediaKey]);

  // The playhead's time while it plays.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const element = video.current;
      if (!element) return;
      setTime(element.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const element = video.current;
    if (!element || !duration) return;
    if (!element.paused) return element.pause();
    if (element.currentTime >= duration - 0.05) element.currentTime = 0;
    void element.play().catch(() => {});
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, button, a, [contenteditable="true"], [role="menu"], [role="listbox"], [role="dialog"], [role="slider"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      toggleRef.current();
    };
    // Captured, so it hears Space before the canvas (whose Space held
    // pans it), which mounted first.
    window.addEventListener('keydown', listen, true);
    return () => window.removeEventListener('keydown', listen, true);
  }, []);

  const videoProps = {
    ref: video,
    onClick: toggle,
    onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => {
      const element = event.currentTarget;
      if (Number.isFinite(element.duration)) setDuration(element.duration);
      if (element.videoWidth && element.videoHeight) {
        setShown({ width: element.videoWidth, height: element.videoHeight });
      }
    },
    onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) =>
      setTime(event.currentTarget.currentTime),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
  };

  return { shown, time, duration, playing, toggle, videoProps };
}

/** Where an editor's video has played to, of how long it is. */
export function PlayClock({
  time,
  duration,
}: {
  time: number;
  duration: number | null;
}) {
  return (
    <span>
      <span className="font-semibold">{clock(time)}</span>
      <span className="text-ink-faint">
        {' '}
        / {duration ? clock(duration) : '–:––.––'}
      </span>
    </span>
  );
}

/** In place of an editor's video until it can play: why not, or that it
 *  is being got ready. */
export function VideoWaiting({ failed }: { failed: string }) {
  return (
    <span className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-ink-soft">
      {failed ? (
        failed
      ) : (
        <span className="flex items-center gap-2">
          <LoaderCircle size={14} className="animate-spin" />
          Getting the video ready…
        </span>
      )}
    </span>
  );
}

/** An editor's play and pause button, under its video. */
export function PlayButton({
  playing,
  disabled,
  onClick,
}: {
  playing: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={playing ? 'Pause' : 'Play'}
      title={playing ? 'Pause (Space)' : 'Play (Space)'}
      // A click doesn't keep focus here, so the keys stay the editor's
      // (Tab still reaches it).
      onMouseDown={(event) => event.preventDefault()}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 cursor-pointer place-items-center text-ink hover:opacity-70 disabled:cursor-default disabled:text-ink-faint disabled:hover:opacity-100"
    >
      {playing ? (
        <Pause size={22} />
      ) : (
        <Play size={22} filled className="translate-x-px" />
      )}
    </button>
  );
}
