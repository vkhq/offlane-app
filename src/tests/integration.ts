// Integration tests for the download engine and the toolkit installer, run
// with plain Node (no Electron): `npm run test:integration`.
//
// The engine tests use the real yt-dlp and ffmpeg from vendor/ (run
// `npm run fetch-binaries` first) against a local HTTP server, through
// yt-dlp's generic extractor, so they need no internet. The installer tests
// serve small fake archives whose "ffmpeg" is a shell script, so they run on
// macOS and Linux only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { isQualityPreset, type Job, type Settings } from '../shared/types';
import { DownloadManager } from '../main/downloads/manager';
import { buildDownloadArgs, validateUrl } from '../main/engine/args';
import { isDemo, setDemo } from '../main/engine/demo';
import { resolveBinaries, resolveFfmpeg } from '../main/engine/binaries';
import {
  ExternalToolError,
  ExternalTools,
  searchDirs,
} from '../main/engine/external';
import { ytdlpAgeDays } from '../shared/externalTools';
import { classifyError, reason } from '../main/engine/errors';
import { toProbeResult } from '../main/engine/probe';
import { parseLine, ProgressTracker } from '../main/engine/progress';
import type { ToolkitRelease } from '../main/toolkits/catalog';
import { FEED, parseFeed, verifyFeed } from '../main/toolkits/feed';
import {
  brand,
  brandServers,
  displayName,
  officialBuild,
} from '../shared/brand';
import { feedPublicKeys } from '../main/toolkits/trust';
import { ToolkitInstaller } from '../main/toolkits/installer';
import { Toolkits } from '../main/toolkits/service';
import {
  ToolkitMissingError,
  ToolkitStore,
  migrateLegacyFfmpeg,
  vendorToolkits,
} from '../main/toolkits/store';
import { StorageInventory } from '../main/storage/inventory';
import { SessionStore } from '../main/storage/sessions';
import { defaultSettings, mergeSettings } from '../main/storage/settings';
import { type ToolHandler, ToolQueue } from '../main/tools/queue';
import { defineOptions, quality, select, toggle } from '../shared/tools';
import compressVideo from '../tools/video/compress-video/handler';
import { optionsFor } from '../tools/video/download-video/options';
import { fileKindOf } from '../shared/fileKinds';
import { resolveOutputs } from '../main/tools/outputs';

const target = `${{ darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform as string]}-${process.arch}`;
const bundledBinDir = path.resolve('vendor', target, 'bin');
const hasEngine = existsSync(path.join(bundledBinDir, 'yt-dlp'));
/** The toolkits a development checkout has in vendor/, as the app sees them. */
const vendorStore = (root: string) =>
  new ToolkitStore(root, vendorToolkits(bundledBinDir));

let tmp: string;
let server: http.Server;
let base: string;
/** Bytes per second the "slow" route sends, so a download can be caught
 *  half way. */
