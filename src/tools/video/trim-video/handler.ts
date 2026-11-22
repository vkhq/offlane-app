import {
  defineHandler,
  fileInput,
  h264Args,
  probeMedia,
  runFfmpeg,
  sourceVideoBitrate,
  timeRange,
} from '../../backend';
import { options } from './options';

/**
 * Keeps the part from Start to End, cut on the exact frame: it is
 * re-encoded as H.264 and AAC in MP4 at about the source's bitrate, since
 * copying could only cut at keyframes, often seconds away. An End past the
 * video's end keeps the rest of it, and says so.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const media = await probeMedia(context, input);
    if (!media.video) throw new Error('This file has no video to trim.');
    const { start, length, inputArgs } = timeRange(values, media.duration);
    if (start + length < values.end) {
      context.note('End was past the end of the video, so the rest is kept.');
    }
    const output = context.outputPath('-trimmed', 'mp4');
    await runFfmpeg(
      context,
      [
        ...inputArgs,
        '-i',
        fileInput(input),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        ...(await h264Args(context, sourceVideoBitrate(media))),
        output,
      ],
      length,
    );
  },
});
