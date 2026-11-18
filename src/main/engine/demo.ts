// Demo links: https://demo.test/<flow> runs a predefined flow instead of
// yt-dlp, with no request leaving the machine (.test is reserved and never
// resolves). It answers the way yt-dlp does, so the app's own lookup,
// progress, error and file handling all run as for a real link. The video
// is a real one, its details as yt-dlp gave them (see video below). The
// download is a real file too, made by the bundled ffmpeg from the video's
// thumbnail and as long as the video, so later steps (Compress and the
// rest) work on it. Development builds only (see setDemo).
//
//   https://demo.test/video          found, then downloads (any other flow too)
//   https://demo.test/slow           found, after a slow lookup
//   https://demo.test/playlist       a playlist of it, three times over
//   https://demo.test/timeout        the lookup times out
//   https://demo.test/offline        the site can't be reached
//   https://demo.test/sign-in        the video needs signing in
//   https://demo.test/unavailable    the video was removed
//   https://demo.test/download-fail  found, but the download fails partway
//
// No Electron import, so the integration tests can use it with plain Node.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { exeName } from '../files';
import { MARK } from './args';
import { demoThumbnail } from './demoThumbnail';
import { run, type RunOptions, type RunResult } from './runner';

export { demoThumbnail };

const host = 'demo.test';
let enabled = false;

/** Turns demo links on or off; the main process turns them on in development. */
export function setDemo(on: boolean): void {
  enabled = on;
}

/** True for a demo link, while demo links are on. */
export function isDemo(url: string): boolean {
  if (!enabled) return false;
  try {
    return new URL(url).hostname === host;
  } catch {
    return false;
  }
}

/** The flow a link asks for: the first part of its path. */
function flowOf(url: string): string {
  return new URL(url).pathname.split('/')[1] || 'video';
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<boolean>((resolve) => {
    if (signal?.aborted) return resolve(false);
    const timer = setTimeout(() => resolve(true), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve(false);
      },
      { once: true },
    );
  });

/**
 * The video, as `yt-dlp -J` described it on 6 November 2026:
 * https://www.youtube.com/watch?v=SWeJVH7mEZk. Only the fields the app
 * reads; the formats are its MP4 video streams and its AAC audio.
 */
const video = {
  id: 'SWeJVH7mEZk',
  title:
    'Ben Shelton vs Tommy Paul All-American Clash 💥 | Paris 2026 Quarter-Final Highlights',
  uploader: 'Tennis TV',
  channel: 'Tennis TV',
  timestamp: 1_793_977_783,
  upload_date: '20261106',
  duration: 201,
  live_status: 'not_live',
  extractor_key: 'Youtube',
  formats: [
    ...(
      [
        ['160', 144, 1_724_080],
        ['133', 240, 3_749_456],
        ['134', 360, 7_296_408],
        ['135', 480, 14_315_956],
        ['298', 720, 38_052_588],
        ['299', 1080, 71_348_659],
      ] as const
    ).map(([format_id, height, filesize]) => ({
      format_id,
      ext: 'mp4',
      height,
      vcodec: 'avc1',
      acodec: 'none',
      filesize,
    })),
    {
      format_id: '140',
      ext: 'm4a',
      height: null,
      vcodec: 'none',
      acodec: 'mp4a.40.2',
      filesize: 3_249_179,
    },
  ],
};

/**
 * The video's details for a demo link. Its address stays the demo link, so
 * the download that follows runs the demo too.
 */
function videoInfo(url: string) {
  return {
    ...video,
    webpage_url: url,
    thumbnails: [{ url: `https://${host}/thumbnail`, width: 640, height: 360 }],
  };
}

function playlistInfo(url: string) {
  return {
    _type: 'playlist',
    id: 'demo-playlist',
    title: 'Paris 2026 Highlights',
    extractor_key: 'YoutubeTab',
    uploader: video.uploader,
    webpage_url: url,
    entries: [1, 2, 3].map((n) => ({
      url: `https://${host}/video-${n}`,
      title: video.title,
      duration: video.duration,
      playlist_index: n,
    })),
  };
}

/** yt-dlp's last words for each failing flow, as YouTube gives them. */
const failures: Record<string, string> = {
  timeout:
    "Unable to download webpage: <urlopen error [Errno 60] Operation timed out> (caused by URLError(TimeoutError(60, 'Operation timed out')))",
  offline:
    "Unable to download API page: HTTPSConnection(host='www.youtube.com', port=443): Failed to resolve 'www.youtube.com' (nodename nor servname provided, or not known)",
  'sign-in':
    'Sign in to confirm your age. This video may be inappropriate for some users.',
  unavailable: 'Video unavailable. This video has been removed by the uploader',
};