const slowRate = 64 * 1024;
const served: { path: string; range?: string }[] = [];

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'theoneapp-test-'));
  const media = path.join(tmp, 'media');
  await fs.mkdir(media);
  if (hasEngine) {
    // A short clip with video and audio, made by the bundled LGPL ffmpeg
    // with its own encoders.
    const result = spawnSync(path.join(bundledBinDir, 'ffmpeg'), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=4:size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:v',
      'mpeg4',
      '-q:v',
      '2',
      '-c:a',
      'aac',
      '-shortest',
      path.join(media, 'clip.mp4'),
    ]);
    assert.equal(result.status, 0, String(result.stderr));
    // A bigger file for the slow route, so it takes a few seconds.
    await fs.writeFile(
      path.join(media, 'big.mp4'),
      Buffer.concat([
        await fs.readFile(path.join(media, 'clip.mp4')),
        Buffer.alloc(2 * 1024 * 1024),
      ]),
    );
  }

  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    served.push({ path: url.pathname, range: request.headers.range });
    if (url.pathname === '/gone.zip') {
      response.writeHead(404).end();
      return;
    }
    const slow = url.pathname.startsWith('/slow/');
    const file = path.join(
      tmp,
      slow ? 'media' : '',
      url.pathname.replace(/^\/(slow\/)?/, ''),
    );
    if (!file.startsWith(tmp) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    const range = /bytes=(\d+)-/.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    response.writeHead(range ? 206 : 200, {
      'Content-Type': file.endsWith('.mp4')
        ? 'video/mp4'
        : 'application/octet-stream',
      'Content-Length': size - start,
      'Accept-Ranges': 'bytes',
      ...(range
        ? { 'Content-Range': `bytes ${start}-${size - 1}/${size}` }
        : {}),
    });
    const stream = createReadStream(file, {
      start,
      highWaterMark: slow ? slowRate / 4 : 64 * 1024,
    });
    if (!slow) {
      stream.pipe(response);
      return;
    }
    stream.on('data', (chunk) => {
      stream.pause();
      response.write(chunk);
      setTimeout(() => stream.resume(), 250);
    });
    stream.on('end', () => response.end());
    response.on('close', () => stream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('arguments', () => {
  test('only http(s) links are accepted', () => {
    assert.throws(() => validateUrl('file:///etc/passwd'));
    assert.throws(() => validateUrl('--exec=rm -rf ~'));
    assert.throws(() => validateUrl('javascript:alert(1)'));
    assert.equal(
      validateUrl(' https://example.com/v '),
      'https://example.com/v',
    );
  });

  test('the URL always follows "--" and config files are ignored', () => {
    const args = buildDownloadArgs({
      bin: {
        ytdlp: 'yt-dlp',
        ffmpegDir: '/ff',
        ffmpeg: null,
        pathDirs: [],
      },
      settings: defaultSettings('/out'),
      quality: '1080',
      subtitles: true,
      outputDir: '/out',
      tempDir: '/tmp/job',
      source: { url: 'https://example.com/v' },
    });
    assert.equal(args.at(-2), '--');
    assert.equal(args.at(-1), 'https://example.com/v');
    for (const flag of ['--ignore-config', '--no-plugin-dirs', '--no-update']) {
      assert.ok(args.includes(flag), flag);
    }
    assert.equal(args[args.indexOf('--ffmpeg-location') + 1], '/ff');
    assert.ok(args.includes('--embed-subs'));
    // What yt-dlp runs on is its own business: no runtime is chosen for it.
    assert.ok(!args.some((arg) => arg.startsWith('--js-runtimes')));
    // --no-quiet must come after --print, which implies --quiet.
    assert.ok(args.lastIndexOf('--no-quiet') > args.lastIndexOf('--print'));
  });
  test("a chosen browser's sign-ins are used, and only a known browser", () => {
    const argsWith = (cookiesBrowser: string) =>
      buildDownloadArgs({
        bin: {
          ytdlp: 'yt-dlp',
          ffmpegDir: null,
          ffmpeg: null,
          pathDirs: [],
        },
        settings: { ...defaultSettings('/out'), cookiesBrowser },
        quality: 'best',
        subtitles: false,
        outputDir: '/out',
        tempDir: '/tmp/job',
        source: { url: 'https://www.instagram.com/p/x/' },
      });
    const chrome = argsWith('chrome');
    assert.equal(
      chrome[chrome.indexOf('--cookies-from-browser') + 1],
      'chrome',
    );
    assert.ok(!argsWith('').includes('--cookies-from-browser'));
    // Never passed through, even if a bad value got into the file.
    assert.ok(!argsWith('--exec=rm').includes('--cookies-from-browser'));
    const settings = defaultSettings('/out');
    assert.equal(
      mergeSettings(settings, { cookiesBrowser: 'safari' }).cookiesBrowser,
      'safari',
    );
    assert.equal(
      mergeSettings(settings, { cookiesBrowser: '' }).cookiesBrowser,
      '',
    );
    assert.throws(() =>
      mergeSettings(settings, { cookiesBrowser: '--exec=rm -rf ~' }),
    );
  });
});

describe('download options from a lookup', () => {
  const video = (info: Record<string, unknown>) => {
    const found = toProbeResult('https://example.com/v', {
      title: 'A video',
      ...info,
    });
    assert.equal(found.kind, 'video');
    return found;
  };
  const stream = (height: number | null, vcodec = 'avc1', acodec = 'mp4a') => ({
    format_id: String(height),
    ext: 'mp4',
    height,
    vcodec,
    acodec,
  });
  const choices = (options: Record<string, { kind: string }>, key: string) => {
    const setting = options[key];
    return setting?.kind === 'select'
      ? (setting as unknown as { options: string[] }).options
      : setting?.kind;
  };

  test('quality offers every height the video has', () => {
    const found = video({
      formats: [stream(1080), stream(720), stream(360), stream(null, 'none')],
    });
    const { options, audio } = optionsFor(found, 'Video');
    assert.equal(audio, false);
    assert.deepEqual(choices(options, 'quality'), [
      'Best',
      '1080p',
      '720p',
      '360p',
    ]);
    assert.equal(
      options.quality?.kind === 'select' && options.quality.value,
      '1080p',
    );
    // No subtitles on offer, so no toggle.
    assert.equal(options.subtitles, undefined);
  });

  test('qualities are labelled by the short side, with high frame rates', () => {
    const sized = (width: number, height: number, fps: number) => ({
      ...stream(height),
      width,
      fps,
    });
    const found = video({
      formats: [
        sized(1080, 1920, 60),
        sized(1080, 1920, 30),
        sized(720, 1280, 30),
        sized(360, 640, 30),
      ],
    });
    const { options, heights } = optionsFor(found, 'Video');
    assert.deepEqual(choices(options, 'quality'), [
      'Best',
      '1080p60',
      '720p',
      '360p',
    ]);
    // Labelled by the short side, but downloaded by the real height.
    assert.equal(heights['1080p60'], 1920);
    assert.equal(
      options.quality?.kind === 'select' && options.quality.value,
      '1080p60',
    );
  });

  test('any sensible height is a quality the downloader takes', () => {
    for (const ok of ['best', 'audio', '144', '1080', '4320']) {
      assert.ok(isQualityPreset(ok), ok);
    }
    for (const bad of ['', '0', '1080p', '-1', '123456', 1080, null]) {
      assert.ok(!isQualityPreset(bad), String(bad));
    }
  });

  test('a video with one height has nothing to choose', () => {
    const { options } = optionsFor(video({ formats: [stream(720)] }), 'Video');
    assert.deepEqual(choices(options, 'quality'), ['Best', '720p']);
    const single = optionsFor(video({ formats: [stream(null)] }), 'Video');
    assert.equal(choices(single.options, 'quality'), 'info');
  });

  test('audio only drops quality and subtitles', () => {
    const found = video({
      formats: [stream(1080)],
      subtitles: { en: [], live_chat: [] },
    });
    assert.deepEqual(found.subtitleLanguages, ['en']);
    assert.ok(optionsFor(found, 'Video').options.subtitles);
    const { options, audio } = optionsFor(found, 'Audio Only');
    assert.equal(audio, true);
    assert.equal(options.quality, undefined);
    assert.equal(options.subtitles, undefined);
  });

  test('a link with one kind of stream offers no Download choice', () => {
    const music = optionsFor(
      video({ formats: [stream(null, 'none', 'opus')] }),
      'Video',
    );
    assert.equal(music.audio, true);
    assert.equal(choices(music.options, 'download'), 'info');
    assert.equal(music.options.quality, undefined);
    const silent = optionsFor(
      video({ formats: [stream(720, 'avc1', 'none')] }),
      'Audio Only',
    );
    assert.equal(silent.audio, false);
    assert.equal(choices(silent.options, 'download'), 'info');
  });

  test('subtitles show only when English is on offer', () => {
    const french = video({ formats: [stream(720)], subtitles: { fr: [] } });
    assert.equal(optionsFor(french, 'Video').options.subtitles, undefined);
    const british = video({
      formats: [stream(720)],
      subtitles: { 'en-GB': [] },
    });
    assert.ok(optionsFor(british, 'Video').options.subtitles);
    // A lookup from an older build, kept with a tab, lists no languages.
    const { subtitleLanguages: _, ...older } = british;
    assert.equal(
      optionsFor(older as typeof british, 'Video').options.subtitles,
      undefined,
    );
  });

  test('a playlist shows its size and the usual choices', () => {
    const found = toProbeResult('https://example.com/list', {
      _type: 'playlist',
      title: 'A list',
      entries: [
        { url: 'https://example.com/1', title: 'One' },
        { url: 'https://example.com/2', title: 'Two' },
      ],
    });
    const { options } = optionsFor(found, 'Video');
    assert.equal(
      options.items?.kind === 'info' && options.items.value,
      '2 videos',
    );
    assert.equal((choices(options, 'quality') as string[]).length, 9);
  });
});

describe('chaining tools', () => {
  const toolJob = '11111111-1111-4111-8111-111111111111';
  const download = '22222222-2222-4222-8222-222222222222';
  const sources = {
    toolOutputs: (id: string) =>
      id === toolJob ? ['/out/a-compressed.mp4', '/out/a-compressed.wav'] : [],
    download: (id: string) =>
      id === download
        ? ({ status: 'completed', outputPath: '/out/video.mp4' } as Job)
        : undefined,
  };

  test('earlier outputs resolve to paths from our own records', () => {
    assert.deepEqual(
      resolveOutputs(
        [
          { source: 'tool', jobId: toolJob, index: 1 },
          { source: 'download', jobId: download, index: 0 },
        ],
        sources,
      ),
      ['/out/a-compressed.wav', '/out/video.mp4'],
    );
    assert.deepEqual(resolveOutputs(undefined, sources), []);
  });

  test('unknown, unfinished or malformed references are refused', () => {
    const refuse = (outputs: unknown, message: RegExp) =>
      assert.throws(() => resolveOutputs(outputs, sources), message);
    refuse([{ source: 'tool', jobId: toolJob, index: 2 }], /no longer/);
    refuse([{ source: 'tool', jobId: download, index: 0 }], /no longer/);
    refuse([{ source: 'download', jobId: download, index: 1 }], /no longer/);
    refuse([{ source: 'disk', jobId: toolJob, index: 0 }], /Invalid/);
    refuse([{ source: 'tool', jobId: '/etc/passwd', index: 0 }], /Invalid/);
    refuse([{ source: 'tool', jobId: toolJob, index: -1 }], /Invalid/);
    refuse('nope', /Invalid/);
    const unfinished = {
      ...sources,
      download: () => ({ status: 'downloading' }) as Job,
    };
    assert.throws(
      () =>
        resolveOutputs(
          [{ source: 'download', jobId: download, index: 0 }],
          unfinished,
        ),
      /no longer/,
    );
  });

  test('file kinds come from the extension', () => {
    assert.equal(fileKindOf('clip.MP4'), 'video');
    assert.equal(fileKindOf('song.m4a'), 'audio');
    assert.equal(fileKindOf('photo.heic'), 'image');
    assert.equal(fileKindOf('doc.pdf'), 'pdf');
    assert.equal(fileKindOf('notes.srt'), 'file');
    assert.equal(fileKindOf('README'), 'file');
  });

  test("every tool's accepts matches its page's input", () => {
    const helpers: Record<string, string[]> = {
      dropVideos: ['video'],
      dropAudio: ['audio'],
      dropImages: ['image'],
      dropPdfs: ['pdf'],
      dropFiles: ['file'],
    };
    const mimes: Record<string, string> = {
      'video/*': 'video',
      'audio/*': 'audio',
      'image/*': 'image',
      'application/pdf': 'pdf',
    };
    const root = path.resolve('src/tools');
    let checked = 0;
    for (const group of readdirSync(root)) {
      const groupDir = path.join(root, group);
      if (!statSync(groupDir).isDirectory()) continue;
      for (const tool of readdirSync(groupDir)) {
        const dir = path.join(groupDir, tool);
        if (!existsSync(path.join(dir, 'page.tsx'))) continue;
        const page = readFileSync(path.join(dir, 'page.tsx'), 'utf8');
        const manifest = readFileSync(path.join(dir, 'manifest.ts'), 'utf8');
        const input = /input:\s*(drop\w*)\(([^)]*)\)/.exec(page);
        const declared = /accepts:\s*\[([^\]]*)\]/.exec(manifest);
        const accepts = declared
          ? [...declared[1].matchAll(/'(\w+)'/g)].map((match) => match[1])
          : null;
        if (!input) {
          assert.equal(accepts, null, `${tool} takes no files`);
          continue;
        }
        const expected =
          input[1] === 'drop'
            ? [
                ...new Set(
                  (/'[^']*',\s*'([^']*)'/.exec(input[2])?.[1] ?? '')
                    .split(',')
                    .map((mime) => mimes[mime.trim()])
                    .filter(Boolean),
                ),
              ]
            : helpers[input[1]];
        assert.deepEqual(accepts, expected, tool);
        checked += 1;
      }
    }
    assert.ok(checked >= 37, `checked ${checked} tools`);
  });
});

describe('errors', () => {
  test('common failures are classified', () => {
    const cases: [string, string][] = [
      ['ERROR: [youtube] x: Sign in to confirm your age', 'auth_required'],
      ['ERROR: Unsupported URL: https://example.com', 'unsupported_url'],
      [
        'ERROR: unable to download video data: HTTP Error 429: Too Many Requests',
        'rate_limited',
      ],
      ["ERROR: Postprocessing: Unknown encoder 'libx264'", 'missing_codec'],
      ['ERROR: [blog] Unable to download webpage: timed out', 'network'],
    ];
    for (const [line, category] of cases) {
      assert.equal(classifyError([line]).category, category, line);
    }
    assert.equal(
      classifyError(["Unknown encoder 'libx264'"]).action,
      'install_full_ffmpeg',
    );
    // A site that wants a sign-in offers the browser's.
    const instagram = classifyError([
      'ERROR: [Instagram] CzT1z6eMnS7: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in. If it is not, then use --cookies-from-browser or --cookies for the authentication.',
    ]);
    assert.equal(instagram.category, 'auth_required');
    assert.equal(instagram.action, 'use_browser_cookies');
    // Its sign-ins unreadable: Safari without Full Disk Access, or none.
    const safari = classifyError([
      "ERROR: [Errno 1] Operation not permitted: '/Users/me/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies'",
    ]);
    assert.equal(safari.category, 'browser_blocked');
    assert.match(safari.message, /Full Disk Access/);
    assert.equal(
      classifyError([
        "ERROR: could not find chrome cookies database in '/Users/me/Library/Application Support/Google/Chrome'",
      ]).category,
      'browser_cookies',
    );
    // "log in" must not match inside "blog in".
    assert.notEqual(
      classifyError(['ERROR: [blog in a box] x: Video unavailable']).category,
      'auth_required',
    );
  });

  test('network and unknown failures say why, plainly and briefly', () => {
    const say = (line: string) => classifyError([line]).message;
    assert.equal(
      say('ERROR: [download] Got error: The read operation timed out'),
      'The site took too long to respond.',
    );
    assert.equal(
      say(
        "ERROR: [youtube] jNQXAC9IVRw: Unable to download API page: HTTPSConnection(host='www.youtube.com', port=443): Failed to resolve 'www.youtube.com' (nodename nor servname provided, or not known)",
      ),
      'Couldn’t reach youtube.com. Check your internet connection.',
    );
    assert.equal(
      classifyError(["ERROR: [youtube] x: Failed to resolve 'www.youtube.com'"])
        .category,
      'network',
    );
    assert.equal(
      reason(
        "ERROR: [generic] abc: Unable to download webpage: <urlopen error [Errno 60] Operation timed out> (caused by URLError(TimeoutError(60, 'Operation timed out')))",
      ),
      'The site took too long to respond.',
    );
    const unknown = classifyError([
      'ERROR: [vimeo] 123: something odd happened',
    ]);
    assert.equal(unknown.category, 'unknown');
    assert.equal(unknown.message, 'Something odd happened.');
    // Python's names go, and a long reason is cut at a word.
    assert.equal(
      reason("ERROR: [x] y: Foo failed: Session(id='a1', retry=3): bad state"),
      'Foo failed: bad state.',
    );
    const long = reason(`ERROR: ${'word '.repeat(60)}`);
    assert.ok(long.length <= 101 && long.endsWith('…'), long);
    assert.equal(reason('ERROR: '), 'Something went wrong. Try again.');
  });
});

describe('progress', () => {
  test('one bar across video, audio and merge never goes backwards', () => {
    const tracker = new ProgressTracker();
    const lines = [
      '__R__"137+140"',
      '__P__{"fmt":"137","p":{"status":"downloading","downloaded_bytes":50,"total_bytes":100}}',
      '__P__{"fmt":"137","p":{"status":"finished","downloaded_bytes":100,"total_bytes":100}}',
      '__P__{"fmt":"140","p":{"status":"downloading","downloaded_bytes":10,"total_bytes":100}}',
      '__PP__{"pp":"Merger","status":"started"}',
      '__F__"/out/a.mp4"',
    ];
    let last = -1;
    for (const line of lines) {
      tracker.feed(parseLine(line));
      const percent = tracker.snapshot().percent ?? 0;
      assert.ok(percent >= last, `${percent} after ${last}`);
      last = percent;
    }
    assert.equal(last, 100);
  });
});

describe(
  'downloads (real yt-dlp + ffmpeg)',
  { skip: !hasEngine && 'run npm run fetch-binaries first' },
  () => {
    const settings = (out: string): Settings => ({
      ...defaultSettings(out),
      embedMetadata: false,
    });

    async function newManager(name: string) {
      const out = path.join(tmp, name, 'out');
      const manager = new DownloadManager({
        getBinaries: () =>
          resolveBinaries(vendorStore(path.join(tmp, name, 'toolkits')), {
            // vendor/'s yt-dlp, as if the person had installed it.
            forJob: () => ({
              ytdlp: path.join(bundledBinDir, 'yt-dlp', 'yt-dlp'),
              pathDirs: [path.join(bundledBinDir, 'yt-dlp')],
            }),
          }),
        getSettings: () => settings(out),
        workDir: path.join(tmp, name, 'work'),
      });
      return { manager, out };
    }

    /** Resolves with the job once it reaches one of `statuses`. */
    const waitFor = (
      manager: DownloadManager,
      id: string,
      statuses: string[],
      ms = 60_000,
    ) =>
      new Promise<Job>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${statuses}`)),
          ms,
        );
        const check = (job: Job) => {
          if (job.id === id && statuses.includes(job.status)) {
            clearTimeout(timer);
            manager.off('job-updated', check);
            resolve(job);
          }
        };
        manager.on('job-updated', check);
        const now = manager.get(id);
        if (now) check(now);
      });

    test('probes and downloads a single file', async () => {
      const { manager, out } = await newManager('single');
      const info = await manager.probe(`${base}/media/clip.mp4`);
      assert.equal(info.kind, 'video');
      const [job] = manager.enqueue([
        {
          url: `${base}/media/clip.mp4`,
          quality: 'best',
          probeToken: info.probeToken,
        },
      ]);
      const done = await waitFor(manager, job.id, ['completed', 'failed']);
      assert.equal(done.status, 'completed', done.error?.raw ?? '');
      assert.ok(done.outputPath && existsSync(done.outputPath));
      assert.ok(done.outputPath.startsWith(out));
      await manager.shutdown();
    });

    test('demo links run their flows offline', async () => {
      assert.equal(isDemo('https://demo.test/video'), false, 'off by default');
      setDemo(true);
      try {
        const { manager, out } = await newManager('demo');
        const info = await manager.probe('https://demo.test/video');
        assert.equal(info.kind, 'video');
        assert.equal(info.kind === 'video' && info.duration, 201);
        assert.match(info.title, /^Ben Shelton vs Tommy Paul/);
        assert.match(info.thumbnailImage ?? '', /^data:image\/jpeg/);
        const [job] = manager.enqueue([
          {
            url: 'https://demo.test/video',
            quality: 'best',
            probeToken: info.probeToken,
          },
        ]);
        const done = await waitFor(manager, job.id, ['completed', 'failed']);
        assert.equal(done.status, 'completed', done.error?.raw ?? '');
        assert.ok(done.outputPath?.startsWith(out));
        assert.ok(done.outputPath && existsSync(done.outputPath));

        const playlist = await manager.probe('https://demo.test/playlist');
        assert.equal(
          playlist.kind === 'playlist' && playlist.entries.length,
          3,
        );

        const failing: [string, string][] = [
          ['timeout', 'The site took too long to respond.'],
          [
            'offline',
            'Couldn’t reach youtube.com. Check your internet connection.',
          ],
          ['sign-in', 'This content needs you to be signed in to the site.'],
        ];
        for (const [flow, message] of failing) {
          await assert.rejects(
            manager.probe(`https://demo.test/${flow}`),
            (error: Error) => error.message === message,
            flow,
          );
        }

        const broken = await manager.probe('https://demo.test/download-fail');
        const [failed] = manager.enqueue([
          {
            url: 'https://demo.test/download-fail',
            quality: 'best',
            probeToken: broken.probeToken,
          },
        ]);
        // A timeout is retried later, so it goes back to the queue.
        await waitFor(manager, failed.id, ['downloading']);
        const after = await waitFor(manager, failed.id, ['failed', 'queued']);
        assert.equal(
          after.error?.message,
          'The site took too long to respond.',
        );
        await manager.shutdown();
      } finally {
        setDemo(false);
      }
    });

    test('extracts audio with ffmpeg', async () => {
      const { manager } = await newManager('audio');
      const [job] = manager.enqueue([
        { url: `${base}/media/clip.mp4`, quality: 'audio' },
      ]);
      const done = await waitFor(manager, job.id, ['completed', 'failed']);
      assert.equal(done.status, 'completed', done.error?.raw ?? '');
      assert.match(done.outputPath ?? '', /\.(m4a|aac|mp3|opus|ogg)$/);
      await manager.shutdown();
    });

    test('pause keeps the partial file and resume continues it', async () => {
      const { manager } = await newManager('resume');
      const [job] = manager.enqueue([
        { url: `${base}/slow/big.mp4`, quality: 'best' },
      ]);
      await waitFor(manager, job.id, ['downloading']);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      manager.pause(job.id);
      await waitFor(manager, job.id, ['paused']);
      const tempDir = path.join(tmp, 'resume', 'work', 'jobs', job.id);
      assert.ok(readdirSync(tempDir).some((name) => name.endsWith('.part')));
      served.length = 0;
      manager.resume(job.id);
      const done = await waitFor(
        manager,
        job.id,
        ['completed', 'failed'],
        120_000,
      );
      assert.equal(done.status, 'completed', done.error?.raw ?? '');
      assert.ok(
        served.some(
          (request) =>
            request.path === '/slow/big.mp4' &&
            request.range &&
            !request.range.startsWith('bytes=0-'),
        ),
        'the resumed download asked for the rest of the file',
      );
      await manager.shutdown();
    });

    test('cancel stops the process and removes partial files', async () => {
      const { manager, out } = await newManager('cancel');
      const [job] = manager.enqueue([
        { url: `${base}/slow/big.mp4`, quality: 'best' },
      ]);
      await waitFor(manager, job.id, ['downloading']);
      manager.cancel(job.id);
      await waitFor(manager, job.id, ['canceled']);
      assert.ok(!existsSync(path.join(tmp, 'cancel', 'work', 'jobs', job.id)));
      assert.deepEqual(existsSync(out) ? readdirSync(out) : [], []);
      await manager.shutdown();
    });
  },
);

