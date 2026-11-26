// SPDX-License-Identifier: GPL-3.0-or-later
import {
  type HandlerContext,
  defineHandler,
  fileInput,
  probeMedia,
  runFfmpeg,
  sameAudioFormat,
} from '../../backend';
import { options } from './options';

/** Loudness Normalize Volume aims for: podcasts' and streaming's usual
 *  -16 LUFS, peaks under -1.5 dBTP, a loudness range of up to 11 LU. */
const loudness = 'I=-16:TP=-1.5:LRA=11';

/** A pause longer than this is shortened to it, so speech keeps a
 *  natural breath between sentences. */
const keptPause = 0.7;

/** Rumble below this (handling noise, traffic, air conditioning) goes
 *  with Reduce Noise. */
const rumble = 'highpass=f=80';

/** dB, as FFmpeg's filters take them, within what afftdn accepts. */
const db = (value: number) => Math.round(Math.min(-20, Math.max(-80, value)));

/** The value at fraction `p` (0–1) of `sorted`, which is in order. */
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/**
 * How loud the quiet and loud parts of a recording are, in dBFS, measured
 * over 50 ms windows: `floor` is the background (the room's hiss and hum,
 * heard between words), `loud` is the speech. The floor is kept at least
 * 25 dB under the speech, so a recording without pauses (music, or speech
 * over a steady sound) isn't taken to be all noise.
 */
async function levels(
  context: HandlerContext<unknown>,
  input: string,
  before: string[],
  duration: number | null,
  span: [number, number],
): Promise<{ floor: number; loud: number } | null> {
  const windows: number[] = [];
  await runFfmpeg(
    context,
    [
      '-i',
      fileInput(input),
      '-map',
      '0:a:0',
      '-af',
      [
        ...before,
        'aresample=48000',
        'asetnsamples=n=2400:p=0',
        'astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level',
        'ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-',
      ].join(','),
      '-f',
      'null',
      '-',
    ],
    duration,
    {
      span,
      onStdout: (line) => {
        const level = /RMS_level=(-?[\d.]+|-inf)$/.exec(line)?.[1];
        // Digital silence (-inf) is the quietest a floor can be.
        if (level) windows.push(level === '-inf' ? -120 : Number(level));
      },
    },
  );
  if (!windows.length) return null;
  windows.sort((a, b) => a - b);
  const loud = percentile(windows, 0.9);
  return { floor: Math.min(percentile(windows, 0.1), loud - 25), loud };
}

/** What loudnorm's first pass measured, for its second. */
type Loudness = {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
};

/** Reads loudnorm's JSON, the last {…} it prints to stderr. */
function measured(stderr: string[]): Loudness | null {
  const json = stderr
    .join('\n')
    .match(/\{[^{}]*"input_i"[^{}]*\}/g)
    ?.at(-1);
  try {
    return json ? (JSON.parse(json) as Loudness) : null;
  } catch {
    return null;
  }
}

/** "83.4 s" or "1:23", for the note. */
const length = (seconds: number) =>
  seconds < 60
    ? `${Math.round(seconds * 10) / 10} s`
    : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * Cleans up a recording, in this order, each step only if chosen:
 *
 * 1. Remove Silence shortens every pause over 0.7 s to 0.7 s. A pause is
 *    whatever stays near the recording's own background level, measured
 *    first, so a noisy room's pauses count too.
 * 2. Reduce Noise cuts rumble under 80 Hz, then takes the steady
 *    background hiss and hum out (afftdn), with the noise floor set from
 *    the same measurement: a fixed floor would also take quiet speech.
 * 3. Normalize Volume brings it to -16 LUFS in two passes (loudnorm):
 *    the first measures the cleaned sound, the second applies one gain to
 *    it all, so quiet and loud parts keep their balance.
 *
 * Silence goes before the noise, as the denoiser works on a sound with
 * fewer pauses to learn from. The result is the same format as the file,
 * at its bitrate and sample rate, with its cover art and tags.
 */
export default defineHandler({
  options,
  async run(context) {
    const { input, values } = context;
    const { reduceNoise, removeSilence, normalizeVolume } = values;
    if (!reduceNoise && !removeSilence && !normalizeVolume) {
      throw new Error(
        'Turn on Reduce Noise, Normalize Volume or Remove Silence first.',
      );
    }
    const media = await probeMedia(context, input);
    if (!media.audio) throw new Error('This file has no sound to clean up.');
    const { duration } = media;
    const notes: string[] = [];
    const output = await sameAudioFormat(context, input, media);
    if (output.note) notes.push(output.note);

    // The passes share the bar: measuring is quick, the others decode,
    // clean and (the last) encode the whole file.
    const passes = [
      ...(reduceNoise || removeSilence ? [1] : []),
      ...(normalizeVolume ? [2] : []),
      2,
    ];
    const total = passes.reduce((sum, weight) => sum + weight, 0);
    const spans = passes.map((weight, index): [number, number] => {
      const before = passes.slice(0, index).reduce((sum, w) => sum + w, 0);
      return [(before / total) * 100, ((before + weight) / total) * 100];
    });
    const span = () => spans.shift() ?? [0, 100];

    const cleaning: string[] = reduceNoise ? [rumble] : [];
    if (reduceNoise || removeSilence) {
      const level = await levels(context, input, cleaning, duration, span());
      if (context.signal.aborted) return;
      if (level && removeSilence) {
        cleaning.push(
          `silenceremove=stop_periods=-1:stop_duration=${keptPause}:stop_threshold=${db(level.floor + 8)}dB:window=0.05`,
        );
      }
      if (level && reduceNoise) {
        cleaning.push(`afftdn=nr=20:nf=${db(level.floor + 6)}`);
      }
    }

    // A second output that only decodes keeps the progress clock at the
    // input's pace: with pauses removed, the cleaned sound runs shorter.
    const pace = removeSilence
      ? ['-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 'null', '-']
      : [];

    if (normalizeVolume) {
      const stderr: string[] = [];
      await runFfmpeg(
        context,
        [
          '-i',
          fileInput(input),
          '-map',
          '0:a:0',
          '-af',
          [...cleaning, `loudnorm=${loudness}:print_format=json`].join(','),
          '-f',
          'null',
          '-',
          ...pace,
        ],
        duration,
        { span: span(), onStderr: (line) => void stderr.push(line) },
      );
      if (context.signal.aborted) return;
      const found = measured(stderr);
      const level = Number(found?.input_i);
      if (!found || !Number.isFinite(level) || level < -70) {
        notes.push('This file is silent, so its volume was left as it is.');
      } else {
        cleaning.push(
          `loudnorm=${loudness}:measured_I=${found.input_i}:measured_TP=${found.input_tp}:measured_LRA=${found.input_lra}:measured_thresh=${found.input_thresh}:offset=${found.target_offset}:linear=true`,
        );
      }
    }

    const path = context.outputPath('-clean', output.ext);
    await runFfmpeg(
      context,
      [
        '-i',
        fileInput(input),
        ...output.args,
        ...(cleaning.length ? ['-af', cleaning.join(',')] : []),
        path,
        ...pace,
      ],
      duration,
      { span: span() },
    );
    if (context.signal.aborted) return;

    if (removeSilence && duration) {
      const after = (await probeMedia(context, path)).duration;
      if (after !== null && duration - after >= 0.5) {
        notes.push(`Pauses shortened: ${length(duration)} → ${length(after)}.`);
      } else {
        notes.push('It had no long pauses to shorten.');
      }
    }
    if (notes.length) context.note(notes.join(' '));
  },
});
