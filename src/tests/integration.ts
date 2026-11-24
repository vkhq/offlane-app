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
  rmSync,
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
import { Player } from '../main/player';
import { cleanDownloadRequest } from '../main/downloads/requests';
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
import {
  clock,
  defineOptions,
  editorValue,
  file,
  inBar,
  isShown,
  parseClock,
  parseValues,
  quality,
  select,
  shownWhen,
  toggle,
} from '../shared/tools';
import { options as convertAudioOptions } from '../tools/audio/convert-audio/options';
import compressVideo from '../tools/video/compress-video/handler';
import muteVideo from '../tools/video/mute-video/handler';
import trimVideo from '../tools/video/trim-video/handler';
import resizeVideo from '../tools/video/resize-video/handler';
import rotateVideo from '../tools/video/rotate-video/handler';
import changeAspectRatio from '../tools/video/change-aspect-ratio/handler';
import {
  aspectPlan,
  barsOf,
  fitFrame,
  largestPart,
  parseRatio,
} from '../shared/aspectFrame';
import {
  atHeight,
  atWidth,
  fitInside,
  maxSide,
  parseSize,
  withinLimits,
} from '../shared/frameSize';
import { frameAt, waveform } from '../main/media';
import { optionsFor } from '../tools/video/download-video/options';
import { fileKindOf } from '../shared/fileKinds';
import { resolveOutputs } from '../main/tools/outputs';
import { run as runProgram } from '../main/engine/runner';
import { Recordings, recordingName } from '../main/tools/recordings';
import {
  type HandlerContext,
  audioArgs,
  audioFormats,
  h264Args,
  probeMedia,
  timeRange,
  videoArgs,
  videoFormats,
} from '../tools/backend';

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
/** The next request for a file under /refuse/ is refused (HTTP 403), as
 *  YouTube refuses links whose challenge wasn't solved. */
