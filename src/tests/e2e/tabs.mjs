// End-to-end checks for the router and tabs, run against a live app window
// over the Chrome DevTools Protocol. Start the app with a debugging port,
// on a port of its own:
//
//   OFFLANE_USE_VENDOR=1 FORGE_PORT=3100 npx electron-forge start -- --remote-debugging-port=9333
//
// then run `npm run test:e2e`. For a packaged build, launch it with
// --remote-debugging-port=9333 and set APP_URL=app://bundle/main_window/.
// Needs Node 22 or later, for its built-in WebSocket.

const cdpPort = process.env.CDP_PORT ?? '9333';
const appUrl = process.env.APP_URL ?? 'http://localhost:3100/main_window/';
const base = '/main_window';

const targets = await (
  await fetch(`http://localhost:${cdpPort}/json/list`)
).json();
const target = targets.find((candidate) => candidate.url.includes(base));
if (!target) throw new Error(`No app window on debugging port ${cdpPort}`);

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Evaluates `expression` in the page and returns its value. */
async function run(expression) {
  const { result } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ?? expression,
    );
  }
  return result.result.value;
}

/** Presses Cmd (with Shift if asked) and a key. */
async function shortcut(code, key, shift = false) {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      code,
      key,
      modifiers: 4 | (shift ? 8 : 0),
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    });
  }
  await sleep(300);
}

