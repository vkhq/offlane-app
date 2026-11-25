// Reading a GIF's timing from its own bytes, for the GIF player (see
// renderer/toolkit/GifView.tsx). No DOM or Node import, so tests can use it.

/** A frame's delay when the GIF gives none (or 10 ms or less), as
 *  browsers play it: 0.1 s. */
export const defaultDelay = 100;

/**
 * Each frame's delay in ms, read from the GIF's own blocks (its Graphic
 * Control Extensions), as a browser plays them: a delay of 10 ms or less
 * counts as 100 ms. GIFs keep delays in hundredths of a second, so 15 fps
 * alternates 60 and 70 ms, which no single delay can stand for. Null if
 * the bytes don't read as a GIF.
 */
export function gifDelays(bytes: Uint8Array): number[] | null {
  if (bytes.length < 13) return null;
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (head !== 'GIF89a' && head !== 'GIF87a') return null;
  /** Skips a run of data sub-blocks from `at`; where the next block is. */
  const skipBlocks = (at: number) => {
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    return at + 1;
  };
  let at = 13;
  // The global colour table, if there is one.
  if (bytes[10] & 0x80) at += 3 * 2 ** ((bytes[10] & 7) + 1);
  const delays: number[] = [];
  let pending = 0;
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x3b) break;
    if (block === 0x21) {
      // An extension: a Graphic Control one holds the next frame's delay.
      if (bytes[at + 1] === 0xf9 && at + 5 < bytes.length) {
        pending = (bytes[at + 4] | (bytes[at + 5] << 8)) * 10;
      }
      at = skipBlocks(at + 2);
    } else if (block === 0x2c) {
      // A frame: past its descriptor, local colour table and picture.
      const packed = bytes[at + 9];
      at += 10;
      if (packed & 0x80) at += 3 * 2 ** ((packed & 7) + 1);
      at = skipBlocks(at + 1);
      delays.push(pending <= 10 ? defaultDelay : pending);
      pending = 0;
    } else {
      return delays.length ? delays : null;
    }
  }
  return delays.length ? delays : null;
}

/**
 * How many times a GIF plays, from its own NETSCAPE2.0 block, as browsers
 * read it: Infinity for a count of 0 (over and over), the count and once
 * more for any other, and once if it has no such block. Null if the bytes
 * don't read as a GIF.
 */
export function gifPlays(bytes: Uint8Array): number | null {
  if (bytes.length < 13) return null;
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (head !== 'GIF89a' && head !== 'GIF87a') return null;
  const skipBlocks = (at: number) => {
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    return at + 1;
  };
  let at = 13;
  if (bytes[10] & 0x80) at += 3 * 2 ** ((bytes[10] & 7) + 1);
  // The block comes before the first frame, if it is there at all.
  while (at < bytes.length && bytes[at] === 0x21) {
    if (bytes[at + 1] === 0xff && bytes[at + 2] === 11) {
      const name = String.fromCharCode(...bytes.subarray(at + 3, at + 14));
      if (name === 'NETSCAPE2.0' && bytes[at + 15] === 1) {
        const count = bytes[at + 16] | (bytes[at + 17] << 8);
        return count === 0 ? Infinity : count + 1;
      }
    }
    at = skipBlocks(at + 2);
  }
  return 1;
}