let refuseNext = false;

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
    if (url.pathname.startsWith('/refuse/') && refuseNext) {
      refuseNext = false;
      response.writeHead(403).end();
      return;
    }
    const slow = url.pathname.startsWith('/slow/');
    const refusing = url.pathname.startsWith('/refuse/');
    const file = path.join(
      tmp,
      slow || refusing ? 'media' : '',
      url.pathname.replace(/^\/(slow\/|refuse\/)?/, ''),
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
    assert.ok(optionsFor(found, 'Video').options.subtitleTrack);
    const { options, audio } = optionsFor(found, 'Audio Only');
    assert.equal(audio, true);
    assert.equal(options.quality, undefined);
    assert.equal(options.subtitleTrack, undefined);
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

  test('subtitles offer every language there is, and none by default', () => {
    const none = video({ formats: [stream(720)] });
    assert.equal(optionsFor(none, 'Video').options.subtitleTrack, undefined);
    const found = video({
      formats: [stream(720)],
      subtitles: { fr: [], 'en-GB': [], live_chat: [] },
    });
    const { options, subtitleTracks } = optionsFor(found, 'Video');
    assert.deepEqual(choices(options, 'subtitleTrack'), [
      'None',
      'British English',
      'French',
    ]);
    assert.equal(
      (options.subtitleTrack as unknown as { value: string }).value,
      'None',
    );
    assert.deepEqual(subtitleTracks['French'], {
      code: 'fr',
      auto: false,
    });
    // A lookup from an older build, kept with a tab, lists no languages.
    const { subtitleLanguages: _, ...older } = found;
    assert.equal(
      optionsFor(older as typeof found, 'Video').options.subtitleTrack,
      undefined,
    );
  });

  test('captions made from the speech come after written subtitles', () => {
    const found = video({
      formats: [stream(720)],
      subtitles: { fr: [] },
      // The spoken language, and translations of it, which are left out.
      automatic_captions: { 'en-orig': [], en: [], de: [], fr: [] },
    });
    assert.deepEqual(found.autoCaptionLanguages, ['en-orig']);
    const { options, subtitleTracks } = optionsFor(found, 'Video');
    assert.deepEqual(choices(options, 'subtitleTrack'), [
      'None',
      'French',
      'English (Auto-generated)',
    ]);
    assert.deepEqual(subtitleTracks['English (Auto-generated)'], {
      code: 'en-orig',
      auto: true,
    });
    // Most videos have only these, and still get the choice.
    const spokenOnly = video({
      formats: [stream(720)],
      automatic_captions: { 'en-orig': [], de: [] },
    });
    assert.deepEqual(
      choices(optionsFor(spokenOnly, 'Video').options, 'subtitleTrack'),
      ['None', 'English (Auto-generated)'],
    );
  });

  test('audio languages are offered when there is more than one', () => {
    const dubbed = (language: string, note: string, preference: number) => ({
      ...stream(null, 'none', 'mp4a'),
      format_id: `audio-${language}`,
      language,
      language_preference: preference,
      format_note: note,
    });
    const found = video({
      formats: [
        stream(1080, 'avc1', 'none'),
        dubbed('es-US', 'Spanish (United States)', -1),
        dubbed('en', 'English original', 10),
        dubbed('en', 'English original, low', 10),
      ],
    });
    assert.deepEqual(found.audioLanguages, [
      { code: 'en', original: true },
      { code: 'es-US', original: false },
    ]);
    const { options, audioTracks, originalLanguage } = optionsFor(
      found,
      'Video',
    );
    // The original first, and chosen unless another is.
    assert.deepEqual(choices(options, 'audioTrack'), [
      'English (Original)',
      'Spanish (United States)',
    ]);
    assert.equal(
      (options.audioTrack as unknown as { value: string }).value,
      'English (Original)',
    );
    assert.equal(audioTracks['Spanish (United States)'], 'es-US');
    assert.equal(originalLanguage, 'en');
    // Saving only the audio still picks its language.
    assert.ok(optionsFor(found, 'Audio Only').options.audioTrack);
    // One language, or none named: nothing to choose.
    const single = video({
      formats: [stream(720), dubbed('en', 'English original', 10)],
    });
    assert.equal(optionsFor(single, 'Video').options.audioTrack, undefined);
    assert.equal(
      optionsFor(video({ formats: [stream(720)] }), 'Video').options.audioTrack,
      undefined,
    );
  });

  test('the chosen tracks survive from the page to the download', () => {
    // As the page sends them, through the same check the IPC handler uses.
    const clean = cleanDownloadRequest({
      url: 'https://example.com/v',
      quality: '1080',
      subtitleLanguage: 'en-orig',
      subtitleAuto: true,
      audioLanguage: 'es-US',
      originalLanguage: 'en',
    });
    assert.equal(clean.subtitleLanguage, 'en-orig');
    assert.equal(clean.subtitleAuto, true);
    assert.equal(clean.audioLanguage, 'es-US');
    assert.equal(clean.originalLanguage, 'en');
    // Anything that isn't a language code goes no further.
    const sneaky = cleanDownloadRequest({
      url: 'https://example.com/v',
      quality: '1080',
      subtitleLanguage: 'en.*,--exec=rm',
      audioLanguage: 'en]+ba',
    });
    assert.equal(sneaky.subtitleLanguage, undefined);
    assert.equal(sneaky.audioLanguage, undefined);
  });

  test('the chosen tracks are what yt-dlp is asked for', () => {
    const argsFor = (input: {
      quality?: '1080' | 'audio';
      subtitleLanguage?: string;
      audio?: { language?: string; original?: string };
    }) =>
      buildDownloadArgs({
        bin: { ytdlp: 'yt-dlp', ffmpegDir: null, ffmpeg: null, pathDirs: [] },
        settings: defaultSettings('/out'),
        quality: input.quality ?? '1080',
        subtitles: false,
        subtitleLanguage: input.subtitleLanguage,
        audio: input.audio,
        outputDir: '/out',
        tempDir: '/tmp/job',
        source: { url: 'https://example.com/v' },
      });
    const after = (args: string[], flag: string) =>
      args[args.indexOf(flag) + 1];

    // A dub: it plays first, the original is saved beside it, and either
    // falls back to what there is.
    const dub = argsFor({ audio: { language: 'es-US', original: 'en' } });
    assert.equal(
      after(dub, '-f'),
      'bv*[height<=1080]+ba[language=es-US]+ba[language=en]/' +
        'bv*[height<=1080]+ba[language=es-US]/' +
        'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b',
    );
    assert.ok(dub.includes('--audio-multistreams'));
    // The original chosen: one track, no second.
    const original = argsFor({ audio: { language: 'en', original: 'en' } });
    assert.ok(!original.includes('--audio-multistreams'));
    assert.match(
      after(original, '-f'),
      /^bv\*\[height<=1080\]\+ba\[language=en\]\//,
    );
    // Audio only: just the language chosen.
    assert.equal(
      after(argsFor({ quality: 'audio', audio: { language: 'es-US' } }), '-f'),
      'ba[language=es-US]/ba/b',
    );
    // Nothing chosen: as before.
    assert.equal(
      after(argsFor({}), '-f'),
      'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b',
    );
    assert.ok(!argsFor({}).includes('--write-subs'));
    // One subtitle language, matched exactly.
    const subs = argsFor({ subtitleLanguage: 'pt-BR' });
    assert.ok(subs.includes('--embed-subs'));
    assert.equal(after(subs, '--sub-langs'), '^pt\\-BR$');
    assert.ok(subs.includes('--write-subs'));
    assert.ok(!subs.includes('--write-auto-subs'));
    // The site's own captions are asked for as such.
    const auto = buildDownloadArgs({
      bin: { ytdlp: 'yt-dlp', ffmpegDir: null, ffmpeg: null, pathDirs: [] },
      settings: defaultSettings('/out'),
      quality: '1080',
      subtitles: false,
      subtitleLanguage: 'en-orig',
      subtitleAuto: true,
      outputDir: '/out',
      tempDir: '/tmp/job',
      source: { url: 'https://example.com/v' },
    });
    assert.ok(auto.includes('--write-auto-subs'));
    assert.ok(!auto.includes('--write-subs'));
    assert.equal(after(auto, '--sub-langs'), '^en\\-orig$');
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
        // Allowing for a wrapper such as ordered(dropVideos()).
        const input =
          /input:\s*(?:(?:ordered|withSizes)\()?(drop\w*)\(([^)]*)\)/.exec(
            page,
          );
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

    test('links a site refuses are looked up again, once', async () => {
      const { manager } = await newManager('refused');
      const url = `${base}/refuse/clip.mp4`;
      const info = await manager.probe(url);
      // The preview's saved links are refused when downloaded from...
      refuseNext = true;
      served.length = 0;
      const [job] = manager.enqueue([
        { url, quality: 'best', probeToken: info.probeToken },
      ]);
      // ...so it is looked up again and downloads.
      const done = await waitFor(manager, job.id, ['completed', 'failed']);
      assert.equal(done.status, 'completed', done.error?.raw ?? '');
      assert.equal(done.attempts, 2);
      assert.equal(refuseNext, false, 'the refused request was made');
      await manager.shutdown();
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

  test('an option shown only for some choices', () => {
    const options = defineOptions({
      format: select('Format', ['MP3', 'WAV']),
      bitrate: shownWhen(select('Bitrate', ['320', '128'], '128'), 'format', [
        'MP3',
      ]),
    });
    assert.ok(isShown(options, 'bitrate', { format: 'MP3' }));
    assert.ok(!isShown(options, 'bitrate', { format: 'WAV' }));
    assert.ok(isShown(options, 'format', {}));
    // Shown, the value chosen counts; hidden, the handler gets the default.
    assert.equal(
      parseValues(options, { format: 'MP3', bitrate: '320' }).bitrate,
      '320',
    );
    assert.equal(
      parseValues(options, { format: 'WAV', bitrate: '320' }).bitrate,
      '128',
    );
    // Convert Audio hides Bitrate for the lossless formats.
    for (const [format, shown] of [
      ['MP3', true],
      ['M4A', true],
      ['OGG', true],
      ['WAV', false],
      ['FLAC', false],
    ] as const) {
      assert.equal(
        isShown(convertAudioOptions, 'bitrate', { format }),
        shown,
        format,
      );
    }
  });

  test("an editor's values reach the handler, out of the bar", async () => {
    const options = defineOptions({
      fit: select('Fit', ['Fill', 'Bars']),
      left: editorValue('Left'),
      width: editorValue('Width', 1920, { min: 16, max: 4096 }),
      // Only applies while Fit is Fill.
      x: shownWhen(editorValue('X', 50), 'fit', ['Fill']),
    });
    const values = { fit: 'Fill', left: 0, width: 1920, x: 50 };
    // Never in the bar or the summary, whatever the choices.
    assert.ok(inBar(options, 'fit', values));
    for (const key of ['left', 'width', 'x']) {
      assert.ok(!inBar(options, key, values), key);
    }
    // Kept although not in the bar: rounded to whole pixels, within range.
    assert.deepEqual(
      parseValues(options, { fit: 'Fill', left: 320.4, width: 640, x: 12 }),
      { fit: 'Fill', left: 320, width: 640, x: 12 },
    );
    assert.deepEqual(
      parseValues(options, { left: -5, width: 99999, x: 9000 }),
      { fit: 'Fill', left: 0, width: 4096, x: 8192 },
    );
    // Not a number: its default.
    assert.deepEqual(
      parseValues(options, { left: '320', width: Number.NaN, x: null }),
      { fit: 'Fill', left: 0, width: 1920, x: 50 },
    );
    // Its condition still holds: under Bars, X is its default.
    assert.equal(parseValues(options, { fit: 'Bars', x: 12 }).x, 50);

    // A run hands them to the handler as they were set.
    const seen: unknown[] = [];
    const tools = queue({
      edit: { options, run: async ({ values }) => void seen.push(values) },
    });
    const [job] = tools.run('edit', {
      files: [clip()],
      links: [],
      values: { fit: 'Fill', left: 320, width: 640, x: 12 },
    });
    await settled(tools, job.id);
    assert.deepEqual(seen, [{ fit: 'Fill', left: 320, width: 640, x: 12 }]);
  });

  test('a file option reaches the handler as a checked path', async () => {
    const options = defineOptions({
      mode: select('Mode', ['With File', 'Without']),
      audio: shownWhen(file('Audio', 'audio/*'), 'mode', ['With File']),
    });
    const seen: unknown[] = [];
    const tools = queue({
      attach: {
        options,
        run: async ({ values }) => void seen.push(values.audio),
      },
    });
    const audio = path.join(tmp, 'media', 'clip.mp4');
    const run = async (
      values: Record<string, unknown>,
      attachments?: Record<string, string>,
    ) => {
      const [job] = tools.run('attach', {
        files: [clip()],
        links: [],
        values,
        attachments,
      });
      return settled(tools, job.id);
    };
    // The path sent with it, not the name the page shows.
    await run({ mode: 'With File', audio: 'clip.mp4' }, { audio });
    // Nothing sent: empty, whatever the page put in the values.
    await run({ mode: 'With File', audio: '/etc/passwd' });
    // A hidden file option is empty even if a file came with it.
    await run({ mode: 'Without' }, { audio });
    assert.deepEqual(seen, [audio, '', '']);
    // A file that isn't there starts nothing.
    assert.throws(
      () =>
        tools.run('attach', {
          files: [clip()],
          links: [],
          values: { mode: 'With File' },
          attachments: { audio: path.join(tmp, 'missing.mp3') },
        }),
      /Can't read missing\.mp3/,
    );
  });

  test('a tool that combines its inputs gets them in one job, in order', async () => {
    const seen: string[][] = [];
    const tools = queue({
      join: {
        options: {},
        combines: true,
        run: async ({ input, inputs, outputPath }) => {
          seen.push(inputs);
          assert.equal(input, inputs[0]);
          await fs.writeFile(outputPath('-joined', 'txt'), inputs.join('\n'));
        },
      },
      each: { options: {}, run: async ({ inputs }) => void seen.push(inputs) },
    });
    const second = path.join(tmp, 'media', 'big.mp4');
    const jobs = tools.run('join', {
      files: [second, clip()],
      links: [],
      values: {},
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].input, 'big.mp4 and 1 more');
    assert.equal(
      jobs[0].inputSize,
      statSync(second).size + statSync(clip()).size,
    );
    const done = await settled(tools, jobs[0].id);
    assert.equal(done.status, 'done', done.error ?? '');
    // Named after the first input.
    assert.deepEqual(done.outputs, ['big-joined.txt']);
    assert.deepEqual(seen, [[second, clip()]]);
    // The other tests here expect the output folder as they left it.
    rmSync(path.join(outDir(), 'big-joined.txt'));
    // Any other tool: one job per input, each with its own.
    seen.length = 0;
    const each = tools.run('each', {
      files: [second, clip()],
      links: [],
      values: {},
    });
    assert.equal(each.length, 2);
    await Promise.all(each.map((job) => settled(tools, job.id)));
    assert.deepEqual(
      seen.sort((a, b) => a[0].localeCompare(b[0])),
      [[second], [clip()]],
    );
  });

  test('finished runs are still listed after a restart', async () => {
    const file = path.join(tmp, 'tool-runs', 'jobs.json');
    const handlers = {
      make: {
        options,
        run: async (context: {
          outputPath: (s: string, e: string) => string;
        }) => {
          await fs.writeFile(context.outputPath('-made', 'txt'), 'made');
        },
      },
      failing: {
        options,
        run: async () => {
          throw new Error('boom');
        },
      },
    } as unknown as Record<string, ToolHandler>;
    const open = () =>
      new ToolQueue({
        handlers: new Map(Object.entries(handlers)),
        getFfmpeg: () => null,
        getOutputDir: outDir,
        file,
      });

    const first = open();
    const [made] = first.run('make', {
      files: [clip()],
      links: [],
      values: {},
    });
    const [failed] = first.run('failing', {
      files: [clip()],
      links: [],
      values: {},
    });
    // Both waited on before either can finish unheard.
    const [madeDone, failedDone] = await Promise.all([
      settled(first, made.id),
      settled(first, failed.id),
    ]);
    assert.equal(madeDone.status, 'done', madeDone.error ?? '');
    assert.equal(failedDone.status, 'failed');

    // As after the app restarts: the same runs, with their outputs.
    const second = open();
    const listed = second.list();
    assert.deepEqual(
      listed.map((job) => [job.id, job.status]).sort(),
      [
        [made.id, 'done'],
        [failed.id, 'failed'],
      ].sort(),
    );
    const output = path.join(outDir(), 'clip-made.txt');
    assert.deepEqual(second.outputsOf(made.id), [output]);
    // What it was made from, for its card's picture.
    assert.equal(second.inputOf(output), clip());
    assert.equal(second.inputOf(path.join(outDir(), 'unknown.txt')), undefined);

    // A finished run whose file has gone is no longer listed.
    rmSync(output);
    assert.deepEqual(
      open()
        .list()
        .map((job) => job.id),
      [failed.id],
    );
    // Cleared, nothing is listed after the next restart either.
    open().clearFinished();
    assert.deepEqual(open().list(), []);
  });

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

  test(
    'Mute Video drops the sound, and the subtitles only if asked',
    { skip: !hasEngine && 'no vendor binaries' },
    async () => {
      const dir = path.join(tmp, 'mute');
      await fs.mkdir(dir, { recursive: true });
      const loud = path.join(dir, 'loud.mov');
      const silent = path.join(dir, 'silent.mp4');
      const srt = path.join(dir, 'captions.srt');
      await fs.writeFile(srt, '1\n00:00:00,000 --> 00:00:02,000\nHello\n');
      // Video, sound and a subtitle track.
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=4:size=320x240:rate=25',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=4',
        '-i',
        srt,
        '-map',
        '0',
        '-map',
        '1',
        '-map',
        '2',
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        '-c:s',
        'mov_text',
        '-shortest',
        loud,
      ]);
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=4:size=320x240:rate=25',
        '-c:v',
        'mpeg4',
        silent,
      ]);
      /** Each stream as `codec_type,codec_name`, and the length. */
      const streamsOf = (file: string) => {
        const lines = spawnSync(vendorFfprobe, [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name:format=duration',
          '-of',
          'csv=p=0',
          file,
        ])
          .stdout.toString()
          .trim()
          .split('\n');
        return {
          streams: lines.slice(0, -1).map((line) => line.trim()),
          duration: Number(lines.at(-1)),
        };
      };

      const tools = queue({ 'mute-video': muteVideo });
      const jobs = tools.run('mute-video', {
        files: [loud, silent],
        links: [],
        values: {},
      });
      const [fromLoud, fromSilent] = await Promise.all(
        jobs.map((job) => settled(tools, job.id)),
      );

      // The same kind of file, with the video and the subtitles: by
      // default only the sound goes.
      assert.equal(fromLoud.status, 'done', fromLoud.error ?? '');
      assert.deepEqual(fromLoud.outputs, ['loud-muted.mov']);
      assert.equal(fromLoud.note, undefined);
      const muted = streamsOf(path.join(outDir(), 'loud-muted.mov'));
      assert.deepEqual(muted.streams, ['mpeg4,video', 'mov_text,subtitle']);
      assert.ok(
        Math.abs(muted.duration - streamsOf(loud).duration) < 0.1,
        String(muted.duration),
      );

      // Nothing to take out still succeeds, and says so.
      assert.equal(fromSilent.status, 'done', fromSilent.error ?? '');
      assert.deepEqual(fromSilent.outputs, ['silent-muted.mp4']);
      assert.equal(fromSilent.note, 'This video had no sound.');
      assert.deepEqual(
        streamsOf(path.join(outDir(), 'silent-muted.mp4')).streams,
        ['mpeg4,video'],
      );

      // With Remove Subtitles, only the video is left.
      const [bare] = tools.run('mute-video', {
        files: [loud],
        links: [],
        values: { removeSubtitles: true },
      });
      const fromBare = await settled(tools, bare.id);
      assert.equal(fromBare.status, 'done', fromBare.error ?? '');
      assert.deepEqual(fromBare.outputs, ['loud-muted (2).mov']);
      assert.deepEqual(
        streamsOf(path.join(outDir(), 'loud-muted (2).mov')).streams,
        ['mpeg4,video'],
      );

      // The other tests here expect the output folder as they left it.
      for (const name of [
        ...fromLoud.outputs,
        ...fromSilent.outputs,
        ...fromBare.outputs,
      ]) {
        rmSync(path.join(outDir(), name));
      }
    },
  );

  test(
    'Trim Video keeps the part asked for, cut on the frame',
    { skip: !hasEngine && 'no vendor binaries' },
    async () => {
      const dir = path.join(tmp, 'trim');
      await fs.mkdir(dir, { recursive: true });
      const clip = path.join(dir, 'talk.mov');
      // Four seconds of video and sound.
      ffmpegOk([
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
        '-c:a',
        'aac',
        '-shortest',
        clip,
      ]);
      /** Each stream's `codec_name,codec_type`, and the length. */
      const streamsOf = (file: string) => {
        const lines = spawnSync(vendorFfprobe, [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name:format=duration',
          '-of',
          'csv=p=0',
          file,
        ])
          .stdout.toString()
          .trim()
          .split('\n');
        return {
          streams: lines.slice(0, -1).map((line) => line.trim()),
          duration: Number(lines.at(-1)),
        };
      };
      const tools = queue({ 'trim-video': trimVideo });
      const trim = async (values: { start: number; end: number }) => {
        const [job] = tools.run('trim-video', {
          files: [clip],
          links: [],
          values,
        });
        return settled(tools, job.id);
      };

      // 1 s to 2.5 s: an MP4 of H.264 and AAC, 1.5 s long.
      const middle = await trim({ start: 1, end: 2.5 });
      assert.equal(middle.status, 'done', middle.error ?? '');
      assert.deepEqual(middle.outputs, ['talk-trimmed.mp4']);
      assert.equal(middle.note, undefined);
      const cut = streamsOf(path.join(outDir(), 'talk-trimmed.mp4'));
      assert.deepEqual(cut.streams, ['h264,video', 'aac,audio']);
      assert.ok(Math.abs(cut.duration - 1.5) < 0.1, String(cut.duration));

      // An End past the video's end keeps the rest, and says so.
      const rest = await trim({ start: 3, end: 30 });
      assert.equal(rest.status, 'done', rest.error ?? '');
      assert.match(rest.note ?? '', /past the end of the video/);
      const tail = streamsOf(path.join(outDir(), rest.outputs[0]));
      assert.ok(Math.abs(tail.duration - 1) < 0.1, String(tail.duration));

      // A Start past the end, or an End before Start, fails with why.
      const late = await trim({ start: 9, end: 12 });
      assert.equal(late.status, 'failed');
      assert.match(late.error ?? '', /Start is after the end of the file/);
      const backwards = await trim({ start: 2, end: 1 });
      assert.equal(backwards.status, 'failed');
      assert.match(backwards.error ?? '', /End must be after Start/);

      // The other tests here expect the output folder as they left it.
      for (const name of [...middle.outputs, ...rest.outputs]) {
        rmSync(path.join(outDir(), name));
      }
    },
  );

  test('Resize Video fits a video inside a size, keeping its shape', () => {
    assert.deepEqual(parseSize('1920 × 1080'), { width: 1920, height: 1080 });
    assert.deepEqual(parseSize('640x360'), { width: 640, height: 360 });
    assert.equal(parseSize('Custom'), null);
    assert.equal(parseSize('0 × 10'), null);
    const fit = (w: number, h: number, box: string) =>
      fitInside({ width: w, height: h }, parseSize(box)!);
    // The same shape: exactly the preset, either way.
    assert.deepEqual(fit(1920, 1080, '1280 × 720'), {
      width: 1280,
      height: 720,
    });
    assert.deepEqual(fit(1280, 720, '3840 × 2160'), {
      width: 3840,
      height: 2160,
    });
    // Portrait and 4:3 fit by their height; nothing is ever odd.
    assert.deepEqual(fit(1080, 1920, '1920 × 1080'), {
      width: 608,
      height: 1080,
    });
    assert.deepEqual(fit(1440, 1080, '1920 × 1080'), {
      width: 1440,
      height: 1080,
    });
    assert.deepEqual(fit(1080, 1920, '854 × 480'), { width: 270, height: 480 });
    // One side typed, the other follows in the video's shape.
    const phone = { width: 1080, height: 1920 };
    assert.deepEqual(atWidth(phone, 720), { width: 720, height: 1280 });
    assert.deepEqual(atHeight(phone, 1001), { width: 564, height: 1002 });
    // Kept within what H.264 takes, still in shape.
    assert.deepEqual(withinLimits(phone, { width: 3000, height: 5334 }), {
      width: 2304,
      height: maxSide,
    });
    assert.deepEqual(
      withinLimits({ width: 1920, height: 1080 }, { width: 8, height: 4 }),
      { width: 28, height: 16 },
    );
  });

  test(
    'Resize Video scales to the size shown, upright and in shape',
    { skip: !hasEngine && 'no vendor binaries' },
    async () => {
      const dir = path.join(tmp, 'resize');
      await fs.mkdir(dir, { recursive: true });
      /** A two-second test clip, with sound unless `silent`. */
      const make = (name: string, size: string, silent = false) => {
        const file = path.join(dir, name);
        ffmpegOk([
          '-f',
          'lavfi',
          '-i',
          `testsrc=duration=2:size=${size}:rate=25`,
          ...(silent
            ? []
            : ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2']),
          '-c:v',
          'mpeg4',
          ...(silent ? [] : ['-c:a', 'aac', '-shortest']),
          file,
        ]);
        return file;
      };
      const wide = make('wide.mp4', '1280x720');
      const tall = make('tall.mp4', '720x1280');
      const quiet = make('quiet.mp4', '640x480', true);
      // Stored 1280×720 with a phone's 90° tag: seen as 720×1280.
      const turned = path.join(dir, 'turned.mp4');
      ffmpegOk(['-display_rotation', '90', '-i', wide, '-c', 'copy', turned]);
      const sound = path.join(dir, 'sound.m4a');
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:a',
        'aac',
        sound,
      ]);

      /** The output's video size and rotation tag, and its streams. */
      const shapeOf = (file: string) => {
        const probed = JSON.parse(
          spawnSync(vendorFfprobe, [
            '-v',
            'error',
            '-show_entries',
            'stream=codec_type,codec_name,width,height:stream_side_data=rotation',
            '-of',
            'json',
            file,
          ]).stdout.toString(),
        ) as {
          streams: {
            codec_type: string;
            codec_name: string;
            width?: number;
            height?: number;
            side_data_list?: { rotation?: number }[];
          }[];
        };
        const video = probed.streams.find((s) => s.codec_type === 'video');
        return {
          size: video ? `${video.width}x${video.height}` : null,
          rotation: video?.side_data_list?.[0]?.rotation ?? 0,
          streams: probed.streams.map((s) => `${s.codec_name},${s.codec_type}`),
        };
      };
      const tools = queue({ 'resize-video': resizeVideo });
      const made: string[] = [];
      const resize = async (
        file: string,
        values: { size: string; width?: number; height?: number },
      ) => {
        const [job] = tools.run('resize-video', {
          files: [file],
          links: [],
          values,
        });
        const done = await settled(tools, job.id);
        made.push(...done.outputs);
        return done;
      };

      // Down to a preset of the same shape: exactly it, H.264 and AAC.
      const down = await resize(wide, { size: '640 × 360' });
      assert.equal(down.status, 'done', down.error ?? '');
      assert.deepEqual(down.outputs, ['wide-resized.mp4']);
      assert.equal(down.note, undefined);
      const small = shapeOf(path.join(outDir(), 'wide-resized.mp4'));
      assert.equal(small.size, '640x360');
      assert.deepEqual(small.streams, ['h264,video', 'aac,audio']);

      // Portrait inside a landscape preset: fitted by its height.
      const tallDone = await resize(tall, { size: '854 × 480' });
      assert.equal(tallDone.status, 'done', tallDone.error ?? '');
      assert.equal(
        shapeOf(path.join(outDir(), tallDone.outputs[0])).size,
        '270x480',
      );

      // A phone's sideways video comes out upright, with no tag left.
      const upright = await resize(turned, { size: '640 × 360' });
      assert.equal(upright.status, 'done', upright.error ?? '');
      const uprightShape = shapeOf(path.join(outDir(), upright.outputs[0]));
      assert.equal(uprightShape.size, '202x360');
      assert.equal(uprightShape.rotation, 0);

      // Custom, bigger than the video: upscaled, and said so.
      const up = await resize(quiet, {
        size: 'Custom',
        width: 960,
        height: 720,
      });
      assert.equal(up.status, 'done', up.error ?? '');
      assert.match(up.note ?? '', /Upscaled from 640 × 480/);
      const big = shapeOf(path.join(outDir(), up.outputs[0]));
      assert.equal(big.size, '960x720');
      // No sound in, none out.
      assert.deepEqual(big.streams, ['h264,video']);

      // Already that size: kept, and said so.
      const same = await resize(wide, {
        size: 'Custom',
        width: 1280,
        height: 720,
      });
      assert.equal(same.status, 'done', same.error ?? '');
      assert.match(same.note ?? '', /already 1280 × 720/);

      // Sizes it can't make, and a file with no video, fail with why.
      const tiny = await resize(wide, { size: 'Custom', width: 8, height: 4 });
      assert.equal(tiny.status, 'failed');
      assert.match(tiny.error ?? '', /at least 16 px/);
      const huge = await resize(wide, {
        size: 'Custom',
        width: 8000,
        height: 4500,
      });
      assert.equal(huge.status, 'failed');
      assert.match(huge.error ?? '', /at most 4096 px/);
      const noVideo = await resize(sound, { size: '640 × 360' });
      assert.equal(noVideo.status, 'failed');
      assert.match(noVideo.error ?? '', /no video to resize/);

      // The other tests here expect the output folder as they left it.
      for (const name of made) rmSync(path.join(outDir(), name));
    },
  );

  test(
    'Rotate Video turns and flips the picture as it is seen',
    { skip: !hasEngine && 'no vendor binaries' },
    async () => {
      const dir = path.join(tmp, 'rotate');
      await fs.mkdir(dir, { recursive: true });
      // 64×32, blue with its top-left quarter red, so where the red goes
      // shows which way it was turned.
      const marked = path.join(dir, 'marked.mp4');
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=64x32:d=1:r=25,drawbox=x=0:y=0:w=32:h=16:c=red:t=fill',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:v',
        'mpeg4',
        '-q:v',
        '2',
        '-c:a',
        'aac',
        '-shortest',
        marked,
      ]);
      // The same, stored with a phone's 90° tag: seen as 32×64.
      const turned = path.join(dir, 'turned.mp4');
      ffmpegOk(['-display_rotation', '90', '-i', marked, '-c', 'copy', turned]);
      const sound = path.join(dir, 'sound.m4a');
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:a',
        'aac',
        sound,
      ]);

      /** The output's size, rotation tag, streams, and which corner is red
       *  (its first frame, as it is seen). */
      const look = (file: string) => {
        const probed = JSON.parse(
          spawnSync(vendorFfprobe, [
            '-v',
            'error',
            '-show_entries',
            'stream=codec_type,codec_name,width,height:stream_side_data=rotation',
            '-of',
            'json',
            file,
          ]).stdout.toString(),
        ) as {
          streams: {
            codec_type: string;
            codec_name: string;
            width?: number;
            height?: number;
            side_data_list?: { rotation?: number }[];
          }[];
        };
        const video = probed.streams.find((s) => s.codec_type === 'video');
        const pixels = ffmpegOk([
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          // In RGB first: shrunk in 4:2:0, the colours bleed together.
          'format=rgb24,scale=2:2:flags=area',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          'pipe:1',
        ]);
        const corners = [
          'top left',
          'top right',
          'bottom left',
          'bottom right',
        ];
        const red = corners.filter((_, i) => pixels[i * 3] > pixels[i * 3 + 2]);
        return {
          size: video ? `${video.width}x${video.height}` : null,
          rotation: video?.side_data_list?.[0]?.rotation ?? 0,
          streams: probed.streams.map((s) => `${s.codec_name},${s.codec_type}`),
          red: red.join(', '),
        };
      };

      const tools = queue({ 'rotate-video': rotateVideo });
      const made: string[] = [];
      const rotate = async (
        file: string,
        values: { rotate: string; flipHorizontally: boolean },
      ) => {
        const [job] = tools.run('rotate-video', {
          files: [file],
          links: [],
          values,
        });
        const done = await settled(tools, job.id);
        made.push(...done.outputs);
        return {
          ...done,
          look: done.outputs[0]
            ? look(path.join(outDir(), done.outputs[0]))
            : null,
        };
      };

      assert.equal(look(marked).red, 'top left');

      // 90° Right: the top left goes to the top right; H.264 and AAC.
      const right = await rotate(marked, {
        rotate: '90° Right',
        flipHorizontally: false,
      });
      assert.equal(right.status, 'done', right.error ?? '');
      assert.deepEqual(right.outputs, ['marked-rotated.mp4']);
      assert.deepEqual(right.look, {
        size: '32x64',
        rotation: 0,
        streams: ['h264,video', 'aac,audio'],
        red: 'top right',
      });

      const cases: [string, boolean, string, string][] = [
        ['90° Left', false, '32x64', 'bottom left'],
        ['180°', false, '64x32', 'bottom right'],
        ['None', true, '64x32', 'top right'],
        // Turned right, then mirrored: back to the left.
        ['90° Right', true, '32x64', 'top left'],
      ];
      for (const [turn, flip, size, red] of cases) {
        const done = await rotate(marked, {
          rotate: turn,
          flipHorizontally: flip,
        });
        assert.equal(done.status, 'done', done.error ?? '');
        assert.equal(done.look?.size, size, `${turn}, flip ${flip}`);
        assert.equal(done.look?.red, red, `${turn}, flip ${flip}`);
      }

      // A phone's sideways video is turned from how it plays (its 90° tag
      // turns it left, so red at the bottom left), and comes out with no
      // tag for a player to ignore.
      assert.equal(look(turned).red, 'bottom left');
      const upright = await rotate(turned, {
        rotate: '90° Right',
        flipHorizontally: false,
      });
      assert.equal(upright.status, 'done', upright.error ?? '');
      assert.equal(upright.look?.size, '64x32');
      assert.equal(upright.look?.rotation, 0);
      assert.equal(upright.look?.red, 'top left');

      // Nothing to do, or no video, fails with why.
      const nothing = await rotate(marked, {
        rotate: 'None',
        flipHorizontally: false,
      });
      assert.equal(nothing.status, 'failed');
      assert.match(nothing.error ?? '', /Nothing to change/);
      const noVideo = await rotate(sound, {
        rotate: '90° Right',
        flipHorizontally: false,
      });
      assert.equal(noVideo.status, 'failed');
      assert.match(noVideo.error ?? '', /no video to rotate/);

      for (const name of made) rmSync(path.join(outDir(), name));
    },
  );

  test('Change Aspect Ratio works out the new shape', () => {
    const wide = { width: 1920, height: 1080 };
    const tall = { width: 1080, height: 1920 };
    assert.deepEqual(parseRatio('9:16 Vertical'), { width: 9, height: 16 });
    assert.equal(parseRatio('Custom'), null);
    // Fit: the shape at the video's long side, the video scaled into it.
    assert.deepEqual(fitFrame(wide, { width: 9, height: 16 }), tall);
    assert.deepEqual(fitFrame(tall, { width: 1, height: 1 }), {
      width: 1920,
      height: 1920,
    });
    const bars = aspectPlan(wide, { width: 9, height: 16 }, 'Fit with Bars');
    assert.deepEqual(bars.output, tall);
    assert.deepEqual(bars.picture, { width: 1080, height: 608, x: 0, y: 656 });
    assert.equal(barsOf(bars), 'bars above and below');
    assert.equal(bars.upscale, false);
    // Past 4096 comes down to it.
    assert.deepEqual(
      aspectPlan(
        { width: 7680, height: 4320 },
        { width: 16, height: 9 },
        'Fit with Bars',
      ).output,
      { width: 4096, height: 2304 },
    );
    // Fill: the largest part of the shape, unscaled, centred by default.
    assert.deepEqual(largestPart(wide, { width: 9, height: 16 }), {
      width: 608,
      height: 1080,
    });
    assert.deepEqual(largestPart(wide, { width: 4, height: 5 }), {
      width: 864,
      height: 1080,
    });
    const fill = aspectPlan(wide, { width: 9, height: 16 }, 'Fill and Crop');
    assert.deepEqual(fill.output, { width: 608, height: 1080 });
    assert.deepEqual(fill.part, { width: 608, height: 1080, x: 656, y: 0 });
    assert.equal(fill.upscale, false);
    // Where it was put, on even pixels, kept inside the picture.
    const at = (x: number, y: number) =>
      aspectPlan(tall, { width: 1, height: 1 }, 'Fill and Crop', { x, y }).part;
    assert.deepEqual(at(-1, -1), { width: 1080, height: 1080, x: 0, y: 420 });
    assert.deepEqual(at(0, 101), { width: 1080, height: 1080, x: 0, y: 100 });
    assert.deepEqual(at(500, 5000), {
      width: 1080,
      height: 1080,
      x: 0,
      y: 840,
    });
    // Custom: exactly the size typed, the video scaled to it.
    const custom = aspectPlan(
      wide,
      { width: 1080, height: 1920 },
      'Fill and Crop',
      {
        size: { width: 1080, height: 1920 },
      },
    );
    assert.deepEqual(custom.output, tall);
    assert.equal(custom.upscale, true);
    // Already that shape.
    assert.equal(
      aspectPlan(wide, { width: 16, height: 9 }, 'Fit with Bars').same,
      true,
    );
    assert.equal(
      barsOf(aspectPlan(wide, { width: 16, height: 9 }, 'Fit with Bars')),
      'no bars',
    );
  });

  test(
    'Change Aspect Ratio reshapes a video with bars or a crop',
    { skip: !hasEngine && 'no vendor binaries' },
    async () => {
      const dir = path.join(tmp, 'aspect');
      await fs.mkdir(dir, { recursive: true });
      // 1280×720, green with a red left edge and a blue right edge, so
      // what is kept shows where a crop was.
      const edged = (name: string, size: string, silent = false) => {
        const [w] = size.split('x').map(Number);
        const file = path.join(dir, name);
        ffmpegOk([
          '-f',
          'lavfi',
          '-i',
          `color=c=green:s=${size}:d=1:r=25,drawbox=x=0:y=0:w=${w / 8}:h=ih:c=red:t=fill,drawbox=x=${w - w / 8}:y=0:w=${w / 8}:h=ih:c=blue:t=fill`,
          ...(silent
            ? []
            : ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1']),
          '-c:v',
          'mpeg4',
          '-q:v',
          '2',
          ...(silent ? [] : ['-c:a', 'aac', '-shortest']),
          file,
        ]);
        return file;
      };
      const wide = edged('wide.mp4', '1280x720');
      const tall = edged('tall.mp4', '720x1280', true);
      const turned = path.join(dir, 'turned.mp4');
      ffmpegOk(['-display_rotation', '90', '-i', wide, '-c', 'copy', turned]);
      const sound = path.join(dir, 'sound.m4a');
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:a',
        'aac',
        sound,
      ]);

      /** Its size, rotation tag and streams, and the colour of its first
       *  frame in a `grid` (columns x rows), left to right, top down. */
      const look = (file: string, grid = '3x1') => {
        const probed = JSON.parse(
          spawnSync(vendorFfprobe, [
            '-v',
            'error',
            '-show_entries',
            'stream=codec_type,codec_name,width,height:stream_side_data=rotation',
            '-of',
            'json',
            file,
          ]).stdout.toString(),
        ) as {
          streams: {
            codec_type: string;
            codec_name: string;
            width?: number;
            height?: number;
            side_data_list?: { rotation?: number }[];
          }[];
        };
        const video = probed.streams.find((s) => s.codec_type === 'video');
        const pixels = ffmpegOk([
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          `format=rgb24,scale=${grid.replace('x', ':')}:flags=area`,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          'pipe:1',
        ]);
        const colours: string[] = [];
        for (let i = 0; i < pixels.length; i += 3) {
          const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
          colours.push(
            Math.max(r, g, b) < 40
              ? 'black'
              : r > g && r > b
                ? 'red'
                : b > g
                  ? 'blue'
                  : 'green',
          );
        }
        return {
          size: video ? `${video.width}x${video.height}` : null,
          rotation: video?.side_data_list?.[0]?.rotation ?? 0,
          streams: probed.streams.map((s) => `${s.codec_name},${s.codec_type}`),
          colours: colours.join(' '),
        };
      };

      const tools = queue({ 'change-aspect-ratio': changeAspectRatio });
      const made: string[] = [];
      const reshape = async (file: string, values: Record<string, unknown>) => {
        const [job] = tools.run('change-aspect-ratio', {
          files: [file],
          links: [],
          values,
        });
        const done = await settled(tools, job.id);
        made.push(...done.outputs);
        return done;
      };
      const output = (done: { outputs: string[] }, grid?: string) =>
        look(path.join(outDir(), done.outputs[0]), grid);

      assert.equal(look(wide).colours, 'red green blue');

      // Fit at 9:16: the long side kept, bars above and below.
      const bars = await reshape(wide, {
        aspect: '9:16 Vertical',
        fit: 'Fit with Bars',
      });
      assert.equal(bars.status, 'done', bars.error ?? '');
      assert.deepEqual(bars.outputs, ['wide-9x16.mp4']);
      assert.equal(bars.note, undefined);
      assert.deepEqual(output(bars, '1x3'), {
        size: '720x1280',
        rotation: 0,
        streams: ['h264,video', 'aac,audio'],
        colours: 'black green black',
      });

      // Portrait at 16:9: bars at the sides; no sound in, none out.
      const sides = await reshape(tall, {
        aspect: '16:9 Landscape',
        fit: 'Fit with Bars',
      });
      assert.equal(sides.status, 'done', sides.error ?? '');
      const sidesLook = output(sides, '5x1');
      assert.equal(sidesLook.size, '1280x720');
      assert.deepEqual(sidesLook.streams, ['h264,video']);
      assert.equal(sidesLook.colours.split(' ')[0], 'black');
      assert.equal(sidesLook.colours.split(' ')[4], 'black');

      // Fill at 9:16: 406×720, unscaled, from the middle by default…
      const middle = await reshape(wide, {
        aspect: '9:16 Vertical',
        fit: 'Fill and Crop',
      });
      assert.equal(middle.status, 'done', middle.error ?? '');
      assert.equal(middle.note, undefined);
      assert.deepEqual(output(middle), {
        size: '406x720',
        rotation: 0,
        streams: ['h264,video', 'aac,audio'],
        colours: 'green green green',
      });
      // …from where it was put, or kept inside the picture if past it.
      const left = await reshape(wide, {
        aspect: '9:16 Vertical',
        fit: 'Fill and Crop',
        cropX: 0,
        cropY: 0,
      });
      assert.equal(output(left).colours.split(' ')[0], 'red');
      const right = await reshape(wide, {
        aspect: '9:16 Vertical',
        fit: 'Fill and Crop',
        cropX: 5000,
        cropY: 0,
      });
      assert.equal(output(right).size, '406x720');
      assert.equal(output(right).colours.split(' ')[2], 'blue');
      // Under Fit a position is ignored.
      const fitted = await reshape(wide, {
        aspect: '1:1 Square',
        fit: 'Fit with Bars',
        cropX: 0,
      });
      assert.equal(output(fitted, '1x3').colours, 'black green black');
      assert.equal(output(fitted).size, '1280x1280');

      // Custom, exactly the size typed: upscaled under Fill, and said so.
      const big = await reshape(wide, {
        aspect: 'Custom',
        width: 1080,
        height: 1920,
        fit: 'Fill and Crop',
      });
      assert.equal(big.status, 'done', big.error ?? '');
      assert.deepEqual(big.outputs, ['wide-1080x1920.mp4']);
      assert.match(big.note ?? '', /Upscaled from 406 × 720/);
      assert.equal(output(big).size, '1080x1920');

      // Already that shape: kept, and said so.
      const same = await reshape(wide, {
        aspect: '16:9 Landscape',
        fit: 'Fit with Bars',
      });
      assert.match(same.note ?? '', /already 16:9/);
      assert.equal(output(same).size, '1280x720');

      // A phone's sideways video is reshaped as it plays, with no tag.
      const upright = await reshape(turned, {
        aspect: '9:16 Vertical',
        fit: 'Fit with Bars',
      });
      assert.equal(upright.status, 'done', upright.error ?? '');
      assert.match(upright.note ?? '', /already 9:16/);
      assert.equal(output(upright).size, '720x1280');
      assert.equal(output(upright).rotation, 0);

      // None, the default, until a shape is chosen: nothing to make.
      const none = await reshape(wide, {});
      assert.equal(none.status, 'failed');
      assert.match(none.error ?? '', /Choose an aspect ratio first/);

      // Sizes it can't make, and a file with no video, fail with why.
      const tiny = await reshape(wide, {
        aspect: 'Custom',
        width: 8,
        height: 4,
      });
      assert.match(tiny.error ?? '', /at least 16 px/);
      const huge = await reshape(wide, {
        aspect: 'Custom',
        width: 8000,
        height: 4500,
      });
      assert.match(huge.error ?? '', /at most 4096 px/);
      const noVideo = await reshape(sound, { aspect: '1:1 Square' });
      assert.match(noVideo.error ?? '', /no video to reshape/);

      for (const name of made) rmSync(path.join(outDir(), name));
    },
  );

  test(
    "an editor's frames and waveform (Trim Video's timeline)",
    { skip: !hasEngine && 'no vendor binaries' },
    async () => {
      const dir = path.join(tmp, 'timeline');
      await fs.mkdir(dir, { recursive: true });
      const loud = path.join(dir, 'loud.mov');
      const silent = path.join(dir, 'silent.mp4');
      // Two seconds of tone, then two of silence.
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=4:size=320x240:rate=25',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2,apad=whole_dur=4',
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        '-shortest',
        loud,
      ]);
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=320x240:rate=25',
        '-c:v',
        'mpeg4',
        silent,
      ]);

      // A frame, as tall as asked for; none past the end.
      const frame = await frameAt(vendorFfmpeg, loud, 1.5, 112);
      assert.match(frame ?? '', /^data:image\/jpeg;base64,/);
      assert.equal(await frameAt(vendorFfmpeg, loud, 60, 112), null);

      // Loud where the tone is, quiet after it, the loudest at 1.
      const peaks = await waveform(vendorFfmpeg, loud, 40);
      assert.equal(peaks?.length, 40);
      assert.equal(Math.max(...(peaks ?? [])), 1);
      assert.ok((peaks?.[5] ?? 0) > 0.5, String(peaks?.[5]));
      assert.ok((peaks?.[35] ?? 1) < 0.05, String(peaks?.[35]));
      // No sound at all is no waveform.
      assert.equal(await waveform(vendorFfmpeg, silent, 40), null);
    },
  );

  test(
    'an HEVC video fails with a message that says why',
    { skip: process.platform !== 'darwin' && 'macOS only' },
    async () => {
      // Made with macOS's own encoder; Offlane's FFmpeg can't decode it.
      const hevc = path.join(tmp, 'iphone.mp4');
      const made = spawnSync(path.join(bundledBinDir, 'ffmpeg'), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=320x240:rate=25',
        '-c:v',
        'hevc_videotoolbox',
        '-tag:v',
        'hvc1',
        hevc,
      ]);
      assert.equal(made.status, 0, String(made.stderr));
      const tools = queue({ 'compress-video': compressVideo });
      const [job] = tools.run('compress-video', {
        files: [hevc],
        links: [],
        values: { quality: 50 },
      });
      const done = await settled(tools, job.id);
      assert.equal(done.status, 'failed');
      assert.equal(
        done.error,
        'This video is in HEVC (H.265), which Offlane can’t convert yet.',
      );
      // Its partial output was deleted.
      assert.ok(
        !readdirSync(outDir()).some((name) => name.startsWith('iphone')),
      );
    },
  );
});

