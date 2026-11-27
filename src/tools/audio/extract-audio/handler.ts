// SPDX-License-Identifier: GPL-3.0-or-later
import { parseList } from '../../options';
import {
  type AudioTrack,
  type HandlerContext,
  audioArgs,
  audioTracks,
  codecName,
  defineHandler,
  originalFile,
  fileInput,
  probeMedia,
  runFfmpeg,
} from '../../backend';
import { options } from './options';

/** How a track is saved: its file type and the output's arguments. */
type Plan = { ext: string; args: string[]; note?: string };

/** A lossy track's bitrate in kbps for "Same as Track": its own, within
 *  64–320 kbps, or 192 kbps when the file doesn't say. */
const sameAs = (track: AudioTrack) =>
  Math.min(320, Math.max(64, Math.round((track.bitrate ?? 192_000) / 1000)));

/** What MP3 can't hold: over 48 kHz or two channels. */
const mp3Limits = (track: AudioTrack) => [
  ...(track.sampleRate && track.sampleRate > 48_000 ? ['-ar', '48000'] : []),
  ...(track.channels && track.channels > 2 ? ['-ac', '2'] : []),
];

/**
 * How `track` is saved. Original copies it out untouched, in the audio
 * file type that holds its codec; one no audio file holds (AC-3, DTS,
 * WMA…) becomes M4A, and the note says so. A chosen format re-encodes it.
 */
async function planFor(
  context: HandlerContext<unknown>,
  track: AudioTrack,
  format: string,
  bitrate: string,
): Promise<Plan> {
  const kbps = bitrate === 'Same as Track' ? sameAs(track) : parseInt(bitrate);
  if (format !== 'Original') {
    const made = await audioArgs(context, format, kbps);
    return {
      ...made,
      args: [...made.args, ...(format === 'MP3' ? mp3Limits(track) : [])],
    };
  }
  const { codec } = track;
  const { ext, how } = originalFile(codec);
  if (how === 'copy') return { ext, args: ['-c:a', 'copy'] };
  if (how === 'pcm') return { ext, args: ['-c:a', 'pcm_s24le'] };
  const m4a = await audioArgs(context, 'M4A', sameAs(track));
  return {
    ...m4a,
    note: `${track.label} was ${codecName(codec)}, so it was saved as M4A.`,
  };
}

/** A track's name as part of a file name: no characters Finder or Windows
 *  refuse. */
const fileSafe = (label: string) => label.replace(/[/\\:*?"<>|]/g, '-');

/**
 * Saves the picked audio tracks of one video, each as a file of its own,
 * named after the video and the track ("Film - English.m4a"; just
 * "Film.m4a" for a video with one track). All are written in one FFmpeg
 * run, so the video is read once however many are picked; its picture is
 * never decoded, so this works on any video FFmpeg can open, HEVC too.
 * Tracks are checked against the file, which may not be the one they were
 * picked on.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const picked = parseList(values.tracks) ?? [];
    if (!picked.length) throw new Error('Pick at least one track to extract.');
    const tracks = await audioTracks(context.ffmpeg().ffprobe, input);
    if (!tracks.length) throw new Error('This video has no sound to extract.');
    const chosen = tracks.filter((track) => picked.includes(track.index));
    if (!chosen.length) {
      throw new Error(
        "The tracks picked aren't in this video. Pick them again.",
      );
    }
    const media = await probeMedia(context, input);

    const notes: string[] = [];
    const skipped = picked.length - chosen.length;
    if (skipped) {
      notes.push(
        `${skipped} picked ${skipped === 1 ? 'track isn’t' : 'tracks aren’t'} in this video.`,
      );
    }
    const args = ['-i', fileInput(input)];
    for (const track of chosen) {
      const plan = await planFor(context, track, values.format, values.bitrate);
      if (plan.note) notes.push(plan.note);
      const suffix = tracks.length > 1 ? ` - ${fileSafe(track.label)}` : '';
      const output = context.outputPath(suffix, plan.ext);
      args.push(
        '-map',
        `0:a:${track.index}`,
        ...plan.args,
        // The video's title and other tags; the track's language comes with
        // the track.
        '-map_metadata',
        '0',
        ...(plan.ext === 'm4a' ? ['-movflags', '+faststart'] : []),
        output,
      );
    }
    await runFfmpeg(context, args, media.duration);
    if (context.signal.aborted) return;
    if (notes.length) context.note(notes.join(' '));
  },
});
