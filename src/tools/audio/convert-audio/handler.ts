// SPDX-License-Identifier: GPL-3.0-or-later
import {
  audioArgs,
  codecName,
  defineHandler,
  fileInput,
  lossless,
  losslessCodec,
  probeMedia,
  runFfmpeg,
  sourceAudioKbps,
} from '../../backend';
import { options } from './options';

/** Formats whose files keep cover art. Ogg and Opus refuse it. */
const keepsCover = ['MP3', 'M4A', 'ALAC', 'FLAC', 'AIFF'];

/** The pictures an .m4a holds as cover art; others would fail it. */
const m4aCovers = ['mjpeg', 'png', 'bmp'];

/** Files that keep their tags on the sound, not the file. */
const tagsOnStream = ['ogg', 'oga', 'opus', 'spx'];

/** "Mixed to stereo and saved at 48 kHz", for what `audioArgs` lowered. */
function fittedNote(
  format: string,
  fitted: { sampleRate?: number; channels?: number },
) {
  const changes = [
    ...(fitted.channels
      ? [
          fitted.channels === 2
            ? 'mixed to stereo'
            : `mixed to ${fitted.channels} channels`,
        ]
      : []),
    ...(fitted.sampleRate ? [`saved at ${fitted.sampleRate / 1000} kHz`] : []),
  ];
  if (!changes.length) return null;
  const said = changes.join(' and ');
  return `${said[0].toUpperCase()}${said.slice(1)}, the most ${format} holds.`;
}

/**
 * Converts an audio file to another format: MP3, M4A (AAC), WAV, FLAC,
 * OGG (Vorbis), Opus, AIFF or ALAC (Apple Lossless, in an .m4a). The
 * first sound in the file is re-encoded, kept within what the format holds
 * (MP3 is stereo at up to 48 kHz, M4A up to 48 kHz), with its bit depth
 * for the lossless formats. Its tags come along, and its cover art where
 * the format keeps one. The file keeps its name, in its new type.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const { format } = values;
    const media = await probeMedia(context, input);
    const source = media.audio;
    if (!source) throw new Error('This file has no sound to convert.');

    const fileKbps = sourceAudioKbps(media);
    const kbps =
      values.bitrate === 'Same as File' ? fileKbps : parseInt(values.bitrate);
    const made = await audioArgs(context, format, kbps, source);

    const ext = /\.([^./\\]+)$/.exec(input)?.[1]?.toLowerCase() ?? '';
    const cover =
      media.cover &&
      !media.video &&
      keepsCover.includes(format) &&
      (made.ext !== 'm4a' || m4aCovers.includes(media.cover))
        ? ['-map', '0:v:0', '-c:v', 'copy', '-disposition:v', 'attached_pic']
        : [];
    const tags = tagsOnStream.includes(ext)
      ? ['-map_metadata:g', '0:s:a:0']
      : ['-map_metadata', '0'];

    await runFfmpeg(
      context,
      [
        '-i',
        fileInput(input),
        '-map',
        '0:a:0',
        ...cover,
        ...made.args,
        ...tags,
        ...(made.ext === 'm4a' ? ['-movflags', '+faststart'] : []),
        context.outputPath('', made.ext),
      ],
      media.duration,
    );
    if (context.signal.aborted) return;

    const notes: string[] = [];
    const fitted = fittedNote(format, made.fitted);
    if (fitted) notes.push(fitted);
    const wasLossy = !losslessCodec(source.codec);
    if (wasLossy && lossless(format)) {
      notes.push(
        `${codecName(source.codec)} had already left some sound out, so the ${format} sounds the same, only bigger.`,
      );
    } else if (
      wasLossy &&
      !lossless(format) &&
      values.bitrate !== 'Same as File' &&
      (source.bitrate ?? media.bitrate) &&
      kbps > fileKbps * 1.15
    ) {
      notes.push(
        `The file was ${fileKbps} kbps, so ${kbps} kbps makes it bigger but not better.`,
      );
    }
    if (notes.length) context.note(notes.join(' '));
  },
});
