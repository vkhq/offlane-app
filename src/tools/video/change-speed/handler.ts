// SPDX-License-Identifier: GPL-3.0-or-later
import {
  defineHandler,
  fileInput,
  h264Args,
  lengthAt,
  parseSpeed,
  probeMedia,
  runFfmpeg,
  sourceVideoBitrate,
  tempoSteps,
} from '../../backend';
import { options } from './options';

/**
 * Plays the whole video faster or slower: its picture by retiming the
 * frames, its sound with `atempo`, which keeps the pitch (or no sound, with
 * Remove Audio). Sped up, it keeps the source's frame rate (frames are
 * dropped, not packed in); slowed down, each frame shows for longer.
 * Re-encoded as H.264 and AAC in MP4 at the source's bitrate.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const speed = parseSpeed(values.speed);
    if (speed === null) {
      throw new Error(`Offlane can't play a video at ${values.speed}.`);
    }
    if (speed === 1) throw new Error('Choose a speed other than 1×.');
    const media = await probeMedia(context, input);
    if (!media.video) throw new Error('This file has no video to speed up.');

    const picture = [`setpts=PTS/${speed}`];
    // Faster, it would play more frames a second than it was made at.
    if (speed > 1 && media.video.fps) {
      picture.push(`fps=${+media.video.fps.toFixed(3)}`);
    }
    const sound = !values.removeAudio && media.audio !== null;

    const label = values.speed.replace(/×$/, '');
    const output = context.outputPath(`-${label}x`, 'mp4');
    await runFfmpeg(
      context,
      [
        '-i',
        fileInput(input),
        '-map',
        '0:v:0',
        ...(sound
          ? ['-map', '0:a:0', '-af', tempoSteps(speed).join(',')]
          : ['-an']),
        // FFmpeg turns a phone's sideways video upright first.
        '-vf',
        [...picture, 'setsar=1'].join(','),
        ...(await h264Args(context, sourceVideoBitrate(media))),
        output,
      ],
      media.duration && lengthAt(media.duration, speed),
    );
  },
});
