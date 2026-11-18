// Makes each session's History picture again, once, at the size History's
// cards now need (previewBox): older sessions kept theirs 240px wide, blurry
// on the larger cards. A session's picture comes from what it worked on:
//
// - the largest picture in its saved state, such as a download's thumbnail
//   as the site gave it, shrunk to fit;
// - else the first file it saved, framed again as when it was dropped.
//
// A session with neither keeps the picture it has. None moves in History.
import type { SessionStore } from './storage/sessions';
import type { FilePreview } from '../shared/types';

type Deps = {
  sessions: SessionStore;
  /** A saved file's preview at the new size, made and kept. */
  preview: (token: string) => Promise<FilePreview | null>;
  /** A picture fitted within previewBox, as a JPEG data: URL. */
  fit: (dataUrl: string) => Promise<string | null>;
  /** After any session's picture changed. */
  changed: () => void;
};

export async function refreshThumbnails({
  sessions,
  preview,
  fit,
  changed,
}: Deps) {
  const stale = sessions.staleThumbnails();
  let any = false;
  for (const { id, state } of stale) {
    let thumbnail: string | null = null;
    try {
      thumbnail = await pictureOf(state, preview, fit);
    } catch (error) {
      console.error('[thumbnails] session', id, 'failed:', error);
    }
    sessions.setThumbnail(id, thumbnail);
    any ||= thumbnail !== null;
  }
  if (any) changed();
}

async function pictureOf(
  state: string,
  preview: Deps['preview'],
  fit: Deps['fit'],
): Promise<string | null> {
  const { pictures, tokens } = scan(JSON.parse(state));
  // The largest inline picture: the original, not a copy made small.
  const largest = pictures.sort((a, b) => b.length - a.length)[0];
  if (largest) {
    const fitted = await fit(largest);
    if (fitted) return fitted;
  }
  for (const token of tokens) {
    const made = await preview(token);
    if (made?.thumbnail) return made.thumbnail;
  }
  return null;
}

/** Every inline picture and saved file's token in a page's state. */
function scan(
  value: unknown,
  found = { pictures: [] as string[], tokens: [] as string[] },
) {
  if (typeof value === 'string') {
    if (/^data:image\/(jpeg|png|webp);base64,/.test(value)) {
      found.pictures.push(value);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) scan(item, found);
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.kind === 'saved-file' && typeof record.token === 'string') {
      found.tokens.push(record.token);
    }
    for (const item of Object.values(record)) scan(item, found);
  }
  return found;
}
