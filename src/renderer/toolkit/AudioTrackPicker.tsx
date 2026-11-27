import { type SyntheticEvent, useEffect, useRef, useState } from 'react';

import {
  type AudioTrack,
  formatName,
  originalFile,
  trackDetails,
} from '../../shared/audioTracks';
import { formatList, parseList } from '../../shared/tools';
import type { MediaRef } from '../../shared/types';
import { Check, LoaderCircle } from '../components/icons';
import { AudioPlayer } from './AudioPlayer';
import type { PlayerFile } from './PlayerModal';
import {
  PlayButton,
  PlayClock,
  VideoWaiting,
  mediaKeyOf,
  useEditorPlayback,
  useEditorVideo,
} from './editorVideo';
import type { ToolEditorProps } from './standardTool';
import { smallButton } from './styles';

/** The tracks ticked at first: the one a player picks first. */
const firstPicks = (tracks: AudioTrack[]) =>
  tracks.filter((track) => track.isDefault).map((track) => track.index);

/** The id the main process gives an editor's file (see mediaOf in
 *  main/ipc.ts), so a track's playback progress reaches its player. */
const mediaIdOf = (ref: MediaRef) =>
  ref.source === 'file'
    ? `file-${ref.token}`
    : ref.index
      ? `${ref.jobId}-${ref.index}`
      : ref.jobId;

/** Track `index` of the editor's video, for a player: heard alone, its
 *  waveform its own. */
const trackFile = (media: MediaRef, index: number): PlayerFile => ({
  id: `${mediaIdOf(media)}-a${index}`,
  media,
  audioTrack: index,
  prepare: () => window.media.playTrack(media, index),
  cancel: () => void window.media.cancelPlay(media).catch(() => {}),
  onProgress: (cb) => window.tools.onPlaybackProgress(cb),
});

/**
 * The video itself, above its tracks: the picture on a stage, played or
 * paused by clicking it, Space or the button under it, with its time. It
 * plays with its default sound, as any player would.
 */
