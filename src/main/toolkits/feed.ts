// The toolkit feed: a JSON file of newer releases, signed with the
// publisher's Ed25519 key, so toolkits can update without a new release of
// the app. The app trusts it only if its signature checks out against one of
// the public keys in ./trust.ts; a feed from anywhere else, or edited on the
// way, is ignored and the pinned catalog stays in use.
//
// Off until a feed is published: set FEED_URL to its address.
//
// No Electron import.
import { createPublicKey, verify } from 'node:crypto';

import { isToolkitId } from '../../shared/toolkits';
import type {
  ReleaseOverlay,
  ToolkitArchive,
  ToolkitCheck,
  ToolkitRelease,
} from './catalog';
import { feedPublicKeys } from './trust';

/** Where the signed feed is: `<url>`, with its signature at `<url>.sig`. */
export type FeedSource = { url: string; publicKeys: readonly string[] };

const FEED_URL: string | null = null;

export const FEED: FeedSource | null = FEED_URL
  ? { url: FEED_URL, publicKeys: feedPublicKeys }
  : null;

const isText = (value: unknown, max = 2048): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** A path inside the toolkit's folder: relative, and never climbing out. */
const isInside = (value: unknown): value is string =>
  isText(value, 512) &&
  !value.startsWith('/') &&
  !/^[a-z]:/i.test(value) &&
  !value.split(/[\\/]/).includes('..');

function checkArchive(raw: unknown): ToolkitArchive {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (!isText(value.url) || !value.url.startsWith('https://')) {
    throw new Error('archive url');
  }
  if (!isHash(value.sha256)) throw new Error('archive sha256');
  if (typeof value.size !== 'number' || value.size <= 0) {
    throw new Error('archive size');
  }
  if (value.into !== undefined && !isInside(value.into)) {
    throw new Error('archive into');
  }
  // The feed's archives are laid out by the publisher: no picking or
  // renaming, only a folder to put them in.
  return {
    url: value.url,
    sha256: value.sha256,
    size: value.size,
    ...(value.into !== undefined && { into: value.into as string }),
  };
}

function checkCheck(raw: unknown): ToolkitCheck {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (!isText(value.binary, 64)) throw new Error('check binary');
  if (!Array.isArray(value.args) || !value.args.every((arg) => isText(arg))) {
    throw new Error('check args');
  }
  const check: ToolkitCheck = { binary: value.binary, args: value.args };
  for (const key of ['expect', 'forbid', 'message'] as const) {
    if (value[key] !== undefined) {
      if (!isText(value[key], 256)) throw new Error(`check ${key}`);
      check[key] = value[key] as string;
    }
  }
  return check;
}

/** A release from the feed, checked field by field. */
export function checkRelease(raw: unknown): ToolkitRelease {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (!isText(value.version, 64) || !isText(value.host, 128)) {
    throw new Error('release version or host');
  }
  if (!Array.isArray(value.archives) || value.archives.length === 0) {
    throw new Error('release archives');
  }
  const binaries = (value.binaries ?? {}) as Record<string, unknown>;
  if (!Object.values(binaries).every(isInside)) {
    throw new Error('release binaries');
  }
  return {
    version: value.version,
    host: value.host,
    archives: value.archives.map(checkArchive),
    binaries: binaries as Record<string, string>,
    checks: Array.isArray(value.checks) ? value.checks.map(checkCheck) : [],
  };
}

/** The feed's JSON as releases; anything malformed is left out. */
export function parseFeed(json: unknown): ReleaseOverlay {
  const overlay: ReleaseOverlay = {};
  const toolkits = ((json ?? {}) as { toolkits?: unknown }).toolkits ?? {};
  for (const [id, variants] of Object.entries(toolkits)) {
    if (!isToolkitId(id) || typeof variants !== 'object' || !variants) continue;
    for (const [variant, targets] of Object.entries(variants)) {
      if (typeof targets !== 'object' || !targets) continue;
      for (const [target, release] of Object.entries(targets)) {
        try {
          ((overlay[id] ??= {})[variant] ??= {})[target] =
            checkRelease(release);
        } catch (error) {
          console.error(
            `[toolkits] feed release ${id}/${variant}/${target} left out:`,
            error,
          );
        }
      }
    }
  }
  return overlay;
}

/** Whether `signature` (base64) is one of the keys' signature of `body`.
 *  A key that can't be read counts as not matching. */
export function verifyFeed(
  body: Buffer,
  signature: string,
  publicKeys: readonly string[],
): boolean {
  const bytes = Buffer.from(signature.trim(), 'base64');
  return publicKeys.some((key) => {
    try {
      return verify(null, body, createPublicKey(key), bytes);
    } catch {
      return false;
    }
  });
}

/** Fetches the feed and its signature (`<url>.sig`); throws unless both
 *  arrive and the signature is good. */
export async function fetchFeed(
  feed: FeedSource,
  signal?: AbortSignal,
): Promise<ReleaseOverlay> {
  const [body, signature] = await Promise.all(
    [feed.url, `${feed.url}.sig`].map(async (url) => {
      const response = await fetch(url, { signal, redirect: 'follow' });
      if (!response.ok) {
        throw new Error(
          `Couldn’t check for updates (HTTP ${response.status}).`,
        );
      }
      return Buffer.from(await response.arrayBuffer());
    }),
  );
  if (!verifyFeed(body, signature.toString('utf8'), feed.publicKeys)) {
    throw new Error('The update list wasn’t signed by this app’s publisher.');
  }
  return parseFeed(JSON.parse(body.toString('utf8')));
}