describe(
  'toolkit installer',
  {
    skip: process.platform === 'win32' && 'uses shell scripts as fake binaries',
  },
  () => {
    /** Zips a fake ffmpeg (printing `config`) and ffprobe under a nested
     *  folder, as BtbN lays them out; returns its url and sha256. */
    async function fakeArchive(name: string, config: string) {
      const dir = path.join(tmp, `src-${name}`, 'ffmpeg-fake', 'bin');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'ffmpeg'),
        `#!/bin/sh\necho "configuration: ${config}"\n`,
        { mode: 0o755 },
      );
      await fs.writeFile(
        path.join(dir, 'ffprobe'),
        '#!/bin/sh\necho "ffprobe version 9.9.9 Copyright (c) the FFmpeg developers"\n',
        { mode: 0o755 },
      );
      const zip = path.join(tmp, `${name}.zip`);
      const result = spawnSync('zip', ['-qr', zip, 'ffmpeg-fake'], {
        cwd: path.join(tmp, `src-${name}`),
      });
      assert.equal(result.status, 0, 'the zip command is needed');
      const hash = createHash('sha256')
        .update(await fs.readFile(zip))
        .digest('hex');
      return { url: `${base}/${name}.zip`, sha256: hash };
    }

    /** A Media release from one archive: ffmpeg and ffprobe picked out by
     *  name, and checked to be `variant`. */
    const release = (
      archive: { url: string; sha256: string },
      variant: 'gpl' | 'lgpl' = 'gpl',
      version = '9.9.9',
    ): ToolkitRelease => ({
      version,
      host: 'localhost',
      archives: [
        {
          ...archive,
          size: 1,
          pick: [{ name: 'ffmpeg' }, { name: 'ffprobe' }],
        },
      ],
      binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
      checks: [
        variant === 'gpl'
          ? {
              binary: 'ffmpeg',
              args: ['-buildconf'],
              expect: '--enable-gpl',
              message: 'isn’t the full build',
            }
          : {
              binary: 'ffmpeg',
              args: ['-buildconf'],
              forbid: '--enable-(gpl|nonfree)\\b',
            },
        { binary: 'ffprobe', args: ['-version'], expect: '^ffprobe version' },
      ],
    });

    /** A stand-in for vendor/'s LGPL build, as a development override. */
    const lgplDir = () => path.join(tmp, 'lgpl-bin');
    before(async () => {
      await fs.mkdir(lgplDir(), { recursive: true });
      for (const name of ['ffmpeg', 'ffprobe']) {
        await fs.writeFile(path.join(lgplDir(), name), '#!/bin/sh\n', {
          mode: 0o755,
        });
      }
    });
    const store = (root: string, withVendor = true) =>
      new ToolkitStore(
        root,
        withVendor
          ? {
              media: {
                id: 'media',
                variant: 'lgpl',
                version: 'vendor',
                dir: lgplDir(),
                binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
                size: null,
                source: 'development',
              },
            }
          : {},
      );

    const leftovers = (root: string) => {
      const dir = path.join(root, 'media');
      return existsSync(dir)
        ? readdirSync(dir).filter((name) => name.startsWith('.staging'))
        : [];
    };

    test('installs a build, switches to it, and removes it again', async () => {
      const root = path.join(tmp, 'tk-ok');
      const toolkits = store(root);
      const good = await fakeArchive('good', '--enable-gpl --enable-libx264');
      const installer = new ToolkitInstaller(toolkits);
      const states: string[] = [];
      installer.on('state', (_id, state) => states.push(state.state));

      assert.equal(resolveFfmpeg(toolkits)?.variant, 'lgpl');
      const installed = await installer.install('media', 'gpl', [
        release(good),
      ]);
      assert.equal(installed.version, '9.9.9');
      const resolved = resolveFfmpeg(toolkits);
      assert.equal(resolved?.variant, 'gpl');
      assert.equal(resolved?.version, '9.9.9');
      assert.ok(resolved?.ffmpeg.startsWith(path.join(root, 'media')));
      for (const state of [
        'downloading',
        'verifying',
        'extracting',
        'checking',
      ])
        assert.ok(states.includes(state), state);
      assert.deepEqual(leftovers(root), []);
      assert.ok((installed.size ?? 0) > 0);

      await installer.remove('media');
      assert.equal(resolveFfmpeg(toolkits)?.variant, 'lgpl');
      assert.deepEqual(readdirSync(path.join(root, 'media')), []);
    });

    test('an update replaces the old build', async () => {
      const root = path.join(tmp, 'tk-update');
      const toolkits = store(root, false);
      const installer = new ToolkitInstaller(toolkits);
      const first = await fakeArchive('v1', '--enable-gpl');
      await installer.install('media', 'gpl', [release(first, 'gpl', '1')]);
      const second = await fakeArchive('v2', '--enable-gpl');
      await installer.install('media', 'gpl', [release(second, 'gpl', '2')]);
      assert.equal(toolkits.installed('media')?.version, '2');
      // One build folder, and the pointer.
      assert.equal(readdirSync(path.join(root, 'media')).length, 2);
    });

    test('rejects a download whose checksum doesn’t match', async () => {
      const root = path.join(tmp, 'tk-hash');
      const toolkits = store(root);
      const good = await fakeArchive('hash', '--enable-gpl');
      const installer = new ToolkitInstaller(toolkits);
      await assert.rejects(
        installer.install('media', 'gpl', [
          release({ ...good, sha256: '0'.repeat(64) }),
        ]),
        /checksum/,
      );
      assert.equal(resolveFfmpeg(toolkits)?.variant, 'lgpl');
      assert.equal(installer.state('media').state, 'error');
      assert.deepEqual(leftovers(root), []);
    });

    test('rejects a build its checks refuse', async () => {
      const root = path.join(tmp, 'tk-notgpl');
      const toolkits = store(root);
      const lgpl = await fakeArchive('notgpl', '--enable-version3');
      const installer = new ToolkitInstaller(toolkits);
      await assert.rejects(
        installer.install('media', 'gpl', [release(lgpl)]),
        /isn’t the full/,
      );
      // And the other way round: an "LGPL" release that is GPL.
      const gpl = await fakeArchive('notlgpl', '--enable-gpl');
      await assert.rejects(
        installer.install('media', 'lgpl', [release(gpl, 'lgpl')]),
        /isn’t the expected build/,
      );
      assert.equal(resolveFfmpeg(toolkits)?.variant, 'lgpl');
    });

    test('moves on when a source is gone', async () => {
      const root = path.join(tmp, 'tk-fallback');
      const toolkits = store(root);
      const good = await fakeArchive('fallback', '--enable-gpl');
      const installer = new ToolkitInstaller(toolkits);
      await installer.install('media', 'gpl', [
        release({ url: `${base}/gone.zip`, sha256: good.sha256 }),
        release(good),
      ]);
      assert.equal(resolveFfmpeg(toolkits)?.variant, 'gpl');
    });

    test('cancel leaves nothing behind', async () => {
      const root = path.join(tmp, 'tk-cancel');
      const toolkits = store(root);
      const installer = new ToolkitInstaller(toolkits);
      // The slow route, so there is time to cancel mid-download.
      const running = installer.install('media', 'gpl', [
        release({ url: `${base}/slow/big.mp4`, sha256: '0'.repeat(64) }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      installer.cancel('media');
      await assert.rejects(running, /canceled/);
      assert.equal(installer.state('media').state, 'idle');
      assert.deepEqual(leftovers(root), []);
      assert.equal(resolveFfmpeg(toolkits)?.variant, 'lgpl');
    });

    test('a pointer outside the toolkit’s folder is ignored', async () => {
      const root = path.join(tmp, 'tk-escape');
      await fs.mkdir(path.join(root, 'media'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'media', 'current.json'),
        JSON.stringify({
          variant: 'gpl',
          version: 'x',
          dir: lgplDir(),
          binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
        }),
      );
      assert.equal(resolveFfmpeg(store(root))?.variant, 'lgpl');
      // Nor may a program's path climb out of its folder.
      await fs.mkdir(path.join(root, 'media', 'b'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'media', 'current.json'),
        JSON.stringify({
          variant: 'gpl',
          version: 'x',
          dir: 'b',
          binaries: { ffmpeg: '../../../lgpl-bin/ffmpeg' },
        }),
      );
      assert.equal(store(root, false).installed('media'), null);
    });

    test('a missing toolkit is reported as missing, not as a crash', () => {
      const toolkits = store(path.join(tmp, 'tk-missing'), false);
      assert.equal(resolveFfmpeg(toolkits), null);
      assert.throws(
        () => toolkits.binary('media', 'ffmpeg'),
        (error) =>
          error instanceof ToolkitMissingError && error.toolkit === 'media',
      );
    });

    test('an older GPL install moves into the Media toolkit', async () => {
      const old = path.join(tmp, 'legacy-ffmpeg');
      const build = path.join(old, 'gpl-9.0-1');
      await fs.mkdir(build, { recursive: true });
      for (const name of ['ffmpeg', 'ffprobe']) {
        await fs.writeFile(path.join(build, name), '#!/bin/sh\n', {
          mode: 0o755,
        });
      }
      await fs.writeFile(
        path.join(old, 'current.json'),
        JSON.stringify({ variant: 'gpl', dir: 'gpl-9.0-1', version: '9.0' }),
      );
      const toolkits = store(path.join(tmp, 'tk-legacy'), false);
      migrateLegacyFfmpeg(old, toolkits);
      assert.equal(toolkits.installed('media')?.variant, 'gpl');
      assert.equal(toolkits.installed('media')?.version, '9.0');
      assert.equal(existsSync(old), false);
    });

    test('statuses show what is installed and what is offered', async () => {
      const root = path.join(tmp, 'tk-status');
      const good = await fakeArchive('status', '--enable-gpl');
      const service = new Toolkits({
        store: store(root, false),
        target: 'test-target',
        overlays: [{ media: { gpl: { 'test-target': release(good) } } }],
      });
      const media = () => service.list().find((item) => item.id === 'media')!;
      assert.equal(media().installed, null);
      assert.deepEqual(
        media().offers.map((offer) => offer.id),
        ['gpl'],
      );
      assert.equal(
        service.list().find((item) => item.id === 'pdf')?.planned,
        true,
      );
      assert.throws(() => service.assertInstalled(['media']), /Media toolkit/);
      await service.install('media', 'gpl');
      assert.equal(media().installed?.variant, 'gpl');
      assert.equal(media().updateAvailable, false);
      service.assertInstalled(['media']);
    });
  },
);

describe('storage inventory', () => {
  test('every file in the data folder is accounted for', async () => {
    const root = path.join(tmp, 'inventory');
    const data = path.join(root, 'userData');
    const write = async (relative: string, bytes: number) => {
      const file = path.join(data, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, Buffer.alloc(bytes));
    };
    await write('settings.json', 10);
    await write('sessions.db', 100);
    await write('downloads/jobs.json', 20);
    await write('downloads/probes/a.info.json', 300);
    await write('downloads/jobs/x/video.part', 4000);
    await write('downloads/stray.tmp', 7);
    await write('Cache/data_1', 50);
    await write('mystery/file', 3);
    const saved = path.join(root, 'out', 'clip.mp4');
    await fs.mkdir(path.dirname(saved), { recursive: true });
    await fs.writeFile(saved, Buffer.alloc(500));
    const plist = path.join(root, 'prefs.plist');
    await fs.writeFile(plist, Buffer.alloc(5));

    const cleared: string[] = [];
    const inventory = new StorageInventory({
      userData: data,
      home: root,
      saveFolder: () => path.dirname(saved),
      savedFiles: () => [saved],
      systemFiles: [plist, path.join(root, 'missing.savedState')],
      actions: {
        'saved-files': () => void cleared.push('saved-files'),
        history: () => void cleared.push('history'),
        lookups: () => void cleared.push('lookups'),
      },
    });
    const report = await inventory.report();
    const size = (id: string) =>
      report.items.find((item) => item.id === id)?.size;
    assert.equal(size('saved-files'), 500);
    assert.equal(size('history'), 100);
    assert.equal(size('lookups'), 300);
    assert.equal(size('unfinished-downloads'), 4000);
    assert.equal(size('web-cache'), 50);
    assert.equal(size('system'), 5);
    // Unknown files, at the top or inside a known folder, are listed.
    const other = report.items.find((item) => item.id === 'other');
    assert.equal(other?.size, 10);
    assert.match(other?.description ?? '', /mystery/);
    assert.match(other?.description ?? '', /downloads\/stray\.tmp/);
    // The total is every byte written, nothing counted twice.
    assert.equal(
      report.total,
      10 + 100 + 20 + 300 + 4000 + 7 + 50 + 3 + 500 + 5,
    );
    assert.equal(report.dataFolder, '~/userData');
    // Only items with an action offer a clear.
    assert.ok(report.items.find((item) => item.id === 'history')?.clear);
    assert.equal(
      report.items.find((item) => item.id === 'settings')?.clear,
      null,
    );

    await inventory.eraseAll();
    assert.deepEqual(cleared.sort(), ['history', 'lookups']);
    await assert.rejects(inventory.clear('settings'), /can’t be cleared/);
  });
});

describe(
  'programs found on this computer',
  // The fake programs are shell scripts.
  { skip: process.platform === 'win32' },
  () => {
    /** A folder with a fake `name` that prints `answer` to --version. */
    async function fakeProgram(dir: string, name: string, answer: string) {
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, name);
      await fs.writeFile(file, `#!/bin/sh\necho '${answer}'\n`, {
        mode: 0o755,
      });
      return file;
    }

    const external = (name: string, firstDirs: string[]) =>
      new ExternalTools({
        file: path.join(tmp, name, 'external-tools.json'),
        firstDirs,
      });

    test('a Finder-opened Mac app still looks where Homebrew and pip put programs', () => {
      const dirs = searchDirs(
        'darwin',
        { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        '/Users/someone',
      );
      for (const dir of [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/Users/someone/.local/bin',
      ]) {
        assert.ok(dirs.includes(dir), dir);
      }
      // PATH first, each folder once.
      assert.equal(dirs[0], '/usr/bin');
      assert.equal(new Set(dirs).size, dirs.length);
    });

    test('yt-dlp is found, but Download Video stays off until turned on', async () => {
      const bin = path.join(tmp, 'ext-found', 'bin');
      const ytdlp = await fakeProgram(bin, 'yt-dlp', '2026.10.26');
      const tools = external('ext-found', [bin]);
      const status = await tools.scan();
      assert.deepEqual(status.ytdlp.found, {
        path: ytdlp,
        version: '2026.10.26',
        chosen: false,
      });
      assert.equal(status.ytdlp.enabled, false);
      assert.throws(() => tools.forJob(), ExternalToolError);

      tools.setEnabled('ytdlp', true);
      // It runs with its own folder first on PATH, then the rest of where
      // programs were looked for, as a terminal would have them.
      const job = tools.forJob();
      assert.equal(job.ytdlp, ytdlp);
      assert.equal(job.pathDirs[0], bin);
      assert.ok(job.pathDirs.includes('/usr/bin'));
      // The choice is kept for the next launch.
      const again = external('ext-found', [bin]);
      await again.scan();
      assert.equal(again.status().ytdlp.enabled, true);

      // Once it is gone, nothing runs until it is looked for again; then
      // it reads as off, unless another yt-dlp (this computer's) turns up.
      await fs.rm(ytdlp);
      assert.throws(() => again.forJob(), ExternalToolError);
      const after = await again.scan();
      assert.notEqual(after.ytdlp.found?.path, ytdlp);
      assert.equal(after.ytdlp.enabled, !!after.ytdlp.found);
    });

    test('without a yt-dlp it can’t be turned on, and a wrong file isn’t taken', async () => {
      const bin = path.join(tmp, 'ext-none', 'bin');
      const notYtdlp = await fakeProgram(bin, 'something', 'hello');
      const tools = external('ext-none', [bin]);
      // Only the folder given counts; the computer's own yt-dlp, if any, is
      // not this test's business.
      const status = await tools.scan();
      if (!status.ytdlp.found) {
        assert.throws(() => tools.setEnabled('ytdlp', true));
      }
      await assert.rejects(tools.choose(notYtdlp), /doesn’t look like yt-dlp/);
      assert.equal(tools.status().ytdlp.found?.path === notYtdlp, false);
    });

    test('a yt-dlp the person chose is used before any other', async () => {
      const bin = path.join(tmp, 'ext-chosen', 'bin');
      await fakeProgram(bin, 'yt-dlp', '2026.10.26');
      const mine = await fakeProgram(
        path.join(tmp, 'ext-chosen', 'mine'),
        'my-yt-dlp',
        '2026.11.01',
      );
      const tools = external('ext-chosen', [bin]);
      const status = await tools.choose(mine);
      assert.equal(status.ytdlp.found?.path, mine);
      assert.equal(status.ytdlp.found?.chosen, true);
      const back = await tools.forgetChosen();
      assert.equal(back.ytdlp.found?.path, path.join(bin, 'yt-dlp'));
    });

    test('a yt-dlp’s age comes from its version', () => {
      const now = Date.UTC(2026, 10, 17);
      assert.equal(ytdlpAgeDays('2026.10.26', now), 22);
      assert.equal(ytdlpAgeDays('2026.11.17.233505', now), 0);
      assert.equal(ytdlpAgeDays('nightly', now), null);
    });
  },
);

describe('toolkit feed', () => {
  test('only a feed signed with the publisher’s key is trusted', async () => {
    const { generateKeyPairSync, sign } = await import('node:crypto');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const body = Buffer.from('{"toolkits":{}}');
    const signature = sign(null, body, privateKey).toString('base64');
    assert.equal(verifyFeed(body, signature, [pem]), true);
    assert.equal(
      verifyFeed(Buffer.from('{"toolkits":1}'), signature, [pem]),
      false,
    );
    const other = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString();
    assert.equal(verifyFeed(body, signature, [other]), false);
    assert.equal(verifyFeed(body, signature, []), false);
  });

  test('any listed key is trusted, so the signing key can be rotated', async () => {
    const { generateKeyPairSync, sign } = await import('node:crypto');
    const pemOf = (key: import('node:crypto').KeyObject) =>
      key.export({ type: 'spki', format: 'pem' }).toString();
    const current = generateKeyPairSync('ed25519');
    const next = generateKeyPairSync('ed25519');
    const keys = ['not a key', pemOf(current.publicKey), pemOf(next.publicKey)];
    const body = Buffer.from('{"toolkits":{}}');
    for (const { privateKey } of [current, next]) {
      const signature = sign(null, body, privateKey).toString('base64');
      assert.equal(verifyFeed(body, signature, keys), true);
    }
  });

  test('the keys the app trusts are Ed25519 public keys, never private', async () => {
    const { createPublicKey } = await import('node:crypto');
    assert.ok(feedPublicKeys.length > 0);
    assert.equal(new Set(feedPublicKeys).size, feedPublicKeys.length);
    for (const pem of feedPublicKeys) {
      assert.doesNotMatch(pem, /PRIVATE/);
      assert.equal(createPublicKey(pem).asymmetricKeyType, 'ed25519');
    }
  });

  test('a build without the official flag is labelled and uses no Offlane servers', () => {
    // The tests run outside webpack, like any build without
    // OFFLANE_OFFICIAL_BUILD=1.
    assert.equal(officialBuild, false);
    assert.equal(displayName, `${brand.productName} (unofficial build)`);
    assert.deepEqual(brandServers, {
      updateFeedUrl: null,
      toolkitFeedUrl: null,
    });
    assert.equal(FEED, null);
  });

  test('releases that could escape their folder or use http are left out', () => {
    const good = {
      version: '2',
      host: 'example.com',
      archives: [
        { url: 'https://example.com/a.zip', sha256: 'a'.repeat(64), size: 1 },
      ],
      binaries: { ffmpeg: 'ffmpeg' },
      checks: [{ binary: 'ffmpeg', args: ['-version'] }],
    };
    const overlay = parseFeed({
      toolkits: {
        media: {
          lgpl: {
            'mac-arm64': good,
            'mac-x64': { ...good, binaries: { ffmpeg: '../../bin/sh' } },
            'win-x64': {
              ...good,
              archives: [
                { ...good.archives[0], url: 'http://example.com/a.zip' },
              ],
            },
          },
        },
        nonsense: { x: { y: good } },
      },
    });
    assert.deepEqual(Object.keys(overlay), ['media']);
    assert.deepEqual(Object.keys(overlay.media?.lgpl ?? {}), ['mac-arm64']);
  });
});

describe('tool queue', () => {
  const options = defineOptions({
    format: select('Format', ['MP4', 'MOV']),
    loop: toggle('Loop'),
    quality: quality(),
  });
  const outDir = () => path.join(tmp, 'tool-out');
  const clip = () => path.join(tmp, 'media', 'clip.mp4');
  const queue = (handlers: Record<string, ToolHandler>) =>
    new ToolQueue({
      handlers: new Map(Object.entries(handlers)),
      getFfmpeg: () => resolveFfmpeg(vendorStore(path.join(tmp, 'toolkits'))),
      getOutputDir: outDir,
    });
  /** Resolves once the job has finished, failed or been cancelled. */
  const settled = (tools: ToolQueue, id: string) =>
    new Promise<ReturnType<ToolQueue['list']>[number]>((resolve) => {
      const done = (job: { id: string; status: string }) => {
        if (job.id !== id || ['queued', 'running'].includes(job.status)) return;
        tools.off('job-updated', done);
        resolve(tools.list().find((other) => other.id === id)!);
      };
      tools.on('job-updated', done);
    });

  before(() => fs.mkdir(outDir(), { recursive: true }));

  test('values are checked against the options', async () => {
    let seen: unknown;
    const tools = queue({
      echo: { options, run: async ({ values }) => void (seen = values) },
    });
    const [job] = tools.run('echo', {
      files: [clip()],
      links: [],
      values: { format: 'AVI', loop: 'yes', quality: 55, extra: 1 },
    });
    await settled(tools, job.id);
    assert.deepEqual(seen, { format: 'MP4', loop: false, quality: 55 });
  });

  test('bad inputs start nothing', () => {
    const tools = queue({ echo: { options, run: async () => {} } });
    const run =
      (toolId: string, files: string[], links: string[] = []) =>
      () =>
        tools.run(toolId, { files, links, values: {} });
    assert.throws(run('missing', [clip()]), /isn't connected/);
    assert.throws(run('echo', ['media/clip.mp4']), /Can't read/);
    assert.throws(run('echo', [], ['https://example.com/a.mp4']), /not links/);
    assert.throws(run('echo', []), /Nothing to work on/);
    assert.deepEqual(tools.list(), []);
  });

  test('a tool whose toolkit is missing starts nothing', () => {
    const empty = new ToolkitStore(path.join(tmp, 'queue-toolkits'));
    const tools = new ToolQueue({
      handlers: new Map([['echo', { options, run: async () => {} }]]),
      getFfmpeg: () => resolveFfmpeg(empty),
      requirements: new Map([['echo', ['media']]]),
      assertToolkits: (ids) => {
        const missing = ids.find((id) => !empty.installed(id));
        if (missing) throw new ToolkitMissingError(missing);
      },
      getOutputDir: outDir,
    });
    assert.throws(
      () => tools.run('echo', { files: [clip()], links: [], values: {} }),
      (error) =>
        error instanceof ToolkitMissingError && error.toolkit === 'media',
    );
    assert.deepEqual(tools.list(), []);
  });

  test('a failed or cancelled job leaves no output behind', async () => {
    const tools = queue({
      failing: {
        options,
        run: async (context) => {
          await fs.writeFile(context.outputPath('-failed', 'txt'), 'partial');
          throw new Error('boom');
        },
      },
      slow: {
        options,
        run: async (context) => {
          await fs.writeFile(context.outputPath('-slow', 'txt'), 'partial');
          await new Promise((resolve) =>
            context.signal.addEventListener('abort', resolve),
          );
        },
      },
    });
    const [failing] = tools.run('failing', {
      files: [clip()],
      links: [],
      values: {},
    });
    const failed = await settled(tools, failing.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'boom');

    const [slow] = tools.run('slow', {
      files: [clip()],
      links: [],
      values: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(existsSync(path.join(outDir(), 'clip-slow.txt')));
    tools.cancel(slow.id);
    assert.equal((await settled(tools, slow.id)).status, 'cancelled');
    assert.deepEqual(readdirSync(outDir()), []);
  });

  test(
    'Compress Video writes a smaller H.264 MP4',
    { skip: !hasEngine && 'no vendor binaries' },
    async () => {
      const tools = queue({ 'compress-video': compressVideo });
      const [job] = tools.run('compress-video', {
        files: [clip()],
        links: [],
        values: { quality: 50 },
      });
      const done = await settled(tools, job.id);
      assert.equal(done.status, 'done', done.error ?? '');
      assert.deepEqual(done.outputs, ['clip-compressed.mp4']);
      const output = path.join(outDir(), 'clip-compressed.mp4');
      const probe = spawnSync(path.join(bundledBinDir, 'ffprobe'), [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'csv=p=0',
        output,
      ]);
      assert.equal(probe.stdout.toString().trim(), 'h264');
      assert.ok(statSync(output).size < statSync(clip()).size);
    },
  );
});

describe('sessions', () => {
  test('only a change to its state moves a session in History', async () => {
    const store = new SessionStore(path.join(tmp, 'sessions-order.db'));
    const input = {
      id: 'one',
      toolId: 'download-video',
      title: 'A video',
      summary: '',
      meta: {},
      state: JSON.stringify({ link: 'https://example.com/a' }),
    };
    const first = store.save(input);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Opened again: the page saves what it was opened with, with how its
    // run ended and a new picture.
    const reopened = store.save({
      ...input,
      meta: { thumbnail: 'data:image/jpeg;base64,AA==', jobs: { j: 'done' } },
    });
    assert.equal(reopened.updatedAt, first.updatedAt);
    assert.deepEqual(reopened.meta.jobs, { j: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Worked on: its state changes.
    const changed = store.save({
      ...input,
      state: JSON.stringify({ link: 'https://example.com/b' }),
    });
    assert.ok(changed.updatedAt > first.updatedAt);
    assert.equal(changed.createdAt, first.createdAt);
    store.close();
  });
});
