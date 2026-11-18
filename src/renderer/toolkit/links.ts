/** The link in `text` if it is an http(s) URL, else null. */
export function toLink(text: string) {
  try {
    const url = new URL(text.trim());
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export const invalidLink =
  'That is not a link. It should start with http:// or https://.';
