// End-to-end checks for Download Video: looking a link up, the link drawn
// between the steps, downloading, and the errors shown when either fails.
// It starts its own copy of the app, with its own data folder and save
// folder, drives it over the Chrome DevTools Protocol, and quits it.
//
//   npm run test:download          offline: a fake yt-dlp and fetch, no
//                                  request leaves the machine
//   npm run test:download:online   the real yt-dlp against YouTube
//
// Offline, the app runs with OFFLANE_MOCKS (see src/main/mocks.ts and
// ../mocks/yt-dlp.mjs). Run `npm run fetch-binaries` first: the clip and
// thumbnail the mocks hand out are made by the bundled ffmpeg. Set
// FORGE_PORT and CDP_PORT (3100 and 9333 by default) to use other ports;
// KEEP=1 keeps the temporary folder. The app runs out of sight, with no
// window or Dock icon; SHOW=1 shows it. Needs Node 22 or later.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const online = process.argv.includes('--online');
const forgePort = process.env.FORGE_PORT ?? '3100';
const cdpPort = process.env.CDP_PORT ?? '9333';
const root = path.resolve(import.meta.dirname, '../../..');
const binDir = path.join(
  root,
  'vendor',
  `${platform()}-${process.arch}`,
  'bin',
);
const page = `http://localhost:${forgePort}/main_window/download-video`;

function platform() {
  return { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Another app on either port would be driven instead of ours.
for (const port of [forgePort, cdpPort]) {
  const taken = await fetch(`http://localhost:${port}/`).then(
    () => true,
    () => false,
  );
  if (taken) {
    console.error(`Port ${port} is in use; set FORGE_PORT or CDP_PORT.`);
    process.exit(1);
  }
}

// A data folder, a save folder and, offline, the mocks' folder.
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'offlane-download-'));
const userData = path.join(tmp, 'userdata');
const saveDir = path.join(tmp, 'saved');
const mocks = path.join(tmp, 'mocks');
await fs.mkdir(userData);
await fs.mkdir(saveDir);
await fs.writeFile(
  path.join(userData, 'settings.json'),
  JSON.stringify({ downloadDir: saveDir }),
);
// Download Video turned on, as a person does in Settings: it runs the fake
// yt-dlp offline, vendor/'s online (both found first, see main/index.ts).
await fs.writeFile(
  path.join(userData, 'external-tools.json'),
  JSON.stringify({ ytdlpEnabled: true }),
);
if (!online) await makeMocks();

/** The fake yt-dlp, and a short clip and a thumbnail for it to hand out. */
async function makeMocks() {
  const ffmpeg = path.join(binDir, 'ffmpeg');
  if (!existsSync(ffmpeg)) {
    console.error('No bundled ffmpeg; run npm run fetch-binaries first.');
    process.exit(1);
  }
  await fs.mkdir(mocks);
  await fs.symlink(
    path.join(root, 'src/tests/mocks/yt-dlp.mjs'),
    path.join(mocks, 'yt-dlp'),
  );
  const make = (args) => {
    const result = spawnSync(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      ...args,
    ]);
    if (result.status !== 0) throw new Error(result.stderr.toString());
  };
  make([
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
    path.join(mocks, 'clip.mp4'),
  ]);
  make([
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=4:size=180x320:rate=25',
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
    path.join(mocks, 'clip-upright.mp4'),
  ]);
  make([
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1280x720',
    '-frames:v',
    '1',
    path.join(mocks, 'thumb.jpg'),
  ]);
  make([
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1080x1920',
    '-frames:v',
    '1',
    path.join(mocks, 'thumb-upright.jpg'),
  ]);
}

