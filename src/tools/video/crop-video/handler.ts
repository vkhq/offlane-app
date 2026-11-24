// SPDX-License-Identifier: GPL-3.0-or-later
import {
  boxOf,
  defineHandler,
  fileInput,
  h264Args,
  isWhole,
  probeMedia,
  runFfmpeg,
  sourceVideoBitrate,
} from '../../backend';
import { options } from './options';

/**
 * Keeps the box set in the editor and cuts away the rest, unscaled, so it
 * comes out the box's size at the source's sharpness. The box is in the
 * picture as it plays (FFmpeg turns a phone's sideways video upright
 * first), and kept inside it: it may have been set on a file of another
 * size. Re-encoded as H.264 and AAC in MP4, at the source's bitrate
 * scaled to the share of the picture kept.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const media = await probeMedia(context, input);
    if (!media.video) throw new Error('This file has no video to crop.');
    const source = { width: media.video.width, height: media.video.height };
    const box = boxOf(source, values);
    if (isWhole(source, box)) {
      throw new Error("Drag the box's edges to choose what to keep.");
    }
    const kept = (box.width * box.height) / (source.width * source.height);

    const output = context.outputPath('-cropped', 'mp4');
    await runFfmpeg(
      context,
      [
        '-i',
        fileInput(input),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        `crop=${box.width}:${box.height}:${box.x}:${box.y},setsar=1`,
        ...(await h264Args(context, sourceVideoBitrate(media) * kept)),
        output,
      ],
      media.duration,
    );
  },
});
