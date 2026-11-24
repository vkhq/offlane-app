// A video's speed, as Change Speed sets it: shared by its editor (in the
// page) and its handler (in the main process), so the length the page shows
// is the length the file comes out at. No React or Electron here.

/** "1.25×" (or "1.25x", "1.25") as 1.25; null if it isn't a speed from
 *  0.25 to 4. */
export function parseSpeed(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[×x]?\s*$/i.exec(text);
  if (!match) return null;
  const speed = Number(match[1]);
  return speed >= 0.25 && speed <= 4 ? speed : null;
}

/** How long a video of `seconds` lasts at `speed`. */
export const lengthAt = (seconds: number, speed: number) => seconds / speed;

/**
 * FFmpeg's `atempo` steps for `speed`, keeping the pitch: one step from
 * 0.5 to 2, chained beyond (4× is `atempo=2,atempo=2`), as one step that
 * far sounds worse.
 */
export function tempoSteps(speed: number): string[] {
  const steps: string[] = [];
  let left = speed;
  while (left > 2) {
    steps.push('atempo=2');
    left /= 2;
  }
  while (left < 0.5) {
    steps.push('atempo=0.5');
    left /= 0.5;
  }
  if (Math.abs(left - 1) > 1e-9) steps.push(`atempo=${+left.toFixed(6)}`);
  return steps;
}