/** The file name yt-dlp gives it, with --windows-filenames. */
function fileName(title: string, id: string) {
  const wide: Record<string, string> = {
    '<': '＜',
    '>': '＞',
    ':': '：',
    '"': '＂',
    '/': '⧸',
    '\\': '⧹',
    '|': '｜',
    '?': '？',
    '*': '＊',
  };
  return `${title.replace(/[<>:"/\\|?*]/g, (c) => wide[c])} [${id}].mp4`;
}

/**
 * Stands in for `run(yt-dlp, args)` on a demo link: a lookup (-J) prints
 * the video's details, a download reports progress on its video and audio
 * streams and saves a file. `ffmpegDir` holds the ffmpeg that makes it.
 */
export async function runDemo(
  url: string,
  args: string[],
  opts: RunOptions,
  ffmpegDir: string | null,
): Promise<RunResult> {
  const stderrTail: string[] = [];
  const done = (code: number): RunResult => ({
    code,
    killed: false,
    timedOut: false,
    stderrTail,
  });
  const killed: RunResult = {
    code: null,
    killed: true,
    timedOut: false,
    stderrTail,
  };
  const fail = (line: string) => {
    stderrTail.push(`ERROR: [youtube] ${video.id}: ${line}`);
    opts.onStderr?.(stderrTail.at(-1)!);
    return done(1);
  };
  const flow = flowOf(url);
  const say = (line: string) => opts.onStdout?.(line);

  if (args.includes('-J')) {
    if (!(await sleep(flow === 'slow' ? 6000 : 1200, opts.signal))) {
      return killed;
    }
    if (failures[flow]) return fail(failures[flow]);
    say(
      JSON.stringify(flow === 'playlist' ? playlistInfo(url) : videoInfo(url)),
    );
    return done(0);
  }

  // A download, from the details the lookup saved.
  const saved = JSON.parse(
    await readFile(args[args.indexOf('--load-info-json') + 1], 'utf8'),
  ) as { id: string; title: string; duration: number };
  const outputDir = args.find(
    (arg, i) => args[i - 1] === '-P' && !arg.startsWith('temp:'),
  );
  if (!outputDir) return fail('No output folder given');

  // The 1080p video stream, then the audio, as "bv*+ba" picks them.
  const streams: [string, number][] = [
    ['299', 71_348_659],
    ['140', 3_249_179],
  ];
  say(`${MARK.formats}"299+140"`);
  for (const [format, total] of streams) {
    for (let step = 1; step <= 6; step++) {
      if (!(await sleep(250, opts.signal))) return killed;
      if (flow === 'download-fail' && format === '299' && step === 4) {
        return fail('Got error: The read operation timed out');
      }
      const p = {
        status: step === 6 ? 'finished' : 'downloading',
        downloaded_bytes: Math.round((total * step) / 6),
        total_bytes: total,
        speed: 18_500_000,
        eta: (6 - step) * 0.25,
      };
      say(`${MARK.progress}${JSON.stringify({ fmt: format, p })}`);
    }
  }

  // The file itself: the thumbnail held for the video's length, over a
  // tone, merged as ffmpeg would merge the streams.
  if (!ffmpegDir) return fail('Postprocessing: ffmpeg not found');
  say(`${MARK.postprocess}{"pp":"Merger","status":"started"}`);
  await mkdir(outputDir, { recursive: true });
  const target = path.join(outputDir, fileName(saved.title, saved.id));
  const still = `${target}.thumbnail.jpg`;
  await writeFile(
    still,
    Buffer.from(demoThumbnail.slice(demoThumbnail.indexOf(',') + 1), 'base64'),
  );
  const made = await run(
    path.join(ffmpegDir, exeName('ffmpeg')),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-loop',
      '1',
      '-framerate',
      '5',
      '-i',
      still,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${saved.duration}`,
      '-t',
      String(saved.duration),
      '-c:v',
      'mpeg4',
      '-q:v',
      '4',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      target,
    ],
    { signal: opts.signal },
  );
  await rm(still, { force: true });
  if (made.killed) return killed;
  if (made.code !== 0) {
    return fail(`Postprocessing: ${made.stderrTail.at(-1) ?? 'ffmpeg failed'}`);
  }
  say(`${MARK.postprocess}{"pp":"Merger","status":"finished"}`);
  say(`${MARK.file}${JSON.stringify(target)}`);
  return done(0);
}