/** Clicks the first element matching `selector`, with Cmd held if asked. */
async function click(selector, meta = false) {
  const found = await run(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.dispatchEvent(new MouseEvent('click',
      { bubbles: true, cancelable: true, button: 0, metaKey: ${meta} }));
    return !!element;
  })()`);
  if (!found) throw new Error(`Nothing to click at ${selector}`);
  await sleep(300);
}

const link = (path) => `a[href="${base}${path}"]`;
const clickTab = (id) => click(`[data-tab-id="${id}"]`);

/** The URL, the page showing, and the tab strip (Home has no tab in it). */
const state = () =>
  run(`({
    path: location.pathname.slice(${base.length}) || '/',
    hash: location.hash,
    pages: document.querySelectorAll('main').length,
    title: document.querySelector('main h1')?.textContent ?? '',
    tabs: [...document.querySelectorAll('[data-tab-id]')].map((tab) => tab.dataset.tabId),
    active: document.querySelector('[data-tab-id][aria-selected="true"]')?.dataset.tabId ?? 'home',
  })`);

const field = `main input:not([type="file"])`;

async function typeLink(text) {
  await run(`(() => {
    const input = document.querySelector('${field}');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
}

/** A fresh window: no saved tabs or history, on Home. */
async function fresh() {
  await run(`sessionStorage.clear(); localStorage.clear()`);
  // As a returning user: the first-launch toolkit screen already seen, and
  // Download Video turned on (it runs vendor/'s yt-dlp).
  await run(`window.downloader.updateSettings({ toolkitsOnboarded: true })`);
  await run(
    `window.externalTools.rescan().then(() => window.externalTools.setEnabled('ytdlp', true))`,
  );
  await send('Page.navigate', { url: appUrl });
  await sleep(2500);
}

async function reload() {
  await send('Page.reload');
  await sleep(2500);
}

const cases = {
  async 'URL has a real path, no hash'() {
    const now = await state();
    expect(now.path === '/' && now.hash === '', now);
  },

  async 'a Home card opens a tool in a new tab, one page mounted'() {
    await click(`main ${link('/compress-video')}`);
    const now = await state();
    expect(
      now.path === '/compress-video' &&
        now.tabs.length === 1 &&
        now.pages === 1,
      now,
    );
  },

  async 'a sidebar link navigates within the tab'() {
    await click(`main ${link('/compress-video')}`);
    await click(link('/merge-pdfs'));
    const now = await state();
    expect(now.path === '/merge-pdfs' && now.tabs.length === 1, now);
  },

  async 'Cmd+[ and Cmd+] step through the tab’s own history'() {
    await click(`main ${link('/compress-video')}`);
    await click(link('/merge-pdfs'));
    await shortcut('BracketLeft', '[');
    const back = await state();
    await shortcut('BracketRight', ']');
    const forward = await state();
    expect(back.path === '/compress-video' && forward.path === '/merge-pdfs', {
      back,
      forward,
    });
  },

  async 'switching tabs unmounts the page and restores its state'() {
    await click(`main ${link('/merge-pdfs')}`);
    await shortcut('KeyH', 'h');
    await click(`main ${link('/download-video')}`);
    await typeLink('https://example.com/v');
    const download = (await state()).active;
    const [other] = (await state()).tabs;
    await clickTab(other);
    const away = await state();
    const unmounted = !(await run(
      `[...document.querySelectorAll('main input')].some((input) => input.value === 'https://example.com/v')`,
    ));
    await clickTab(download);
    const value = await run(`document.querySelector('${field}')?.value`);
    expect(
      away.path === '/merge-pdfs' &&
        away.pages === 1 &&
        unmounted &&
        value === 'https://example.com/v',
      { away, unmounted, value },
    );
  },

  async 'Home keeps its scroll position across tab switches'() {
    await click(`main ${link('/merge-pdfs')}`);
    const [tab] = (await state()).tabs;
    await shortcut('KeyH', 'h');
    const set = await run(`(() => {
      const area = document.querySelector('main .overflow-y-auto');
      area.scrollTop = 600;
      return area.scrollTop;
    })()`);
    await sleep(200);
    await clickTab(tab);
    await shortcut('KeyH', 'h');
    const top = await run(
      `document.querySelector('main .overflow-y-auto').scrollTop`,
    );
    expect(set > 0 && top === set, { set, top });
  },

  async 'Cmd+Click opens a background tab'() {
    await click(`main ${link('/download-video')}`);
    await click(link('/history'), true);
    const now = await state();
    expect(now.tabs.length === 2 && now.path === '/download-video', now);
  },

  async 'Cmd+W closes a tab and Cmd+Shift+T reopens it afresh'() {
    await click(`main ${link('/download-video')}`);
    await typeLink('https://example.com/v');
    await shortcut('KeyW', 'w');
    const closed = await state();
    await shortcut('KeyT', 't', true);
    const reopened = await state();
    const value = await run(`document.querySelector('${field}')?.value`);
    expect(
      closed.tabs.length === 0 &&
        reopened.path === '/download-video' &&
        value === '',
      { closed, reopened, value },
    );
  },

  async 'reloading keeps every tab, the active one and their history'() {
    // Tab A has two pages of history; B and the History tab are beside it.
    await click(`main ${link('/compress-video')}`);
    await click(link('/merge-pdfs'));
    const a = (await state()).active;
    await shortcut('KeyH', 'h');
    await click(`main ${link('/download-video')}`);
    await click(link('/history'), true);
    // One more tab, closed before the reload, to reopen after it.
    await shortcut('KeyH', 'h');
    await click(`main ${link('/trim-video')}`);
    await shortcut('KeyW', 'w');
    await clickTab(a);
    const before = await state();

    await reload();
    const after = await state();
    await shortcut('BracketLeft', '[');
    const back = await state();
    await shortcut('KeyT', 't', true);
    const reopened = await state();
    expect(
      after.tabs.join() === before.tabs.join() &&
        after.active === a &&
        after.path === '/merge-pdfs' &&
        after.title === 'Merge PDFs' &&
        back.path === '/compress-video' &&
        reopened.path === '/trim-video',
      { before, after, back, reopened },
    );
  },

  async 'Recents leaves out pinned tools'() {
    // Used lately, newest first; Download Video and Merge PDFs are pinned.
    const used = [
      'download-video',
      'compress-video',
      'merge-pdfs',
      'trim-video',
    ];
    await run(`localStorage.setItem('history', JSON.stringify(
      ${JSON.stringify(used)}.map((toolId, at) =>
        ({ id: String(at), toolId, at: Date.now() - at * 1000, items: [] }))))`);
    await reload();
    const lists = await run(`Object.fromEntries(
      [...document.querySelectorAll('aside section')].map((section) => [
        section.querySelector('button').textContent.trim(),
        [...section.querySelectorAll('a')].map((a) => a.getAttribute('href').split('/').pop()),
      ]))`);
    expect(
      lists.Recents?.join() === 'compress-video,trim-video' &&
        lists.Pinned?.includes('download-video') &&
        lists.Pinned?.includes('merge-pdfs'),
      lists,
    );
  },

  async 'reloading on a tool page with one tab comes back on it'() {
    await click(`main ${link('/download-video')}`);
    await reload();
    const now = await state();
    expect(
      now.path === '/download-video' &&
        /Download/.test(now.title) &&
        now.tabs.length === 1,
      now,
    );
  },
};

function expect(passed, detail) {
  if (!passed) throw new Error(JSON.stringify(detail));
}

let failures = 0;
for (const [name, check] of Object.entries(cases)) {
  await fresh();
  try {
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
process.exitCode = failures ? 1 : 0;