function VideoPreview({ media }: { media: MediaRef }) {
  const { source, failed, mediaKey } = useEditorVideo(media);
  const { time, duration, playing, toggle, videoProps } =
    useEditorPlayback(mediaKey);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-black/90 select-none">
        {source ? (
          <video
            {...videoProps}
            src={source.url}
            preload="auto"
            playsInline
            className="size-full cursor-pointer object-contain"
          />
        ) : (
          <div className="absolute inset-0 bg-canvas">
            <VideoWaiting failed={failed} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center rounded-2xl bg-canvas px-4 py-1.5 text-[12px] tabular-nums shadow-card">
        <PlayClock time={time} duration={duration} />
        <PlayButton
          playing={playing}
          disabled={!source || !duration}
          onClick={toggle}
        />
        <span />
      </div>
    </div>
  );
}

/** The box that picks a track, before its name. */
function TrackBox({
  on,
  label,
  disabled,
  onToggle,
}: {
  on: boolean;
  label: string;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={`Extract ${label}`}
      disabled={disabled}
      onClick={onToggle}
      className={`grid size-5 shrink-0 place-items-center rounded-md transition-colors enabled:cursor-pointer disabled:cursor-default ${
        on ? 'bg-flow text-white' : 'ring-[1.5px] ring-ink/25 ring-inset'
      } ${disabled && !on ? 'opacity-40' : ''}`}
    >
      {on && <Check size={12} strokeWidth={3} />}
    </button>
  );
}

/**
 * Extract Audio's editor: the video, to watch, and under it its audio
 * tracks, each as an audio
 * player like a result's (its waveform, Play, the time, Loop and speed)
 * with a box before its name to pick it, and what it is under the name
 * ("AC-3 · 5.1 · 48 kHz · 384 kbps"). Sets the `tracks` option to the
 * picked ones ("0,2"). On a new file the default track is picked; a video
 * with one track has it picked, the list there to say what it is. A track
 * plays on its own, without the picture, so a video whose picture can't
 * play here can still be heard. One sound at a time: a track or the
 * video playing pauses the rest.
 *
 * Says beside Format's Original the file type it makes of the picked
 * tracks ("M4A", "M4A + Opus").
 */
export function AudioTrackPicker({
  media,
  values,
  onChange,
  locked,
  onHints,
}: ToolEditorProps) {
  const key = mediaKeyOf(media);
  /** The file's tracks: undefined while they are read. */
  const [tracks, setTracks] = useState<AudioTrack[]>();
  const [failed, setFailed] = useState('');
  /** The file its tracks were first picked on, so it's done once a file. */
  const ticked = useRef('');

  const picked = parseList(String(values.tracks ?? '')) ?? [];
  const set = (indexes: number[]) => onChange({ tracks: formatList(indexes) });

  useEffect(() => {
    if (!media) return;
    let live = true;
    setTracks(undefined);
    setFailed('');
    window.media
      .audioTracks(media)
      .then((found) => live && setTracks(found))
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

  // Its first tracks, once per file, unless some are already picked (a tab
  // opened again) or it has run.
  useEffect(() => {
    if (!tracks || locked || ticked.current === key) return;
    ticked.current = key;
    const kept = picked.filter((index) =>
      tracks.some((track) => track.index === index),
    );
    if (kept.length) {
      if (kept.length !== picked.length) set(kept);
    } else {
      set(firstPicks(tracks));
    }
    // Only when the file's tracks arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, key, locked]);

  // The file type Original makes of the picked tracks, beside it.
  const formats = [
    ...new Set(
      (tracks ?? [])
        .filter((track) => picked.includes(track.index))
        .map((track) => formatName(originalFile(track.codec).ext)),
    ),
  ].join(' + ');
  useEffect(() => {
    onHints(formats ? { format: { Original: formats } } : {});
    // onHints is the page's setter; only the words matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formats]);

  const toggle = (index: number) =>
    set(
      picked.includes(index)
        ? picked.filter((other) => other !== index)
        : [...picked, index],
    );

  const count = tracks?.length ?? 0;

  // One sound at a time: the video pauses when a track plays, and the
  // tracks when the video does (the tracks already pause each other).
  const box = useRef<HTMLDivElement>(null);
  const onPlay = (event: SyntheticEvent<HTMLDivElement>) => {
    const started = event.target;
    for (const element of box.current?.querySelectorAll('audio, video') ?? []) {
      const other = element as HTMLMediaElement;
      if (other === started) continue;
      if (other.tagName === (started as HTMLElement).tagName) continue;
      other.pause();
    }
  };

  return (
    <div ref={box} onPlayCapture={onPlay} className="flex flex-col gap-3">
      {media && <VideoPreview media={media} />}
      <div className="flex h-8 items-center gap-2 px-1">
        <span className="flex-1 text-[13px] font-semibold text-ink">
          {tracks === undefined && !failed
            ? 'Reading audio tracks…'
            : count === 1
              ? '1 Audio Track'
              : `${count} Audio Tracks`}
        </span>
        {count > 1 && !locked && (
          <>
            <button
              type="button"
              className={smallButton}
              disabled={picked.length === count}
              onClick={() => set(tracks?.map((track) => track.index) ?? [])}
            >
              Select All
            </button>
            <button
              type="button"
              className={smallButton}
              disabled={picked.length === 0}
              onClick={() => set([])}
            >
              Select None
            </button>
          </>
        )}
      </div>

      {tracks === undefined && !failed && (
        <div className="grid h-24 place-items-center rounded-3xl bg-canvas text-ink-faint shadow-card">
          <LoaderCircle size={18} className="animate-spin" />
        </div>
      )}
      {(failed || tracks?.length === 0) && (
        <p className="rounded-3xl bg-canvas px-4 py-4 text-[13px] text-ink-soft shadow-card">
          {failed || 'This video has no audio tracks to extract.'}
        </p>
      )}

      {media &&
        tracks?.map((track) => {
          const on = picked.includes(track.index);
          return (
            <AudioPlayer
              key={`${key}-${track.index}`}
              file={trackFile(media, track.index)}
              title={
                track.isDefault && count > 1
                  ? `${track.label} · Default`
                  : track.label
              }
              details={trackDetails(track)}
              dimmed={!on}
              leading={
                <TrackBox
                  on={on}
                  label={track.label}
                  disabled={locked}
                  onToggle={() => toggle(track.index)}
                />
              }
            />
          );
        })}
    </div>
  );
}