// The app, in a process group of its own so it can be quit whole.
const log = path.join(tmp, 'app.log');
const app = spawn(
  'npx',
  [
    'electron-forge',
    'start',
    '--',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userData}`,
    // Runs as if on screen even when other windows cover it: Chromium
    // otherwise pauses a hidden window's animations and frames, and the
    // tests that watch them fail.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
  {
    cwd: root,
    detached: true,
    stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')],
    env: {
      ...process.env,
      FORGE_PORT: forgePort,
      // The toolkits from vendor/, so the test downloads nothing.
      OFFLANE_USE_VENDOR: '1',
      // Out of sight: no window or Dock icon. SHOW=1 shows it, to watch.
      ...(process.env.SHOW === '1' ? {} : { OFFLANE_HIDDEN: '1' }),
      ...(online ? {} : { OFFLANE_MOCKS: mocks, MOCK_DELAY_MS: '1500' }),
    },
  },
);

async function quit(code) {
  // Asked first, then made to; Electron can take a moment to go.
  const signal = (name) => {
    try {
      process.kill(-app.pid, name);
      return true;
    } catch {
      return false;
    }
  };
  if (signal('SIGTERM')) {
    await until(async () => !signal(0), 5000);
    signal('SIGKILL');
  }
  if (process.env.KEEP || code) console.log(`Kept ${tmp} (app log: ${log})`);
  else await fs.rm(tmp, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGINT', () => void quit(130));
// Never left running after a crash.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    console.error(error);
    void quit(1);
  });
}

/** Waits for `check` to return something truthy, polling every `every` ms. */
async function until(check, timeout, every = 250) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check().catch(() => null);
    if (value) return value;
    await sleep(every);
  }
  return null;
}

// The first build takes a while.
const target = await until(
  async () => {
    const list = await (
      await fetch(`http://localhost:${cdpPort}/json/list`)
    ).json();
    return list.find((item) => item.url.includes('/main_window'));
  },
  240_000,
  1000,
);
if (!target) {
  console.error('The app did not start.');
  await quit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve));
let lastId = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++lastId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });

/** Evaluates `expression` in the page and returns its value. */
async function run(expression) {
  const message = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  // A page reloading mid-call answers with an error instead.
  if (message.error) throw new Error(message.error.message);
  const { result } = message;
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ?? expression,
    );
  }
  return result.result.value;
}

const text = () => run(`document.querySelector('main')?.innerText ?? ''`);
const shows = (words) => async () => (await text()).includes(words);

/** The link between the steps: how many lines and rings it has drawn. */
const links = () =>
  run(`({
    lines: document.querySelectorAll('main .flow-line').length,
    joints: document.querySelectorAll('main .flow-joint').length,
    pills: [...document.querySelectorAll('main [role=status]')].map((pill) => pill.textContent.trim()).filter(Boolean),
  })`);

/** A fresh Download Video page in a fresh window. */
async function fresh() {
  const ready = () => run(`!!document.querySelector('main input')`);
  // On the app's page first: storage is out of reach before it has loaded.
  await send('Page.navigate', { url: page });
  await until(ready, 30_000);
  await run(`sessionStorage.clear(); localStorage.clear()`);
  // As a returning user: the first-launch toolkit screen already seen, so
  // it never covers the page (or passes for the player's dialog).
  await run(`window.downloader.updateSettings({ toolkitsOnboarded: true })`);
  await send('Page.navigate', { url: page });
  await until(ready, 10_000);
  // Settled: the first load also restores the window's tabs.
  await sleep(500);
}

