// A download request as the page sends it, made safe before it reaches the
// download manager: only the fields it may set, each checked, so nothing
// the page sends ends up in yt-dlp's arguments unchecked. A field left out
// here never reaches a job, so every field a request has belongs here.
//
// No Electron import, so the integration tests can check it.
import { isLanguageCode } from '../../shared/languages';
import type { DownloadRequest } from '../../shared/types';
import { validateUrl } from '../engine/args';

const isString = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length <= max;

export function cleanDownloadRequest(
  request: Partial<DownloadRequest>,
): DownloadRequest {
  return {
    url: validateUrl(String(request?.url ?? '')),
    // Checked by isQualityPreset in enqueue().
    quality: request?.quality as DownloadRequest['quality'],
    subtitles: request?.subtitles === true,
    // Tracks chosen by language: codes only, as they reach yt-dlp's
    // arguments (checked again in enqueue()).
    subtitleLanguage: isLanguageCode(request?.subtitleLanguage)
      ? request.subtitleLanguage
      : undefined,
    subtitleAuto: request?.subtitleAuto === true,
    audioLanguage: isLanguageCode(request?.audioLanguage)
      ? request.audioLanguage
      : undefined,
    originalLanguage: isLanguageCode(request?.originalLanguage)
      ? request.originalLanguage
      : undefined,
    // The renderer can't pick folders: only the configured one, which
    // changes through the native dialog.
    outputDir: undefined,
    probeToken: isString(request?.probeToken, 64)
      ? request.probeToken
      : undefined,
    // Shown only until the video is looked up; a thumbnail is fetched
    // by the main process, and only over https.
    title: isString(request?.title, 500) ? request.title : undefined,
    thumbnail:
      isString(request?.thumbnail, 2048) &&
      /^https:\/\//i.test(request.thumbnail)
        ? request.thumbnail
        : undefined,
    duration:
      typeof request?.duration === 'number' &&
      Number.isFinite(request.duration) &&
      request.duration > 0
        ? request.duration
        : undefined,
  };
}
