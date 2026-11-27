import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { type AudioFileInfo, soundDetails } from '../../shared/audioTracks';
import type { MediaRef, SavedFile } from '../../shared/types';
import { X } from '../components/icons';
import { formatBytes } from '../downloads';
import { savedFileOf } from '../sessions';
import { AudioPlayer } from './AudioPlayer';
import { PickBox } from './PickBox';
import { type PlayerFile, downloadFile, toolFile } from './PlayerModal';
import { clock } from './ResultCard';
import type { StepInput } from './steps';

/** Sounds' details, read once each, by the file they are of. */
const infos = new Map<string, Promise<AudioFileInfo>>();

const keyOf = (ref: MediaRef) =>
  ref.source === 'file'
    ? `file:${ref.token}`
    : `${ref.source}:${ref.jobId}:${ref.index}`;

/** What a sound is, read from it: undefined while it is read (or until
 *  `ref` is known), null if it can't be. */
function useAudioInfo(ref: MediaRef | null) {
  const [info, setInfo] = useState<AudioFileInfo | null | undefined>();
  const key = ref ? keyOf(ref) : null;
  useEffect(() => {
    setInfo(undefined);
    if (!ref || !key) return;
    let live = true;
    let pending = infos.get(key);
    if (!pending) {
      pending = window.media.audioInfo(ref);
      infos.set(key, pending);
      pending.catch(() => infos.delete(key));
    }
    pending
      .then((found) => live && setInfo(found))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [key]);
  return info;
}

/** What a sound is, as its card says: "3:24 · MP3 · Stereo · 44.1 kHz ·
 *  128 kbps · 4.2 MB". Not its tags: a download's are its channel and
 *  video title. */
function detailsOf(
  name: string,
  info: AudioFileInfo | null | undefined,
  size?: number | null,
) {
  const ext = /\.([^./\\]+)$/.exec(name)?.[1] ?? '';
  const bytes = size ?? info?.size;
  return [
    info === undefined ? 'Reading…' : null,
    info?.duration ? clock(info.duration) : null,
    ...(info ? soundDetails(ext, info) : []),
    info && !info.tracks.length ? 'No sound' : null,
    bytes ? formatBytes(bytes) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A sound's card, as results show theirs: its own player (its waveform,
 *  Play, the time, Loop and speed; see AudioPlayer) with its name and
 *  what it is over it; just those until it can be played. */
function SoundCard({
  file,
  name,
  details,
  leading,
  trailing,
  dimmed,
}: {
  file: PlayerFile | null;
  name: string;
  details: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  dimmed?: boolean;
}) {
  if (file) {
    return (
      <AudioPlayer
        file={file}
        title={name}
        details={details}
        leading={leading}
        trailing={trailing}
        dimmed={dimmed}
      />
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-canvas px-4 py-3 shadow-card">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-semibold">{name}</span>
        <span className="truncate text-[12px] text-ink-soft">{details}</span>
      </div>
      {trailing}
    </div>
  );
}

/** An added file's token, as the main process knows it; null until then. */
function useToken(item: File | SavedFile) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setToken(null);
    savedFileOf(item)
      .then((saved) => live && setToken(saved.token))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [item]);
  return token;
}

/**
 * A sound file added to a tool, as its results show theirs (see
 * SoundCard), with a ✕ to take it out until the tool has run.
 */
export function AddedSound({
  item,
  onRemove,
}: {
  item: File | SavedFile;
  /** Takes it out; none once the tool has run. */
  onRemove?: () => void;
}) {
  const token = useToken(item);
  const media = useMemo(
    (): MediaRef | null => (token ? { source: 'file', token } : null),
    [token],
  );
  const info = useAudioInfo(media);
  // The id the main process plays it under (see mediaOf in main/ipc.ts),
  // so its progress reaches this player.
  const file = useMemo(
    (): PlayerFile | null =>
      media && media.source === 'file'
        ? {
            id: `file-${media.token}`,
            media,
            prepare: () => window.media.play(media),
            cancel: () => void window.media.cancelPlay(media).catch(() => {}),
            onProgress: (cb) => window.tools.onPlaybackProgress(cb),
          }
        : null,
    [media],
  );
  return (
    <SoundCard
      file={file}
      name={item.name}
      details={detailsOf(item.name, info, item.size)}
      trailing={
        onRemove && (
          <button
            type="button"
            aria-label={`Remove ${item.name}`}
            onClick={onRemove}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-well hover:text-ink"
          >
            <X size={14} />
          </button>
        )
      }
    />
  );
}

/**
 * A sound a later step works on, an earlier stage's output, as that
 * stage's results show it (see SoundCard). Among several, a box before its
 * name picks it or leaves it out, and one left out is shown faded.
 */
export function StepSound({
  input,
  ticked,
  pickable,
  locked,
  verb,
  onToggle,
}: {
  input: StepInput;
  ticked: boolean;
  /** Whether there are others to pick among, so a box to pick it. */
  pickable: boolean;
  /** Run: what it ran on is a record, not changed. */
  locked: boolean;
  /** What ticking it does: "Use", or "Pick" for a tool with an editor. */
  verb: string;
  onToggle: () => void;
}) {
  const file = useMemo(
    () =>
      input.source === 'download'
        ? downloadFile(input.jobId)
        : toolFile(input.jobId, input.index),
    [input.source, input.jobId, input.index],
  );
  const info = useAudioInfo(file.media ?? null);
  return (
    <SoundCard
      file={file}
      name={input.name}
      details={detailsOf(input.name, info)}
      dimmed={!ticked}
      leading={
        pickable && (
          <PickBox
            on={ticked}
            label={`${verb} ${input.name}`}
            disabled={locked}
            onToggle={onToggle}
          />
        )
      }
    />
  );
}
