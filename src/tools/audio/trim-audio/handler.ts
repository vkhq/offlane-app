// SPDX-License-Identifier: GPL-3.0-or-later
import {
  defineHandler,
  fileInput,
  probeMedia,
  runFfmpeg,
  sameAudioFormat,
  timeRange,
} from '../../backend';
import { options } from './options';

/**
 * Keeps the part of an audio file from Start to End, cut on the exact
 * sample: the sound is re-encoded in the format it came in (MP3 stays MP3
 * at its bitrate, FLAC and WAV stay lossless at their bit depth), with its
 * tags and cover art. A format Offlane can't make (WMA) comes out as M4A,
 * and an End past the file's end keeps the rest of it; both say so.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const media = await probeMedia(context, input);
    if (!media.audio) throw new Error('This file has no sound to trim.');
    const { start, length, inputArgs } = timeRange(values, media.duration);
    const output = await sameAudioFormat(context, input, media);

    await runFfmpeg(
      context,
      [
        ...inputArgs,
        '-i',
        fileInput(input),
        ...output.args,
        ...(output.ext === 'm4a' ? ['-movflags', '+faststart'] : []),
        context.outputPath('-trimmed', output.ext),
      ],
      length,
    );
    if (context.signal.aborted) return;

    const notes: string[] = [];
    if (start + length < values.end) {
      notes.push('End was past the end of the file, so the rest is kept.');
    }
    if (output.note) notes.push(output.note);
    if (notes.length) context.note(notes.join(' '));
  },
});
