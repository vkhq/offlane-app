// A video's audio tracks, as Extract Audio lists and names them: from what
// ffprobe says of each, the same in the page's track picker and in the
// handler's file names. No Electron, Node or React import.

import { canonicalLanguage, languageName } from './languages';

/** One of a file's audio tracks. */
export type AudioTrack = {
  /** Its place among the file's audio tracks, from 0: FFmpeg's `0:a:N`. */
  index: number;
  /** "English", "English (Commentary)", or "Track 2" when nothing says. */
  label: string;
  /** Its language code as tagged ("en"), or null. */
  language: string | null;
  /** FFmpeg's name for its codec: aac, ac3, opus… */
  codec: string;
  channels: number | null;
  sampleRate: number | null;
  /** Bits per second, or null if unknown. */
  bitrate: number | null;
  /** The track a player picks first. */
  isDefault: boolean;
};

/** A file's audio, as an audio result's card describes it. */
export type AudioFileInfo = {
  tracks: AudioTrack[];
  /** Bytes, or null if unknown. */
  size: number | null;
  /** Seconds, or null if unknown. */
  duration: number | null;
};

/** A stream as ffprobe's JSON gives it, as far as tracks need. */
export type ProbedAudioStream = {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  sample_rate?: string | number;
  bit_rate?: string | number;
  disposition?: { default?: number };
  tags?: Record<string, string | undefined>;
};

const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/** Titles that only name the muxer's handler, not the track. */
const generic =
  /^(sound ?handler|soundhandler|audio|stereo|mono|core media audio|iso media file produced by .*)$/i;

/**
 * The audio tracks among ffprobe's `streams`, in the file's order, each
 * named by its language and its title when that says more ("English
 * (Commentary)"), or "Track 2". Two with one name are told apart by number.
 */
export function audioTracksFrom(streams: ProbedAudioStream[]): AudioTrack[] {
  const audio = streams.filter((stream) => stream.codec_type === 'audio');
  const tracks = audio.map((stream, index): AudioTrack => {
    const tags = stream.tags ?? {};
    const language = canonicalLanguage(tags.language) ?? null;
    const name = language ? languageName(language) : null;
    const title = (tags.title ?? '').trim();
    const titled = title && !generic.test(title) && title !== name;
    const label = name
      ? titled
        ? `${name} (${title})`
        : name
      : titled
        ? title
        : `Track ${index + 1}`;
    return {
      index,
      label,
      language,
      codec: String(stream.codec_name ?? ''),
      channels: positive(stream.channels),
      sampleRate: positive(stream.sample_rate),
      // MKV keeps it in a tag, not the stream.
      bitrate:
        positive(stream.bit_rate) ?? positive(tags.BPS ?? tags['BPS-eng']),
      isDefault: stream.disposition?.default === 1,
    };
  });
  // A file that marks none plays its first.
  if (tracks.length && !tracks.some((track) => track.isDefault)) {
    tracks[0] = { ...tracks[0], isDefault: true };
  }
  return tracks.map((track) =>
    tracks.filter((other) => other.label === track.label).length > 1
      ? { ...track, label: `${track.label} ${track.index + 1}` }
      : track,
  );
}

const codecNames: Record<string, string> = {
  aac: 'AAC',
  mp3: 'MP3',
  mp2: 'MP2',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  alac: 'ALAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  truehd: 'TrueHD',
  wmav1: 'WMA',
  wmav2: 'WMA',
  wmapro: 'WMA Pro',
  wmalossless: 'WMA Lossless',
  amr_nb: 'AMR',
  amr_wb: 'AMR-WB',
};

/** A codec as people know it: "AC-3", "PCM". */
export const codecName = (codec: string) =>
  codecNames[codec] ?? (codec.startsWith('pcm_') ? 'PCM' : codec.toUpperCase());

/** A channel count as people say it: "Stereo", "5.1". */
export function channelsName(channels: number | null) {
  switch (channels) {
    case null:
      return null;
    case 1:
      return 'Mono';
    case 2:
      return 'Stereo';
    case 6:
      return '5.1';
    case 8:
      return '7.1';
    default:
      return `${channels} channels`;
  }
}

/** A track's details, as its row shows them: "AAC · Stereo · 48 kHz · 192 kbps". */
export const trackDetails = (track: AudioTrack) =>
  [
    codecName(track.codec),
    channelsName(track.channels),
    track.sampleRate && `${Math.round(track.sampleRate / 100) / 10} kHz`,
    track.bitrate && `${Math.round(track.bitrate / 1000)} kbps`,
  ]
    .filter(Boolean)
    .join(' · ');

/** Codecs an audio file of their own holds as they are, and its type. */
const copiedInto: Record<string, string> = {
  aac: 'm4a',
  alac: 'm4a',
  mp3: 'mp3',
  opus: 'opus',
  vorbis: 'ogg',
  flac: 'flac',
};
/** Uncompressed sound a WAV holds as it is; big-endian goes in an AIFF. */
const wavPcm = new Set([
  'pcm_u8',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
  'pcm_f64le',
]);
const aiffPcm = new Set(['pcm_s16be', 'pcm_s24be', 'pcm_s32be', 'pcm_f32be']);

/**
 * The file a track becomes with Format set to Original: `copy` keeps it
 * exactly, in the audio file type that holds its codec; `pcm` rewrites
 * DVD and Blu-ray PCM as a WAV's own (the same sound); `m4a` re-encodes a
 * codec no audio file holds (AC-3, DTS, WMA…) as AAC.
 */
export function originalFile(codec: string): {
  ext: string;
  how: 'copy' | 'pcm' | 'm4a';
} {
  const ext = copiedInto[codec];
  if (ext) return { ext, how: 'copy' };
  if (wavPcm.has(codec)) return { ext: 'wav', how: 'copy' };
  if (aiffPcm.has(codec)) return { ext: 'aiff', how: 'copy' };
  if (codec.startsWith('pcm_')) return { ext: 'wav', how: 'pcm' };
  return { ext: 'm4a', how: 'm4a' };
}

/** A file type as the Format menu names it: "M4A", "Opus". */
export const formatName = (ext: string) =>
  ext === 'opus' ? 'Opus' : ext.toUpperCase();