async function lookUp(link) {
  await run(`(() => {
    const input = document.querySelector('main input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(input, ${JSON.stringify(link)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  await run(
    `document.querySelector('main button[aria-label="Look Up"]').click()`,
  );
}

async function download() {
  await run(`[...document.querySelectorAll('main button')]
    .find((button) => button.textContent.trim() === 'Download').click()`);
}

/** The found card's shape, and its thumbnail's own, if it has one. */
const cardShape = () =>
  run(`(() => {
    const card = document.querySelector('main [aria-describedby] [class*="aspect-"]');
    const box = card.getBoundingClientRect();
    const image = card.querySelector('img');
    return {
      width: box.width,
      height: box.height,
      ratio: box.width / box.height,
      image: !!image?.naturalWidth,
      imageRatio: image ? image.naturalWidth / image.naturalHeight : null,
    };
  })()`);

function expect(passed, detail) {
  if (!passed) throw new Error(JSON.stringify(detail));
}

// Offline, the mocks answer at once (after MOCK_DELAY_MS); online, YouTube
// takes its time.
const lookupTime = online ? 150_000 : 10_000;
const downloadTime = online ? 300_000 : 20_000;
const video = online
  ? 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
  : 'https://www.youtube.com/watch?v=mock-ok';

const cases = {
  async 'while looking up, only the link down to the pill is drawn'() {
    await lookUp(video);
    await until(shows('Looking up…'), 5000, 50);
    const now = await links();
    expect(now.lines === 1 && now.joints === 1, now);
    await run(
      `window.firstLine = document.querySelector('main .flow-line'); true`,
    );

    expect(await until(shows('Video found'), lookupTime), await text());
    const after = await links();
    const kept = await run(
      `document.querySelector('main .flow-line') === window.firstLine`,
    );
    // Down to the pill and on to the card, then from the card straight
    // down to the options; a ring only where each link leaves a step.
    expect(after.lines === 3 && after.joints === 2 && kept, { ...after, kept });
  },

  async 'a regular video gets a 16:9 card'() {
    await lookUp(video);
    expect(await until(shows('Video found'), lookupTime), await text());
    const shape = await cardShape();
    expect(Math.abs(shape.ratio - 16 / 9) < 0.02, shape);
  },

  async 'a reel gets an upright card with its upright thumbnail'() {
    if (online) return;
    await lookUp('https://www.instagram.com/reel/mock-reel');
    expect(await until(shows('Video found'), lookupTime), await text());
    const shape = await cardShape();
    expect(Math.abs(shape.ratio - 9 / 16) < 0.02 && shape.image, shape);
    expect(shape.imageRatio < 1, shape);
  },

  async 'a Short gets an upright card, with a wide thumbnail if need be'() {
    if (online) return;
    // Offline, YouTube's upright thumbnail can't be had, so the card
    // falls back to the wide one, cropped to fit.
    await lookUp('https://www.youtube.com/shorts/mock-short');
    expect(await until(shows('Video found'), lookupTime), await text());
    const shape = await cardShape();
    expect(Math.abs(shape.ratio - 9 / 16) < 0.02 && shape.image, shape);
  },

  async 'an upright video plays upright from the first frame'() {
    if (online) return;
    await lookUp('https://www.instagram.com/reel/mock-reel');
    expect(await until(shows('Video found'), lookupTime), await text());
    await download();
    expect(await until(shows('Download complete'), downloadTime), await text());
    // Every frame from opening, the player's shape whenever it can be seen.
    await run(`(() => {
      window.seen = [];
      const watch = () => {
        const frame = document.querySelector('[role=dialog]');
        if (frame && Number(getComputedStyle(frame).opacity) > 0) {
          const box = frame.getBoundingClientRect();
          window.seen.push(box.width / box.height);
        }
        if (window.seen.length < 200) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      document.querySelector('main button[aria-label=Play]').click();
    })()`);
    expect(
      await until(() => run('window.seen.length >= 30'), 20_000),
      'the player never showed',
    );
    const seen = await run('window.seen');
    expect(
      seen.every((ratio) => Math.abs(ratio - 9 / 16) < 0.03),
      seen.slice(0, 10),
    );
    await run(`document.querySelector('[aria-label="Close player"]').click()`);
  },

  async 'an upright download shows upright in History'() {
    if (online) return;
    await lookUp('https://www.instagram.com/reel/mock-reel');
    expect(await until(shows('Video found'), lookupTime), await text());
    await download();
    expect(await until(shows('Download complete'), downloadTime), await text());
    // The shape is read from the downloaded file itself.
    const aspects = await run(
      `window.downloader.listJobs().then((jobs) => jobs.map((job) => job.aspect))`,
    );
    expect(
      aspects.some((aspect) => Math.abs(aspect - 9 / 16) < 0.01),
      aspects,
    );
    await sleep(1000);
    await send('Page.navigate', {
      url: page.replace('download-video', 'history'),
    });
    await until(
      () => run(`!!document.querySelector('main ol li img')`),
      10_000,
    );
    await sleep(500);
    // An upright picture stands at its own shape in the row's 16:9 slot.
    const shown = await run(`(() => {
      const box = document
        .querySelector('main ol li img')
        .parentElement.getBoundingClientRect();
      return { width: box.width, height: box.height };
    })()`);
    expect(Math.abs(shown.width / shown.height - 9 / 16) < 0.03, shown);
  },

  async 'a site that wants a sign-in offers the browser’s, then retries'() {
    if (online) return;
    await lookUp('https://www.instagram.com/p/mock-signin');
    expect(
      await until(
        shows('only shows this to people who are signed in'),
        lookupTime,
      ),
      await text(),
    );
    const browsers = await run(
      `[...document.querySelectorAll('main [role=radiogroup] [role=radio]')].map((radio) => radio.textContent.trim())`,
    );
    // A machine with none of the browsers says so instead.
    if (browsers.length === 0) {
      expect(await shows('No browser the app can use')(), await text());
      return;
    }
    await run(`(() => {
      document.querySelector('main [role=radiogroup] [role=radio]').click();
      [...document.querySelectorAll('main button')]
        .find((button) => button.textContent.includes('Allow & Retry'))
        .click();
    })()`);
    expect(await until(shows('Video found'), lookupTime), await text());
    expect(!(await shows('signed in')()), await text());
    // Kept for next time, and offered in Settings to change or turn off.
    const settings = await run('window.downloader.getSettings()');
    expect(settings.cookiesBrowser !== '', settings);
    await run(`window.downloader.updateSettings({ cookiesBrowser: '' })`);
  },

  async 'the card shows the title and thumbnail'() {
    await lookUp(video);
    expect(await until(shows('Video found'), lookupTime), await text());
    const card = await run(`({
      // The title over the card's foot, as it is shown.
      title:
        document.querySelector('main [aria-describedby] [class*="aspect-"] p.line-clamp-2')
          ?.textContent ?? '',
      image: document.querySelector('main img')?.src.slice(0, 20) ?? '',
    })`);
    const title = online ? 'Me at the zoo' : 'Mock video, a walk by the river';
    expect(card.title === title && card.image.startsWith('data:image/'), card);
  },

  async 'once found, the page scrolls so the options show whole'() {
    // A short window, so the options start out below it.
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false,
    });
    try {
      await lookUp(video);
      expect(await until(shows('Video found'), lookupTime), await text());
      await sleep(1200);
      const view = await run(`(() => {
        const button = [...document.querySelectorAll('main button')]
          .find((button) => button.textContent.trim() === 'Download');
        const scroller = document.querySelector('main .overflow-y-auto');
        return {
          bottom: Math.round(button.getBoundingClientRect().bottom),
          height: innerHeight,
          scrolled: Math.round(scroller.scrollTop),
        };
      })()`);
      expect(view.scrolled > 0 && view.bottom <= view.height, view);
    } finally {
      await send('Emulation.clearDeviceMetricsOverride');
    }
  },

  async 'a download completes, is saved, and its link is then fixed'() {
    await lookUp(video);
    expect(await until(shows('Video found'), lookupTime), await text());
    await download();
    expect(await until(shows('Download complete'), downloadTime), await text());
    const saved = await fs.readdir(saveDir);
    const field = () =>
      run(`(() => {
        const input = document.querySelector('main input');
        return { readOnly: input.readOnly, value: input.value };
      })()`);
    const done = await field();
    expect(saved.some((name) => name.endsWith('.mp4')) && done.readOnly, {
      saved,
      done,
    });
    // Start Over clears it, ready for another link.
    await run(
      `document.querySelector('main button[aria-label="Start Over"]').click()`,
    );
    const fresh = await until(async () => {
      const now = await field();
      return !now.readOnly && now.value === '' ? now : null;
    }, 5000);
    expect(fresh, await field());
  },
};

if (!online) {
  Object.assign(cases, {
    async 'a lookup that times out says why'() {
      await lookUp('https://www.youtube.com/watch?v=mock-timeout');
      const said = await until(
        shows('The site took too long to respond.'),
        lookupTime,
      );
      expect(said, await text());
    },

    async 'a playlist with a removed video is partly done, then done'() {
      await lookUp('https://www.youtube.com/playlist/mock-playlist');
      expect(await until(shows('Playlist found'), lookupTime), await text());
      await run(`[...document.querySelectorAll('main button')]
        .find((button) => button.textContent.trim() === 'Download 3').click()`);
      const settled = await until(
        () =>
          run(`window.downloader.listJobs().then((all) => {
            const jobs = all.filter((job) => /mock-pl-|mock-gone/.test(job.url));
            const done = jobs.filter((job) => job.status === 'completed').length;
            const failed = jobs.filter((job) => job.status === 'failed');
            return done === 2 && failed.length === 1 ? failed[0].id : null;
          })`),
        downloadTime * 2,
      );
      expect(
        settled,
        await run(
          `window.downloader.listJobs().then((all) => JSON.stringify(all.filter((job) => /mock-pl-|mock-gone/.test(job.url)).map((job) => [job.url, job.status])))`,
        ),
      );
      const workflow = await run('location.href');
      const historyRow = async () => {
        await sleep(1200);
        await send('Page.navigate', {
          url: page.replace('download-video', 'history'),
        });
        return until(
          () => run(`document.querySelector('main ol li')?.innerText ?? null`),
          10_000,
        );
      };
      // Two of three saved, one couldn't be: partly done, not failed.
      const partly = await historyRow();
      expect(
        /playlist/i.test(partly) && /2 of 3 downloaded/i.test(partly),
        partly +
          (await run(
            `window.sessions.list().then((list) => JSON.stringify(list.map((s) => s.meta.jobs)))`,
          )) +
          (await run(
            `window.downloader.listJobs().then((all) => JSON.stringify(all.filter((job) => /mock-pl-|mock-gone/.test(job.url)).map((job) => [job.id.slice(0, 8), job.status])))`,
          )),
      );
      // Removing the one that failed leaves it done, not "Downloading":
      // both of the two left.
      await send('Page.navigate', { url: workflow });
      await until(() => run(`!!document.querySelector('main input')`), 10_000);
      await sleep(800);
      await run(`window.downloader.remove(${JSON.stringify(settled)})`);
      const done = await historyRow();
      expect(
        /All 2 downloaded/i.test(done) && !/downloading|failed/i.test(done),
        done,
      );
    },

    async 'a playlist pauses, resumes and cancels all at once'() {
      await lookUp('https://www.youtube.com/playlist/mock-playlist');
      expect(await until(shows('Playlist found'), lookupTime), await text());
      const press = (label) =>
        run(`(() => {
          const button = [...document.querySelectorAll('main button')]
            .find((b) => b.textContent.trim() === ${JSON.stringify(label)});
          button?.click();
          return Boolean(button);
        })()`);
      const states = () =>
        run(`window.downloader.listJobs().then((all) => all
          .filter((job) => /mock-pl-|mock-gone/.test(job.url))
          .map((job) => job.status).sort().join())`);
      await press('Download 3');
      expect(await until(() => press('Pause All'), 5_000), await text());
      // Nothing left downloading; what hadn't finished is paused.
      const paused = await until(async () => {
        const now = await states();
        return /paused/.test(now) &&
          !/queued|probing|downloading|processing/.test(now)
          ? now
          : null;
      }, 10_000);
      expect(paused, await states());
      expect(await until(shows('Resume All'), 5_000), await text());
      // Resuming sets them going again, so Pause All is back.
      expect(await press('Resume All'), await text());
      expect(await until(shows('Pause All'), 5_000), await text());
      await press('Pause All');
      await until(
        async () => !/queued|downloading/.test(await states()),
        10_000,
      );
      // Cancel All stops every unfinished one; the controls then go.
      expect(await press('Cancel All'), await text());
      const cancelled = await until(async () => {
        const now = await states();
        return /canceled/.test(now) && !/paused|queued|downloading/.test(now)
          ? now
          : null;
      }, 10_000);
      expect(cancelled, await states());
      expect(
        await until(async () => !(await text()).includes('Cancel All'), 5_000),
        await text(),
      );
    },

    async 'History says how a playlist stands, however its videos ended'() {
      // Sessions as the page saves them, each with its videos' states.
      const cases = [
        [
          ['done', 'done', 'paused', 'paused', 'paused', 'paused'],
          'Paused · 2 of 6 downloaded',
        ],
        [
          ['done', 'done', 'cancelled', 'paused', 'paused', 'paused'],
          'Paused · 2 of 6 downloaded · 1 cancelled',
        ],
        [
          ['done', 'done', 'cancelled', 'cancelled', 'cancelled', 'cancelled'],
          'Cancelled · 2 of 6 downloaded',
        ],
        [
          ['cancelled', 'cancelled', 'cancelled'],
          'Cancelled · 0 of 3 downloaded',
        ],
        [
          ['done', 'running', 'cancelled'],
          'Downloading · 1 of 3 downloaded · 1 cancelled',
        ],
        [['done', 'done', 'failed'], '2 of 3 downloaded · 1 failed'],
        [
          ['done', 'failed', 'cancelled'],
          'Cancelled · 1 of 3 downloaded · 1 failed',
        ],
        [['failed', 'failed'], 'All 2 failed'],
        [['done', 'done', 'done'], 'All 3 downloaded'],
      ];
      await run(`window.sessions.clear()`);
      for (const [index, [states]] of cases.entries()) {
        const jobs = Object.fromEntries(
          states.map((state, n) => [`case-${index}-${n}`, state]),
        );
        await run(
          `window.sessions.save(${JSON.stringify({
            // A session id is a UUID.
            id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            toolId: 'download-video',
            title: `Case ${index}`,
            summary: 'Playlist · 6 videos · Video',
            meta: {
              jobs,
              doing: 'Downloading',
              done: 'Downloaded',
              playlist: states.length,
            },
            state: '{}',
          })})`,
        );
      }
      await send('Page.navigate', {
        url: page.replace('download-video', 'history'),
      });
      const rows = await until(
        () =>
          run(`(() => {
            const rows = [...document.querySelectorAll('main ol li')];
            return rows.length >= ${cases.length}
              ? Object.fromEntries(rows.map((row) => [
                  /Case \\d+/.exec(row.innerText)?.[0],
                  row.innerText,
                ]))
              : null;
          })()`),
        10_000,
      );
      expect(rows, await text());
      for (const [index, [, want]] of cases.entries()) {
        const row = rows[`Case ${index}`] ?? '';
        expect(
          row.includes(want),
          `Case ${index}: wanted "${want}", got "${row}"`,
        );
      }
    },

    async 'a download that fails says why'() {
      await lookUp('https://www.youtube.com/watch?v=mock-download-fail');
      expect(await until(shows('Video found'), lookupTime), await text());
      await download();
      // A timeout is retried, so it may already say it will try again.
      const said = await until(
        shows('The site took too long to respond.'),
        downloadTime,
      );
      expect(said, await text());
    },
  });
}

console.log(online ? 'Online, against YouTube' : 'Offline, with mocks');
let failures = 0;
for (const [name, check] of Object.entries(cases)) {
  try {
    await fresh();
    await check();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}\n     ${error.message}`);
  }
}
socket.close();
console.log(
  `\n${Object.keys(cases).length - failures} passed, ${failures} failed`,
);
await quit(failures ? 1 : 0);
