// SPDX-License-Identifier: GPL-3.0-or-later
import {
  type AspectFit,
  aspectPlan,
  defineHandler,
  fileInput,
  h264Args,
  maxSide,
  minSide,
  parseRatio,
  probeMedia,
  runFfmpeg,
  sizeLabel,
  sourceVideoBitrate,
} from '../../backend';
import { options } from './options';

/**
 * Gives the video a new shape (a preset's, or Custom's width and height).
 * Fit with Bars keeps all of it, at the video's long side, scaled into the
 * frame with black bars round it. Fill and Crop keeps the largest part of
 * that shape, unscaled, where the editor put it (centred by default), so
 * it stays as sharp as the source. Custom's size is made exactly, scaling
 * the video as needed, and says so if that upscales it. Re-encoded as
 * H.264 and AAC in MP4, at the source's bitrate scaled to the picture
 * kept (never more than the source's).
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    if (values.aspect === 'None') {
      throw new Error('Choose an aspect ratio first.');
    }
    const custom = values.aspect === 'Custom';
    const size = custom
      ? { width: Math.round(values.width), height: Math.round(values.height) }
      : undefined;
    if (size) {
      if (Math.min(size.width, size.height) < minSide) {
        throw new Error(`Width and Height must be at least ${minSide} px.`);
      }
      if (Math.max(size.width, size.height) > maxSide) {
        throw new Error(`Width and Height can be at most ${maxSide} px.`);
      }
    }
    const ratio = size ?? parseRatio(values.aspect);
    if (!ratio) {
      throw new Error(`Offlane can't change the shape to ${values.aspect}.`);
    }
    const media = await probeMedia(context, input);
    if (!media.video) throw new Error('This file has no video to reshape.');
    const source = { width: media.video.width, height: media.video.height };
    const plan = aspectPlan(source, ratio, values.fit as AspectFit, {
      size,
      x: values.cropX,
      y: values.cropY,
    });
    const { output, picture, part } = plan;

    if (plan.upscale) {
      context.note(
        `Upscaled from ${sizeLabel(part ?? source)}, so it may look softer.`,
      );
    } else if (plan.same) {
      const shape = custom ? sizeLabel(output) : values.aspect.split(' ')[0];
      context.note(`It was already ${shape}, so its shape is kept.`);
    }

    const filters = picture
      ? [
          `scale=${picture.width}:${picture.height}:flags=lanczos`,
          `pad=${output.width}:${output.height}:${picture.x}:${picture.y}:black`,
        ]
      : [
          `crop=${part!.width}:${part!.height}:${part!.x}:${part!.y}`,
          ...(output.width !== part!.width || output.height !== part!.height
            ? [`scale=${output.width}:${output.height}:flags=lanczos`]
            : []),
        ];
    // The share of the source's picture that is kept, for the bitrate.
    const kept = picture
      ? (picture.width * picture.height) / (source.width * source.height)
      : (output.width * output.height) / (source.width * source.height);

    const suffix = custom
      ? `-${output.width}x${output.height}`
      : `-${ratio.width}x${ratio.height}`;
    const outputPath = context.outputPath(suffix, 'mp4');
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
        // upright first), reshaped, with square pixels.
        '-vf',
        [...filters, 'setsar=1'].join(','),
        ...(await h264Args(
          context,
          sourceVideoBitrate(media) * Math.min(1, kept),
        )),
        outputPath,
      ],
      media.duration,
    );
  },
});
