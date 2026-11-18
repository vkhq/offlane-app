#!/usr/bin/env node
// A stand-in for yt-dlp, for the offline app tests (../e2e/download.mjs):
// it answers the app's calls the way yt-dlp does, from canned data, and
// never touches the network. The app runs it in place of the real one when
// OFFLANE_MOCKS points at a folder holding it (see src/main/mocks.ts).
//
// The video id in the link picks what happens:
//   mock-ok            found, then downloads (the default for any other id)
//   mock-timeout       the lookup fails: the site never answers
//   mock-download-fail found, but the download fails partway
//   mock-short         an upright YouTube Short: only wide thumbnails listed,
//                      as YouTube does, so the app tries its upright one
//   mock-reel          an upright video from another site, with an upright
//                      thumbnail
//   mock-signin        refused, as Instagram does, until yt-dlp is given a
//                      browser's sign-ins (--cookies-from-browser)
//   mock-playlist      a playlist of three: two that download and one,
//                      mock-gone, that was removed and fails at once
//
// MOCK_DELAY_MS (default 800) is how long a lookup takes, long enough to
// see the "Looking up…" state; MOCK_STEP_MS (default 120) paces progress.
import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
// The folder the app was pointed at, with the clip it hands out.
const media = process.env.OFFLANE_MOCKS ?? '.';
const lookupDelay = Number(process.env.MOCK_DELAY_MS ?? 800);
const step = Number(process.env.MOCK_STEP_MS ?? 120);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const valueOf = (flag) => args[args.indexOf(flag) + 1];

if (args.includes('--version')) {
  console.log('2026.08.19-mock');
  process.exit(0);
}

/** The video id from a watch link, else its last path part. */
function idOf(link) {
  const url = new URL(link);
  return url.searchParams.get('v') ?? url.pathname.split('/').pop() ?? 'mock';
}

function info(id, link) {
  const upright = id === 'mock-short' || id === 'mock-reel';
  return {
    id,
    ...(upright ? { width: 1080, height: 1920 } : {}),
    title: 'Mock video, a walk by the river',
    webpage_url: link,
    extractor_key: id === 'mock-reel' ? 'Instagram' : 'Youtube',
    uploader: 'Mock Channel',
    timestamp: Math.floor(Date.now() / 1000) - 3 * 86_400,
    duration: 4,
    live_status: 'not_live',
    thumbnails:
      id === 'mock-reel'
        ? [
            {
              url: 'https://mock.test/thumb-upright.jpg',
              width: 1080,
              height: 1920,
            },
          ]
        : [{ url: 'https://mock.test/thumb.jpg', width: 1280, height: 720 }],
    thumbnail: 'https://mock.test/thumb.jpg',
    formats: [
      {
        format_id: '18',
        ext: 'mp4',
        height: 360,
        vcodec: 'avc1',
        acodec: 'mp4a',
      },
      {
        format_id: '22',
        ext: 'mp4',
        height: 720,
        vcodec: 'avc1',
        acodec: 'mp4a',
      },
    ],
  };
}

function fail(id, line) {
  process.stderr.write(`ERROR: [youtube] ${id}: ${line}\n`);
  process.exit(1);
}

// A lookup: -J prints the video's details.
if (args.includes('-J')) {
  const link = args.at(-1);
  const id = idOf(link);
  await sleep(lookupDelay);
  if (id === 'mock-signin' && !args.includes('--cookies-from-browser')) {
    fail(
      id,
      'Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in. If it is not, then use --cookies-from-browser or --cookies for the authentication.',
    );
  }
  if (id === 'mock-playlist') {
    const entry = (videoId, title) => ({
      _type: 'url',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      duration: 4,
      thumbnails: [
        { url: 'https://mock.test/thumb.jpg', width: 1280, height: 720 },
      ],
    });
    console.log(
      JSON.stringify({
        _type: 'playlist',
        id,
        title: 'Mock playlist',
        extractor_key: 'YoutubeTab',
        uploader: 'Mock Channel',
        webpage_url: link,
        entries: [
          entry('mock-pl-1', 'First walk'),
          entry('mock-pl-2', 'Second walk'),
          entry('mock-gone', 'A removed video'),
        ],
      }),
    );
    process.exit(0);
  }
  if (id === 'mock-timeout') {
    fail(
      id,
      "Unable to download webpage: <urlopen error [Errno 60] Operation timed out> (caused by URLError(TimeoutError(60, 'Operation timed out')))",
    );
  }
  console.log(JSON.stringify(info(id, link)));
  process.exit(0);
}

// A download, from the details the lookup saved.
const saved = args.includes('--load-info-json')
  ? JSON.parse(readFileSync(valueOf('--load-info-json'), 'utf8'))
  : info(idOf(args.at(-1)), args.at(-1));
const outputDir = args.find(
  (arg, i) => args[i - 1] === '-P' && !arg.startsWith('temp:'),
);
const total = 2_000_000;
if (saved.id === 'mock-gone') {
  fail(
    saved.id,
    'Video unavailable. This video has been removed by the uploader',
  );
}
console.log(`__R__"18"`);
for (let i = 1; i <= 10; i++) {
  await sleep(step);
  if (saved.id === 'mock-download-fail' && i === 4) {
    process.stderr.write(
      '[download] Got error: The read operation timed out. Retrying (1/10)...\n',
    );
    fail(saved.id, 'The read operation timed out');
  }
  const p = {
    status: i === 10 ? 'finished' : 'downloading',
    downloaded_bytes: (total * i) / 10,
    total_bytes: total,
    speed: 1_500_000,
    eta: 10 - i,
  };
  console.log(`__P__${JSON.stringify({ fmt: '18', p })}`);
}
const target = path.join(outputDir, `${saved.title} [${saved.id}].mp4`);
// An upright video gets an upright clip.
const upright = saved.id === 'mock-short' || saved.id === 'mock-reel';
copyFileSync(
  path.join(media, upright ? 'clip-upright.mp4' : 'clip.mp4'),
  target,
);
console.log(`__F__${JSON.stringify(target)}`);