const vendorFfmpeg = path.join(
  bundledBinDir,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
);
const vendorFfprobe = path.join(
  bundledBinDir,
  process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
);

/** Runs vendor/'s ffmpeg quietly; throws with its error output if it fails. */
function ffmpegOk(args: string[]) {
  const result = spawnSync(vendorFfmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    ...args,
  ]);
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

/** A path as FFmpeg's filter syntax needs it: forward slashes, with `:`,
 *  `'` and `\` escaped. */
const filterPath = (file: string) =>
  file.replaceAll('\\', '/').replace(/[:'\\]/g, '\\$&');

// The encoders and filters the video and audio tools rely on, checked in
// vendor/'s Media toolkit build: our own (scripts/build-ffmpeg-lgpl-mac.sh).
// macOS only for now. Windows and Linux still use BtbN's builds, which have
// an HEVC decoder, until our own build replaces them.
describe(
  'media toolkit features',
  {
    skip:
      (process.platform !== 'darwin' && 'macOS only for now') ||
      (!existsSync(vendorFfmpeg) && 'no vendor ffmpeg'),
  },
  () => {
    test('is the LGPL build', () => {
      const config = ffmpegOk(['-buildconf']).toString();
      assert.doesNotMatch(config, /--enable-(gpl|nonfree)\b/);
    });

    // HEVC and its successor VVC are covered by patent pools, so Offlane
    // ships no decoder or encoder of its own for them. The operating
    // system's (VideoToolbox, Media Foundation) are the system's, not ours.
    test('ships no HEVC or VVC decoder and no x265', () => {
      const decoders = ffmpegOk(['-decoders']).toString();
      assert.doesNotMatch(decoders, /^ V.{5} (hevc|vvc) /m);
      const encoders = ffmpegOk(['-encoders']).toString();
      assert.doesNotMatch(encoders, /libx265|libkvazaar|libvvenc/);
    });

    test(
      "still reads an HEVC file's details (made by macOS's own encoder)",
      { skip: process.platform !== 'darwin' && 'macOS only' },
      () => {
        const hevc = path.join(tmp, 'features-hevc.mp4');
        ffmpegOk([
          '-f',
          'lavfi',
          '-i',
          'testsrc=duration=2:size=320x240:rate=25',
          '-c:v',
          'hevc_videotoolbox',
          '-tag:v',
          'hvc1',
          hevc,
        ]);
        const probe = spawnSync(vendorFfprobe, [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_name:format=duration',
          '-of',
          'default=noprint_wrappers=1',
          hevc,
        ]);
        const details = probe.stdout.toString();
        assert.match(details, /codec_name=hevc/);
        const duration = Number(/duration=([\d.]+)/.exec(details)?.[1]);
        assert.ok(Math.abs(duration - 2) < 0.2, details);
        // Copying the stream needs no decoder, so Mute works on it.
        ffmpegOk([
          '-i',
          hevc,
          '-map',
          '0:v',
          '-c:v',
          'copy',
          '-an',
          path.join(tmp, 'features-hevc-muted.mp4'),
        ]);
      },
    );

    const encoders: {
      encoder: string;
      codec: string;
      file: string;
      input: string[];
      args: string[];
      tools: string;
    }[] = [
      {
        encoder: 'libmp3lame',
        codec: 'mp3',
        file: 'tone.mp3',
        input: ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'],
        args: ['-b:a', '128k'],
        tools: 'MP3 in Convert, Extract, Trim and Record Audio',
      },
      {
        encoder: 'libvorbis',
        codec: 'vorbis',
        file: 'tone.ogg',
        input: ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'],
        args: ['-b:a', '128k'],
        tools: 'OGG in Convert, Extract and Trim Audio',
      },
      {
        encoder: 'libopus',
        codec: 'opus',
        file: 'tone.webm',
        input: ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'],
        args: ['-b:a', '96k'],
        tools: 'WebM audio in Convert Video',
      },
      {
        encoder: 'libvpx-vp9',
        codec: 'vp9',
        file: 'bars.webm',
        input: ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10'],
        args: ['-deadline', 'realtime', '-cpu-used', '8', '-b:v', '200k'],
        tools: 'WebM video in Convert Video',
      },
    ];
    for (const { encoder, codec, file, input, args, tools } of encoders) {
      test(`encodes with ${encoder} (${tools})`, () => {
        const output = path.join(tmp, `features-${file}`);
        ffmpegOk([...input, '-c', encoder, ...args, output]);
        const probe = spawnSync(vendorFfprobe, [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_name',
          '-of',
          'csv=p=0',
          output,
        ]);
        assert.equal(probe.stdout.toString().trim(), codec);
      });
    }

    test('draws subtitles with libass (Burn In Subtitles)', async () => {
      const srt = path.join(tmp, 'features-subtitles.srt');
      await fs.writeFile(
        srt,
        '1\n00:00:00,000 --> 00:00:02,000\nHello from Offlane\n',
      );
      // One grey frame from a black picture, with and without the
      // subtitle: only the subtitled one has light pixels.
      const frame = (filter: string) =>
        ffmpegOk([
          '-f',
          'lavfi',
          '-i',
          'color=black:size=320x240:duration=1',
          '-vf',
          `${filter}format=gray`,
          '-frames:v',
          '1',
          '-f',
          'rawvideo',
          '-',
        ]);
      const plain = frame('');
      const subtitled = frame(`subtitles=filename=${filterPath(srt)},`);
      assert.equal(subtitled.length, 320 * 240);
      assert.ok(plain.every((value) => value < 32));
      assert.ok(
        subtitled.filter((value) => value > 128).length > 100,
        'the subtitle was drawn',
      );
    });
  },
);

// The helpers handlers share (src/tools/backend.ts), on vendor/'s FFmpeg.
describe(
  'handler helpers',
  {
    skip:
      (process.platform !== 'darwin' && 'macOS only for now') ||
      (!existsSync(vendorFfmpeg) && 'no vendor ffmpeg'),
  },
  () => {
    /** Just enough of a job's context for the helpers. */
    const context = {
      ffmpeg: () => ({ ffmpeg: vendorFfmpeg, ffprobe: vendorFfprobe }),
      run: runProgram,
      signal: new AbortController().signal,
    } as unknown as HandlerContext<unknown>;
    const helperFile = (name: string) => path.join(tmp, `helpers-${name}`);

    before(() => {
      // A landscape clip with sound, the same clip tagged as a portrait
      // phone video, a silent clip, and an MP3 with cover art.
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=320x240:rate=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2:sample_rate=48000',
        '-c:v',
        'mpeg4',
        '-b:v',
        '500k',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-shortest',
        helperFile('clip.mp4'),
      ]);
      ffmpegOk([
        '-display_rotation',
        '90',
        '-i',
        helperFile('clip.mp4'),
        '-c',
        'copy',
        helperFile('portrait.mp4'),
      ]);
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=160x120:rate=25',
        '-c:v',
        'mpeg4',
        helperFile('silent.mp4'),
      ]);
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'sine=duration=1',
        '-f',
        'lavfi',
        '-i',
        'color=red:size=64x64:duration=1',
        '-map',
        '0',
        '-map',
        '1',
        '-frames:v',
        '1',
        '-c:a',
        'libmp3lame',
        '-c:v',
        'mjpeg',
        '-disposition:v',
        'attached_pic',
        helperFile('cover.mp3'),
      ]);
    });

    test('probeMedia reads the streams', async () => {
      const media = await probeMedia(context, helperFile('clip.mp4'));
      assert.ok(Math.abs((media.duration ?? 0) - 2) < 0.1);
      assert.equal(media.video?.codec, 'mpeg4');
      assert.equal(media.video?.width, 320);
      assert.equal(media.video?.height, 240);
      assert.equal(media.video?.rotation, 0);
      assert.equal(media.video?.fps, 30);
      assert.ok((media.video?.bitrate ?? 0) > 100_000);
      assert.equal(media.audio?.codec, 'aac');
      assert.equal(media.audio?.sampleRate, 48000);
      assert.equal(media.audio?.channels, 2);
    });

    test('probeMedia gives a phone video its size as seen', async () => {
      const media = await probeMedia(context, helperFile('portrait.mp4'));
      assert.equal(media.video?.rotation, 90);
      assert.equal(media.video?.width, 240);
      assert.equal(media.video?.height, 320);
    });

    test('probeMedia: no audio, and cover art is not a video', async () => {
      const silent = await probeMedia(context, helperFile('silent.mp4'));
      assert.equal(silent.audio, null);
      assert.ok(silent.video);
      const song = await probeMedia(context, helperFile('cover.mp3'));
      assert.equal(song.video, null);
      assert.equal(song.audio?.codec, 'mp3');
    });

    test("probeMedia says why it can't read a file", async () => {
      await fs.writeFile(helperFile('not-media.mp4'), 'not a video');
      await assert.rejects(probeMedia(context, helperFile('not-media.mp4')));
    });

    test('h264Args makes a playable H.264 MP4', async () => {
      const output = helperFile('h264.mp4');
      ffmpegOk([
        '-i',
        helperFile('clip.mp4'),
        ...(await h264Args(context, 800_000)),
        output,
      ]);
      const media = await probeMedia(context, output);
      assert.equal(media.video?.codec, 'h264');
      assert.equal(media.audio?.codec, 'aac');
    });

    test('audioArgs makes every audio format', async () => {
      const codecs: Record<string, string> = {
        MP3: 'mp3',
        M4A: 'aac',
        WAV: 'pcm_s16le',
        FLAC: 'flac',
        OGG: 'vorbis',
      };
      for (const format of audioFormats) {
        const { ext, args } = await audioArgs(context, format, 128);
        const output = helperFile(`audio.${ext}`);
        ffmpegOk(['-i', helperFile('clip.mp4'), '-vn', ...args, output]);
        const media = await probeMedia(context, output);
        assert.equal(media.audio?.codec, codecs[format], format);
      }
      await assert.rejects(audioArgs(context, 'AIFF'), /can't make AIFF/);
    });

    test('videoArgs makes every video format', async () => {
      const codecs: Record<string, [string, string]> = {
        MP4: ['h264', 'aac'],
        MOV: ['h264', 'aac'],
        WebM: ['vp9', 'opus'],
        MKV: ['mpeg4', 'aac'],
        AVI: ['mpeg4', 'mp3'],
      };
      for (const format of videoFormats) {
        const { ext, args } = await videoArgs(context, format, 500_000);
        const output = helperFile(`video.${ext}`);
        ffmpegOk(['-i', helperFile('clip.mp4'), ...args, output]);
        const media = await probeMedia(context, output);
        assert.deepEqual(
          [media.video?.codec, media.audio?.codec],
          codecs[format],
          format,
        );
      }
    });

    test('times are shown and typed as minutes and seconds', () => {
      assert.equal(clock(0), '0:00.00');
      assert.equal(clock(65.25), '1:05.25');
      assert.equal(clock(3725.5), '1:02:05.50');
      assert.equal(parseClock('1:05.25'), 65.25);
      assert.equal(parseClock(' 1:02:05 '), 3725);
      assert.equal(parseClock('65.5'), 65.5);
      assert.equal(parseClock('12s'), 12);
      assert.equal(parseClock('.5'), 0.5);
      assert.equal(parseClock(clock(487.37)), 487.37);
      for (const bad of ['', 'abc', '1:75', '1::2', '-3', '1:2:3:4']) {
        assert.equal(parseClock(bad), null, bad);
      }
    });

    test('timeRange keeps the part asked for', () => {
      assert.deepEqual(timeRange({ start: 1, end: 3 }, 10), {
        start: 1,
        length: 2,
        inputArgs: ['-ss', '1', '-t', '2'],
      });
      // End is capped at the length.
      assert.equal(timeRange({ start: 4, end: 30 }, 10).length, 6);
      assert.equal(timeRange({ start: 0, end: 5 }, null).length, 5);
      assert.throws(
        () => timeRange({ start: 3, end: 3 }, 10),
        /End must be after Start/,
      );
      assert.throws(
        () => timeRange({ start: -1, end: 3 }, 10),
        /before the beginning/,
      );
      assert.throws(
        () => timeRange({ start: 12, end: 20 }, 10),
        /Start is after the end of the file, which is 10 s long/,
      );
    });

    test('a timeRange cut is the right length', async () => {
      const { inputArgs, length } = timeRange({ start: 0.5, end: 1.5 }, 2);
      const output = helperFile('cut.mp4');
      ffmpegOk([
        ...inputArgs,
        '-i',
        helperFile('clip.mp4'),
        ...(await h264Args(context, 500_000)),
        output,
      ]);
      const media = await probeMedia(context, output);
      assert.ok(
        Math.abs((media.duration ?? 0) - length) < 0.1,
        String(media.duration),
      );
    });
  },
);

