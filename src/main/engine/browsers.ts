// The browsers yt-dlp can borrow sign-ins from (--cookies-from-browser), and
// which of them are installed here, so the app only offers those. A site
// that shows a video only to signed-in people (Instagram, often) can then
// be downloaded as the person, from the browser they are signed in to.
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { BrowserChoice, JobError } from '../../shared/types';

/**
 * yt-dlp's name for each browser, where its app is on a Mac, and the folder
 * (under ~/Library) its sign-ins are read from.
 */
const browsers: (BrowserChoice & { mac: string; data: string })[] = [
  {
    id: 'chrome',
    name: 'Chrome',
    mac: 'Google Chrome.app',
    data: 'Application Support/Google/Chrome',
  },
  {
    id: 'safari',
    name: 'Safari',
    mac: 'Safari.app',
    data: 'Containers/com.apple.Safari/Data/Library/Cookies',
  },
  {
    id: 'firefox',
    name: 'Firefox',
    mac: 'Firefox.app',
    data: 'Application Support/Firefox',
  },
  {
    id: 'brave',
    name: 'Brave',
    mac: 'Brave Browser.app',
    data: 'Application Support/BraveSoftware/Brave-Browser',
  },
  {
    id: 'edge',
    name: 'Edge',
    mac: 'Microsoft Edge.app',
    data: 'Application Support/Microsoft Edge',
  },
  {
    id: 'opera',
    name: 'Opera',
    mac: 'Opera.app',
    data: 'Application Support/com.operasoftware.Opera',
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    mac: 'Vivaldi.app',
    data: 'Application Support/Vivaldi',
  },
  {
    id: 'chromium',
    name: 'Chromium',
    mac: 'Chromium.app',
    data: 'Application Support/Chromium',
  },
  {
    id: 'whale',
    name: 'Whale',
    mac: 'Naver Whale.app',
    data: 'Application Support/Naver/Whale',
  },
];

/** Whether `id` is a browser yt-dlp can read sign-ins from. */
export const isBrowser = (id: string) =>
  browsers.some((browser) => browser.id === id);

/**
 * The browsers to offer: on a Mac, those installed (in /Applications or
 * ~/Applications); elsewhere every one but Safari, as there is no telling.
 */
export function installedBrowsers(): BrowserChoice[] {
  if (process.platform !== 'darwin') {
    return browsers
      .filter((browser) => browser.id !== 'safari')
      .map(({ id, name }) => ({ id, name }));
  }
  const folders = ['/Applications', path.join(os.homedir(), 'Applications')];
  return browsers
    .filter((browser) =>
      folders.some((folder) => existsSync(path.join(folder, browser.mac))),
    )
    .map(({ id, name }) => ({ id, name }));
}

/**
 * The app macOS holds responsible for this one, whose Full Disk Access
 * counts: the app itself once packaged; while developing, the terminal or
 * editor it was started from.
 */
function responsibleApp(): string {
  const bundle = /\/([^/]+)\.app\/Contents\/MacOS\//.exec(process.execPath);
  if (bundle && bundle[1] !== 'Electron') return bundle[1];
  const terminals: Record<string, string> = {
    vscode: 'Visual Studio Code',
    Apple_Terminal: 'Terminal',
    'iTerm.app': 'iTerm',
    WarpTerminal: 'Warp',
    ghostty: 'Ghostty',
    WezTerm: 'WezTerm',
  };
  return (
    terminals[process.env.TERM_PROGRAM ?? ''] ?? 'the app you started it from'
  );
}

/**
 * Whether the app can read browser `id`'s sign-ins, checked before yt-dlp
 * tries: macOS keeps other apps' data private unless the app has Full Disk
 * Access, and yt-dlp then says only that it "could not find" the cookies.
 * Null when it can, or when there is no telling (not a Mac).
 */
export async function checkBrowserAccess(id: string): Promise<JobError | null> {
  const browser = browsers.find((candidate) => candidate.id === id);
  if (!browser || process.platform !== 'darwin') return null;
  // The offline tests' fake yt-dlp reads no cookies, so there is nothing
  // to check, unless a test asks (see src/main/mocks.ts).
  if (process.env.OFFLANE_MOCKS && process.env.MOCK_BROWSER_ACCESS !== 'real') {
    return null;
  }
  const folder = path.join(os.homedir(), 'Library', browser.data);
  try {
    await fs.readdir(folder);
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') {
      return {
        category: 'browser_blocked',
        message: `macOS is keeping the app out of ${browser.name}’s data. Turn on Full Disk Access for ${responsibleApp()} in System Settings › Privacy & Security, then retry.`,
        raw: `${code}: ${folder}`,
        action: 'use_browser_cookies',
        retryable: false,
      };
    }
    return {
      category: 'browser_cookies',
      message: `No ${browser.name} sign-ins were found on this Mac. Open ${browser.name} and sign in, or choose another browser.`,
      raw: `${code}: ${folder}`,
      action: 'use_browser_cookies',
      retryable: false,
    };
  }
}
