import type { FormatSummary, ProbeResult } from '../../../shared/types';
import { info, type Options, select, toggle } from '../../options';

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

/**
 * The options a looked-up link offers, built from what the lookup found, so
 * every quality the site lists is offered and nothing it lacks; whether it
 * will be saved as audio; and the height each quality choice asks for.
 * Takes the Download choice, as quality and subtitles only apply to video.
 */
export function optionsFor(
  found: ProbeResult,
  download: string,
): { options: Options; audio: boolean; heights: Record<string, number> } {
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
  // The downloader saves English subtitles only. A lookup kept with a tab
  // from before languages were recorded has none listed.
  const subtitles = (found.subtitleLanguages ?? []).some((language) =>
    /^en\b/.test(language),
  );

  return {
    audio,
    heights,
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
        ...(subtitles && { subtitles: toggle('Save Subtitles') }),
      }),
      format: info('Format', formatFor(audio)),
    },
  };
}

const formatFor = (audio: boolean) => (audio ? 'Best audio' : 'MP4 or MKV');
