// Offline test mode, for src/tests/e2e/download.mjs: with OFFLANE_MOCKS
// set to a folder (and never in a packaged app), yt-dlp is the fake one in
// that folder (searched first, see engine/external.ts), and the main
// process's fetch serves https://mock.test/<name>
// from it and refuses every other address. So a test run looks things up,
// downloads and shows thumbnails without a single request leaving the
// machine.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const host = 'mock.test';
const types: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.json': 'application/json',
};

/** Swaps fetch for one served from `dir`; anything else fails as offline. */
export function useMocks(dir: string): void {
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    if (url.hostname !== host) {
      throw new TypeError(`fetch failed: ${url.host} is offline in test mode`);
    }
    const file = path.join(dir, path.basename(url.pathname));
    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: {
          'content-type':
            types[path.extname(file)] ?? 'application/octet-stream',
          'content-length': String(body.length),
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  };
}