describe(
  'player tracks',
  {
    skip:
      (process.platform !== 'darwin' && 'macOS only for now') ||
      (!existsSync(vendorFfmpeg) && 'no vendor ffmpeg'),
  },
  () => {
    let dir = '';
    let player: Player;
    before(() => {
      dir = path.join(tmp, 'player');
      player = new Player({
        getFfmpeg: () => ({ ffmpeg: vendorFfmpeg, ffprobe: vendorFfprobe }),
        cacheDir: path.join(dir, 'cache'),
        onProgress: () => {},
      });
    });
    const languagesOf = (file: string) =>
      spawnSync(vendorFfprobe, [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream_tags=language',
        '-of',
        'csv=p=0',
        file,
      ])
        .stdout.toString()
        .trim()
        .split('\n');
    /** The file a media:// URL serves, read through the player. */
    const served = async (url: string) =>
      Buffer.from(await (await player.handle(new Request(url))).arrayBuffer());

    test('a dubbed download plays either track, with its subtitles', async () => {
      await fs.mkdir(dir, { recursive: true });
      const srt = path.join(dir, 'captions.srt');
      await fs.writeFile(srt, '1\n00:00:00,000 --> 00:00:01,500\nHola\n');
      // As a download with a dub chosen is saved: the dub first, then the
      // original, and Spanish subtitles.
      const file = path.join(dir, 'dubbed.mp4');
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=320x240:rate=25',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=300:duration=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=600:duration=2',
        '-i',
        srt,
        '-map',
        '0',
        '-map',
        '1',
        '-map',
        '2',
        '-map',
        '3',
        '-c:v',
        'h264_videotoolbox',
        '-c:a',
        'aac',
        '-c:s',
        'mov_text',
        '-metadata:s:a:0',
        'language=spa',
        '-metadata:s:a:1',
        'language=eng',
        '-metadata:s:s:0',
        'language=spa',
        file,
      ]);
      const hints = { languages: ['es', 'en'], original: 'en' };

      const first = await player.prepare('dub', file, 0, hints);
      assert.deepEqual(first.audioTracks, [
        { label: 'Spanish', original: false },
        { label: 'English', original: true },
      ]);
      assert.equal(first.audioTrack, 0);
      assert.equal(first.subtitles.length, 1);
      assert.equal(first.subtitles[0].label, 'Spanish');
      assert.equal(first.subtitles[0].language, 'es');
      assert.match(first.subtitles[0].vtt, /^WEBVTT[\s\S]*Hola/);

      // Each track is a copy with only that audio, so Chromium plays it.
      const firstCopy = path.join(dir, 'first.mp4');
      await fs.writeFile(firstCopy, await served(first.url));
      assert.deepEqual(languagesOf(firstCopy), ['spa']);
      const second = await player.prepare('dub', file, 1, hints);
      assert.equal(second.audioTrack, 1);
      assert.notEqual(second.url, first.url);
      const secondCopy = path.join(dir, 'second.mp4');
      await fs.writeFile(secondCopy, await served(second.url));
      assert.deepEqual(languagesOf(secondCopy), ['eng']);
    });

    test('a plain download plays as it is, with no tracks to choose', async () => {
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, 'plain.mp4');
      ffmpegOk([
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=160x120:rate=25',
        '-f',
        'lavfi',
        '-i',
        'sine=duration=1',
        '-c:v',
        'h264_videotoolbox',
        '-c:a',
        'aac',
        '-shortest',
        file,
      ]);
      const source = await player.prepare('plain', file);
      assert.equal(source.prepared, 'direct');
      assert.deepEqual(source.audioTracks, []);
      assert.deepEqual(source.subtitles, []);
    });
  },
);

