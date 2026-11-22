import { useEffect, useState } from 'react';

import type { MediaRef, PlaybackSource } from '../../shared/types';
import { Play } from '../components/icons';
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
