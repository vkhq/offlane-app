// SPDX-License-Identifier: GPL-3.0-or-later
import { statSync } from 'node:fs';

import {
  defineHandler,
  fileInput,
  probeMedia,
  runFfmpeg,
  timeRange,
} from '../../backend';
import { options } from './options';

/** Above this, the result says how to make the GIF smaller. */
const largeGif = 10 * 1024 * 1024;

/**
 * Turns the part from Start to End into a GIF that loops forever (or, with
 * Loop off, plays once and stops on its last frame), at the chosen width
 * (never wider than the video) and frame rate, with no sound.
 * One pass: the part's own 256-colour palette is worked out first, then
 * used with an ordered dither, which keeps flat areas from shimmering.
 */
export default defineHandler({
  options,
  // Its page shows the GIF itself before it is made (see its page.tsx).
  previews: true,
  async run(context) {
    const { input, values } = context;
    const width = Number.parseInt(values.width, 10);
    const rate = Number.parseInt(values.frameRate, 10);
    if (!(width > 0) || !(rate > 0)) {
      throw new Error(
        `Offlane can't make a GIF ${values.width} wide at ${values.frameRate}.`,
      );
    }
    const media = await probeMedia(context, input);
    if (!media.video)
      throw new Error('This file has no video to turn into a GIF.');
    const { start, length, inputArgs } = timeRange(values, media.duration);
    const notes: string[] = [];
    if (start + length < values.end) {
      notes.push('End was past the end of the video, so the rest is kept.');
    }

    const output = context.outputPath('', 'gif');
    // FFmpeg turns a phone's sideways video upright first, so `iw` is the
    // width as it plays.
    const picture = [
      `fps=${rate}`,
      `scale='min(iw,${width})':-1:flags=lanczos`,
      'setsar=1',
      'split[a][b]',
    ].join(',');
    await runFfmpeg(
      context,
      [
        ...inputArgs,
        '-i',
        fileInput(input),
        '-filter_complex',
        `[0:v:0]${picture};[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5[gif]`,
        '-map',
        '[gif]',
        // 0: over and over; -1: no loop block at all, so it plays once.
        '-loop',
        values.loop ? '0' : '-1',
        output,
      ],
      length,
    );

    if (context.signal.aborted) return;
    const size = statSync(output).size;
    if (size > largeGif) {
      notes.push(
        `This GIF is ${Math.round(size / 1024 / 1024)} MB. A shorter part, a smaller width or a lower frame rate makes it smaller.`,
      );
    }
    if (notes.length) context.note(notes.join(' '));
  },
});
