import path from 'node:path';

import { defineHandler, fileInput, probeMedia, runFfmpeg } from '../../backend';
import { options } from './options';

/** Containers that move their index to the front for quick playback. */
const faststart = new Set(['mp4', 'm4v', 'mov']);

/**
 * Copies the video streams and leaves the sound out, into the same kind of
 * file. Subtitle tracks are copied too, unless Remove Subtitles is on.
 * Nothing is re-encoded, so it takes seconds and needs no decoder: it works
 * on HEVC from an iPhone too.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const media = await probeMedia(context, input);
    if (!media.video) throw new Error('This file has no video to keep.');
    if (!media.audio) context.note('This video had no sound.');
    const ext = path.extname(input).slice(1).toLowerCase() || 'mkv';
    const output = context.outputPath('-muted', ext);
    await runFfmpeg(
      context,
      [
        '-i',
        fileInput(input),
        '-map',
        '0:v',
        // The same kind of file, so its subtitles always fit as they are.
        ...(values.removeSubtitles ? [] : ['-map', '0:s?']),
        '-c',
        'copy',
        '-an',
        ...(faststart.has(ext) ? ['-movflags', '+faststart'] : []),
        output,
      ],
      media.duration,
    );
  },
});
