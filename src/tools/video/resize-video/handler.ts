import {
  defineHandler,
  fileInput,
  fitInside,
  h264Args,
  maxSide,
  minSide,
  parseSize,
  probeMedia,
  runFfmpeg,
  sizeLabel,
  sourceVideoBitrate,
} from '../../backend';
import { options } from './options';

/**
 * Scales the video to fit inside the size chosen (a preset, or Custom's
 * width and height), keeping its shape: 1080×1920 inside 1920×1080 comes
 * out 608×1080, the same size the editor showed. Re-encoded as H.264 and
 * AAC in MP4, at the source's bitrate scaled to the new number of pixels
 * (never more than the source's). A size bigger than the video upscales
 * it, and says so.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const box =
      values.size === 'Custom'
        ? { width: Math.round(values.width), height: Math.round(values.height) }
        : parseSize(values.size);
    if (!box) throw new Error(`Offlane can't resize to ${values.size}.`);
    if (Math.min(box.width, box.height) < minSide) {
      throw new Error(`Width and Height must be at least ${minSide} px.`);
    }
    if (Math.max(box.width, box.height) > maxSide) {
      throw new Error(`Width and Height can be at most ${maxSide} px.`);
    }
    const media = await probeMedia(context, input);
    if (!media.video) throw new Error('This file has no video to resize.');
    const source = { width: media.video.width, height: media.video.height };
    const size = fitInside(source, box);

    const pixels = (size.width * size.height) / (source.width * source.height);
    if (pixels > 1) {
      context.note(
        `Upscaled from ${sizeLabel(source)}, so it may look softer.`,
      );
    } else if (size.width === source.width && size.height === source.height) {
      context.note(`It was already ${sizeLabel(source)}, so its size is kept.`);
    }

    const output = context.outputPath('-resized', 'mp4');
    await runFfmpeg(
      context,
      [
        '-i',
        fileInput(input),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        // The picture as it is seen (FFmpeg turns a phone's sideways video
        // upright first), scaled, with square pixels.
        '-vf',
        `scale=${size.width}:${size.height}:flags=lanczos,setsar=1`,
        ...(await h264Args(
          context,
          sourceVideoBitrate(media) * Math.min(1, pixels),
        )),
        output,
      ],
      media.duration,
    );
  },
});