describe('recordings', () => {
  test('a recording is saved under a name a person reads', () => {
    const dir = path.join(tmp, 'recordings');
    const recordings = new Recordings(dir);
    const when = new Date(2026, 10, 20, 9, 5, 7);
    assert.equal(recordingName(when), 'Recording 2026-11-20 at 09.05.07');
    const saved = recordings.save(
      new Uint8Array([1, 2, 3]),
      'audio/webm;codecs=opus',
      when,
    );
    assert.equal(saved.name, 'Recording 2026-11-20 at 09.05.07.webm');
    assert.equal(saved.type, 'audio/webm');
    assert.equal(path.basename(saved.path), saved.name);
    assert.deepEqual([...readFileSync(saved.path)], [1, 2, 3]);
    // Two at the same second don't collide: each has its own folder.
    const again = recordings.save(new Uint8Array([4]), 'audio/mp4', when);
    assert.ok(again.name.endsWith('.m4a'));
    assert.notEqual(path.dirname(again.path), path.dirname(saved.path));
  });

  test('only audio recordings, and not empty ones', () => {
    const recordings = new Recordings(path.join(tmp, 'recordings-bad'));
    assert.throws(
      () => recordings.save(new Uint8Array([1]), 'video/webm'),
      /can't save that kind/,
    );
    assert.throws(
      () => recordings.save(new Uint8Array([1]), 'text/html'),
      /can't save that kind/,
    );
    assert.throws(
      () => recordings.save(new Uint8Array(), 'audio/webm'),
      /empty/,
    );
  });

  test('old recordings are swept away', () => {
    const dir = path.join(tmp, 'recordings-sweep');
    const recordings = new Recordings(dir);
    const old = recordings.save(new Uint8Array([1]), 'audio/webm');
    const fresh = recordings.save(new Uint8Array([1]), 'audio/webm');
    // A day and a bit later, both are gone; one just made is kept.
    recordings.sweep(24 * 60 * 60 * 1000, Date.now() + 25 * 60 * 60 * 1000);
    assert.ok(!existsSync(old.path) && !existsSync(fresh.path));
    const kept = recordings.save(new Uint8Array([1]), 'audio/webm');
    recordings.sweep();
    assert.ok(existsSync(kept.path));
    // Sweeping a folder that isn't there yet is fine.
    new Recordings(path.join(tmp, 'never-made')).sweep();
  });
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
