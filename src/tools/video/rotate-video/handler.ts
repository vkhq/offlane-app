// SPDX-License-Identifier: GPL-3.0-or-later
import {
  defineHandler,
  fileInput,
  h264Args,
  probeMedia,
  runFfmpeg,
  sourceVideoBitrate,
} from '../../backend';
import { options } from './options';

/** FFmpeg's filter for each turn, on the picture as it is seen. */
const turns: Record<string, string | null> = {
  '90° Right': 'transpose=clock',
  '90° Left': 'transpose=cclock',
  '180°': 'hflip,vflip',
  None: null,
};

/**
 * Turns the video by the rotation chosen, then mirrors it left to right if
 * Flip Horizontally is on: both on the picture as it is seen, so a phone's
 * sideways video is turned from how it plays, not how it is stored.
 * Re-encoded as H.264 and AAC in MP4 at the source's bitrate, so the
 * result plays the right way up everywhere, with no rotation tag left for
 * a player to ignore.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    if (!(values.rotate in turns)) {
      throw new Error(`Offlane can't rotate by ${values.rotate}.`);
    }
    const filters = [
      turns[values.rotate],
      values.flipHorizontally ? 'hflip' : null,
    ].filter((filter) => filter !== null);
    if (filters.length === 0) {
      throw new Error(
        'Nothing to change: choose a rotation or turn on Flip Horizontally.',
      );
    }
    const media = await probeMedia(context, input);
    if (!media.video) throw new Error('This file has no video to rotate.');

    const output = context.outputPath('-rotated', 'mp4');
    await runFfmpeg(
      context,
      [
        '-i',
        fileInput(input),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        // FFmpeg turns a phone's sideways video upright first, so these
        // work on the picture as it plays.
        '-vf',
        `${filters.join(',')},setsar=1`,
        ...(await h264Args(context, sourceVideoBitrate(media))),
        output,
      ],
      media.duration,
    );
  },
});
