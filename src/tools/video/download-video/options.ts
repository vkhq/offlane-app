import type { FormatSummary, ProbeResult } from '../../../shared/types';
import {
  info,
  languageName,
  type Options,
  sameLanguage,
  select,
  toggle,
} from '../../options';

/** For a playlist, whose items' streams a lookup does not list. */
const playlistHeights = [2160, 1440, 1080, 720, 480, 360, 240, 144];

/**
 * Every video height the site lists, highest first, each labelled as sites
 * label it: by the frame's short side, so a vertical 1080x1920 video is
 * 1080p, with its frame rate when 50 or more (1080p60). The label maps back
 * to the real height, which is what the download asks for.
 */
function qualityChoices(formats: FormatSummary[]) {
  const best = new Map<number, number>();
  for (const format of formats) {
    if (!format.hasVideo || !format.height) continue;
    best.set(
      format.height,
      Math.max(best.get(format.height) ?? 0, format.fps ?? 0),
    );
  }
  const heights: Record<string, number> = {};
  for (const height of [...best.keys()].sort((a, b) => b - a)) {
    const width = formats.find((format) => format.height === height)?.width;
    const side = width ? Math.min(width, height) : height;
    const fps = best.get(height) ?? 0;
    const label = `${side}p${fps >= 50 ? Math.round(fps) : ''}`;
    heights[label] ??= height;
  }
  return heights;
}

/** The subtitles choice that saves none. */
export const noSubtitles = 'None';

/**
 * Choices for tracks by language, each named as the bar shows it under
 * its option ("Spanish", "English (Original)"), mapped back to the site's
 * code. Two codes with one name (rare) are told apart by their codes.
 */
function trackChoices(codes: string[], original?: string) {
  const named = codes.map((code) => ({
    code,
    name: languageName(code),
  }));
  const choices: Record<string, string> = {};
  for (const { code, name } of named) {
    const twin = named.filter((other) => other.name === name).length > 1;
    const label = `${name}${twin ? ` (${code})` : ''}${
      code === original ? ' (Original)' : ''
    }`;
    choices[label] = code;
  }
  return choices;
}

export type DownloadChoices = {
  options: Options;
  audio: boolean;
  heights: Record<string, number>;
  /** Each audio choice's language code; empty with nothing to choose. */
  audioTracks: Record<string, string>;
  /** Each subtitles choice's language code, `noSubtitles` aside, and
   *  whether it is the site's automatic captions. */
  subtitleTracks: Record<string, { code: string; auto: boolean }>;
  /** The video's original audio language, when the site says. */
  originalLanguage?: string;
};

/**
 * The options a looked-up link offers, built from what the lookup found, so
 * every quality the site lists is offered and nothing it lacks; whether it
 * will be saved as audio; and what each quality, audio and subtitles choice
 * asks for. Takes the Download choice, as quality and subtitles only apply
 * to video. Audio and Subtitles are offered only when there is a choice:
 * more than one audio language, or any subtitles at all.
 */
export function optionsFor(
  found: ProbeResult,
  download: string,
): DownloadChoices {
  if (found.kind === 'playlist') {
    const count = found.entries.length;
    const audio = download === 'Audio Only';
    // A flat playlist lookup lists the items, not their streams, so the
    // usual heights are offered and each item gets the nearest it has.
    const heights = Object.fromEntries(
      playlistHeights.map((height) => [`${height}p`, height]),
    );
    return {
      audio,
      heights,
      // Each item has its own languages, which a playlist lookup doesn't
      // list: English subtitles, as before, and each item's own audio.
      audioTracks: {},
      subtitleTracks: {},
      options: {
        items: info('Playlist', `${count} ${count === 1 ? 'video' : 'videos'}`),
        download: select('Download', ['Video', 'Audio Only']),
        ...(!audio && {
          quality: select(
            'Quality',
            ['Best', ...Object.keys(heights)],
            '1080p',
          ),
          subtitles: toggle('Save Subtitles'),
        }),
        format: info('Format', formatFor(audio)),
      },
    };
  }

  // A site that lists no formats, like a plain file link, is taken to have
  // both streams.
  const { formats } = found;
  const hasVideo = formats.length === 0 || formats.some((f) => f.hasVideo);
  const hasAudio = formats.length === 0 || formats.some((f) => f.hasAudio);
  const audio = !hasVideo || (hasAudio && download === 'Audio Only');

  const heights = qualityChoices(formats);
  const qualities = ['Best', ...Object.keys(heights)];
  // A lookup kept with a tab from an older build lists no languages.
  const languages = found.audioLanguages ?? [];
  const originalLanguage = languages.find(
    (language) => language.original,
  )?.code;
  const audioTracks =
    hasAudio && languages.length > 1
      ? trackChoices(
          languages.map((language) => language.code),
          originalLanguage,
        )
      : {};
  const audioLabels = Object.keys(audioTracks);
  // Subtitles people wrote, in alphabetical order (a video may have
  // dozens), then captions the site made from the speech, after them as
  // they are rougher. "en-orig" is named as "en".
  const written = Object.entries(
    trackChoices([...new Set(found.subtitleLanguages ?? [])]),
  ).sort(([a], [b]) => a.localeCompare(b));
  // A dubbed video has captions of each dub's speech too: only the
  // original's are offered, or all when the original isn't known.
  const spoken = found.autoCaptionLanguages ?? [];
  const ofOriginal = spoken.filter((code) =>
    sameLanguage(code.replace(/-orig$/, ''), originalLanguage),
  );
  const automatic = (ofOriginal.length > 0 ? ofOriginal : spoken).map(
    (code) =>
      [
        `${languageName(code.replace(/-orig$/, ''))} (Auto-generated)`,
        code,
      ] as const,
  );
  const subtitleTracks = Object.fromEntries([
    ...written.map(([label, code]) => [label, { code, auto: false }]),
    ...automatic.map(([label, code]) => [label, { code, auto: true }]),
  ]);
  const subtitleLabels = Object.keys(subtitleTracks);

  return {
    audio,
    heights,
    audioTracks,
    subtitleTracks,
    ...(originalLanguage && { originalLanguage }),
    options: {
      download:
        hasVideo && hasAudio
          ? select('Download', ['Video', 'Audio Only'])
          : info('Download', hasVideo ? 'Video, no sound' : 'Audio'),
      ...(!audio && {
        quality:
          qualities.length > 1
            ? select(
                'Quality',
                qualities,
                qualities.find((label) => label.startsWith('1080p')) ?? 'Best',
              )
            : info('Quality', 'Best available'),
      }),
      // The original first, and chosen unless another is.
      ...(audioLabels.length > 1 && {
        audioTrack: {
          ...select('Audio', audioLabels, audioLabels[0]),
          summary: (value) => `${value.replace(' (Original)', '')} audio`,
        },
      }),
      ...(!audio &&
        subtitleLabels.length > 0 && {
          subtitleTrack: {
            ...select(
              'Subtitles',
              [noSubtitles, ...subtitleLabels],
              noSubtitles,
            ),
            summary: (value) =>
              value === noSubtitles ? null : `${value} subtitles`,
          },
        }),
      format: info('Format', formatFor(audio)),
    },
  };
}

const formatFor = (audio: boolean) => (audio ? 'Best audio' : 'MP4 or MKV');
