import {
  defineHandler,
  fileInput,
  h264Args,
  probeMedia,
  runFfmpeg,
} from '../../backend';
import { options } from './options';

/** Bits per second when the source's own bitrate is unknown. */
const fallbackBitrate = 4_000_000;

/**
 * Re-encodes to H.264 and AAC in MP4 at a share of the source's bitrate:
 * from 15% at quality 0 to 65% at 100 (55% at the default 80).
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const media = await probeMedia(context, input);
    const share = 0.15 + (values.quality / 100) * 0.5;
    const video = Math.max(
      200_000,
      Math.round((media.bitrate ?? fallbackBitrate) * share) - 128_000,
    );
    const output = context.outputPath('-compressed', 'mp4');
    await runFfmpeg(
      context,
      [
        '-i',
        fileInput(input),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        ...(await h264Args(context, video)),
        output,
      ],
      media.duration,
    );
  },
});
