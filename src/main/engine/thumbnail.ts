// The picture for a looked-up link's card, its thumbnail, fetched here and
// handed to the page as a data: URL. The page's
// Content Security Policy only lets it load images from the app itself, and
// that stays so: the main process fetches, checks and inlines them instead.

import { demoThumbnail, isDemo } from './demo';

const maxBytes = 2 * 1024 * 1024;
const types = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * The thumbnail as a data: URL, or null when there is none or it cannot be
 * had. Skipped when a proxy is set: yt-dlp honours it, a plain fetch would
 * not, and the image is not worth a request outside it.
 */
export async function fetchThumbnail(
  url: string | null,
  proxy: string,
): Promise<string | null> {
  if (url && isDemo(url)) return demoThumbnail;
  if (!url || proxy) return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (!response.ok || !type || !types.includes(type)) return null;
    const length = Number(response.headers.get('content-length'));
    if (length > maxBytes) return null;
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) return null;
    return `data:${type};base64,${body.toString('base64')}`;
  } catch {
    // A missing picture never fails the lookup.
    return null;
  }
}
